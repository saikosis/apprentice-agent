import asyncio
from collections.abc import Coroutine
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException

from backend.app.contract import (
    ClipRef,
    DecisionEdge,
    DecisionGraph,
    DecisionNode,
    Probe,
    ProbeAnswer,
    Segment,
    Session,
    SheetDiff,
)
from backend.app.store import Store, Ws
from backend.tests.fake_firestore import FakeDb

IST = timezone(timedelta(hours=5, minutes=30))
T0 = datetime(2026, 10, 14, 10, 5, tzinfo=IST)


def run[T](c: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(c)


def session(id: str, ws: Ws = "live") -> Session:
    return Session(
        id=id, workspace=ws, expert_uid="u1", kind="training", status="created", started_at=T0
    )


def test_put_get_list_round_trip_keeps_timezones() -> None:
    s = Store("live", FakeDb())
    run(s.sessions.put(session("s-01")))
    run(s.sessions.put(session("s-02")))
    got = run(s.sessions.get("s-01"))
    assert got == session("s-01")
    assert got is not None and got.started_at.utcoffset() == timedelta(hours=5, minutes=30)
    assert [x.id for x in run(s.sessions.list())] == ["s-01", "s-02"]
    assert run(s.sessions.get("missing")) is None


def test_workspaces_and_sessions_are_isolated() -> None:
    db = FakeDb()
    live, demo = Store("live", db), Store("demo", db, allow_demo_writes=True)
    seg = Segment(
        id="seg-1", session_id="s-01", start_ts="00:01", end_ts="00:20", app="sheets", action="x"
    )
    run(live.segments("s-01").put(seg))
    assert run(live.segments("s-01").list()) == [seg]
    assert run(live.segments("s-02").list()) == []
    assert run(demo.segments("s-01").list()) == []
    assert "workspaces/live/sessions/s-01/segments/seg-1" in db.docs


def test_demo_workspace_rejects_writes_with_403() -> None:
    s = Store("demo", FakeDb())
    with pytest.raises(HTTPException) as e:
        run(s.sessions.put(session("s-01", "demo")))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        run(s.sessions.delete("s-01"))


def test_probe_answer_is_a_field_on_the_probe_doc() -> None:
    s = Store("live", FakeDb())
    p = Probe(id="p-1", source="batch", cdm_type="cue", question="What told you?", created_at=T0)
    run(s.probes.put(p))
    assert run(s.probes.answer("p-1")) is None

    a = ProbeAnswer(
        probe_id="p-1", text="Vendor type is consignment.", source="typed", answered_at=T0
    )
    run(s.probes.set_answer(a))
    got = run(s.probes.get("p-1"))
    assert got is not None and got.status == "answered"
    assert run(s.probes.answer("p-1")) == a
    assert run(s.probes.with_answers()) == [(got, a)]


def test_sheet_diff_lives_under_the_session() -> None:
    s = Store("live", FakeDb())
    assert run(s.get_sheet_diff("s-01")) is None
    run(s.put_sheet_diff(SheetDiff(session_id="s-01", changes=[])))
    assert run(s.get_sheet_diff("s-01")) == SheetDiff(session_id="s-01", changes=[])


def graph(version: int, node_ids: list[str]) -> DecisionGraph:
    clip = ClipRef(session_id="s-01", start_ts="02:02", end_ts="03:10")
    nodes = [
        DecisionNode(
            id=n, kind="cue", label=n, detail="", evidence=[clip], probe_ids=[], confidence=0.8
        )
        for n in node_ids
    ]
    edges = [DecisionEdge(id="e-1", source=node_ids[0], target=node_ids[-1], relation="triggers")]
    return DecisionGraph(
        version=version, built_at=T0, prompt_version="graph@1", nodes=nodes, edges=edges
    )


def test_graph_rebuild_replaces_nodes_and_keeps_history() -> None:
    db = FakeDb()
    s = Store("live", db)
    assert run(s.get_graph()) is None
    run(s.put_graph(graph(1, ["n-1", "n-2", "n-3"])))
    run(s.put_graph(graph(2, ["n-1", "n-4"])))
    got = run(s.get_graph())
    assert got == graph(2, ["n-1", "n-4"])
    assert "workspaces/live/graph/current/nodes/n-2" not in db.docs
    assert run(s.graph_version(1)) == graph(1, ["n-1", "n-2", "n-3"])


def test_resaving_an_answered_probe_keeps_it_answered() -> None:
    s = Store("live", FakeDb())
    p = Probe(id="p-1", source="batch", cdm_type="cue", question="Why?", created_at=T0)
    run(s.probes.put(p))
    run(
        s.probes.set_answer(
            ProbeAnswer(probe_id="p-1", text="Because.", source="typed", answered_at=T0)
        )
    )
    run(
        s.probes.put(p.model_copy(update={"question": "Why, exactly?"}))
    )  # status still "open" here
    got = run(s.probes.get("p-1"))
    assert got is not None and got.status == "answered" and got.question == "Why, exactly?"
    assert run(s.probes.answer("p-1")) is not None


def test_answering_an_unknown_probe_is_404_and_writes_nothing() -> None:
    db = FakeDb()
    s = Store("live", db)
    with pytest.raises(HTTPException) as e:
        run(
            s.probes.set_answer(
                ProbeAnswer(probe_id="nope", text="x", source="typed", answered_at=T0)
            )
        )
    assert e.value.status_code == 404
    assert db.docs == {}


def test_graph_rebuild_never_deletes_and_sets_the_same_doc_in_one_batch() -> None:
    db = FakeDb()
    s = Store("live", db)
    run(s.put_graph(graph(1, ["n-1", "n-2"])))
    batches: list[list[tuple[str, str]]] = []
    real_batch = db.batch

    def spy():  # type: ignore[no-untyped-def]
        b = real_batch()
        batches.append(b.ops)  # type: ignore[arg-type]
        return b

    db.batch = spy  # type: ignore[method-assign]
    run(s.put_graph(graph(2, ["n-1", "n-3"])))
    ops = [(op, ref.path) for op, ref, _ in batches[0]]  # type: ignore[misc]
    deleted = {p for op, p in ops if op == "delete"}
    assert deleted == {"workspaces/live/graph/current/nodes/n-2"}
    assert not deleted & {p for op, p in ops if op == "set"}
