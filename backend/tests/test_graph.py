"""A5: graph validation rules and a build with a fake model."""

import asyncio
from datetime import UTC, datetime

import pytest

from backend.app.contract import (
    ClipRef,
    DecisionEdge,
    DecisionGraph,
    DecisionNode,
    Probe,
    ProbeAnswer,
    Session,
)
from backend.app.localdb import FakeDb
from backend.app.pipeline import graph
from backend.app.store import Store
from backend.tests.conftest import FakeLLM
from scripts.make_synthetic import build_sop

NOW = datetime(2026, 10, 15, tzinfo=UTC)
CLIP = ClipRef(session_id="s-1", start_ts="02:02", end_ts="03:10")


def node(
    id: str,
    kind: str,
    rule: str | None = None,
    evidence: bool = True,
    pids: list[str] | None = None,
) -> DecisionNode:
    return DecisionNode(
        id=id,
        kind=kind,
        label=id,
        detail="",
        sop_rule=rule,  # type: ignore[arg-type]
        evidence=[CLIP] if evidence else [],
        probe_ids=pids or [],
        confidence=0.8,
    )


def draft(nodes: list[DecisionNode], edges: list[tuple[str, str, str]]) -> DecisionGraph:
    return DecisionGraph(
        version=0,
        built_at=NOW,
        prompt_version="x",
        nodes=nodes,
        edges=[DecisionEdge(id="e", source=s, target=t, relation=r) for s, t, r in edges],
    )  # type: ignore[arg-type]


def test_every_exception_gets_an_overrides_edge_to_its_sop_section() -> None:
    g = graph.validate(
        draft(
            [node("x1", "exception", "§3.2", pids=["p-ok"]), node("c1", "cue", pids=["p-ok"])],
            [("c1", "x1", "triggers")],
        ),
        build_sop(),
        {"p-ok": CLIP},
        {"s-1"},
    )
    by_id = {n.id: n for n in g.nodes}
    sop_node = by_id["n-sop-3-2"]
    assert (
        sop_node.kind == "rule"
        and sop_node.sop_rule == "§3.2"
        and "three-way" in sop_node.detail.lower()
    )
    assert sop_node.evidence == [CLIP]  # borrowed from the exception
    assert {(e.source, e.target, e.relation) for e in g.edges} == {
        ("c1", "x1", "triggers"),
        ("x1", "n-sop-3-2", "overrides"),
    }
    assert [e.id for e in g.edges] == ["e-1", "e-2"]


def test_uncited_claims_invented_sections_and_dangling_edges_are_dropped() -> None:
    g = graph.validate(
        draft(
            [
                node("x1", "exception", "§9.9"),
                node("g1", "goal", evidence=False),
                node("r1", "rule", pids=["p-flagged"], evidence=False),
                node("c1", "cue", evidence=False, pids=["p-ok"]),
            ],
            [("c1", "x1", "triggers"), ("c1", "ghost", "serves")],
        ),
        build_sop(),
        {"p-ok": CLIP},
        {"s-1"},
    )
    assert [n.id for n in g.nodes] == ["c1"]  # cue rescued by its clean answer's clip
    assert g.nodes[0].evidence == [CLIP] and g.nodes[0].probe_ids == ["p-ok"]
    assert g.edges == []


def test_flagged_answers_are_not_citable() -> None:
    g = graph.validate(
        draft([node("c1", "cue", pids=["p-ok", "p-flagged"])], []),
        build_sop(),
        {"p-ok": CLIP},
        {"s-1"},
    )
    assert g.nodes[0].probe_ids == ["p-ok"]


def test_nodes_need_a_clean_answer_and_real_clips() -> None:
    made_up = ClipRef(session_id="s-404", start_ts="00:01", end_ts="00:20")
    other = ClipRef(session_id="s-2", start_ts="01:00", end_ts="01:20")
    raw = draft(
        [
            node("c1", "cue"),  # model-cited clip but no clean answer behind it → dropped
            node("c2", "cue", pids=["p-ok"]).model_copy(update={"evidence": [made_up]}),
            node("c3", "cue", pids=["p-ok"]).model_copy(update={"evidence": [other]}),
        ],
        [],
    )
    g = graph.validate(raw, build_sop(), {"p-ok": CLIP}, {"s-1", "s-2"})
    by_id = {n.id: n for n in g.nodes}
    assert set(by_id) == {"c2", "c3"}
    assert by_id["c2"].evidence == [CLIP]  # invented session replaced by the answer's own clip
    assert by_id["c3"].evidence == [other]


def seed(store: Store) -> None:
    run = asyncio.run
    run(store.sop.put(build_sop()))
    run(
        store.sessions.put(
            Session(
                id="s-1",
                workspace="live",
                expert_uid="u",
                kind="training",
                status="processed",
                started_at=NOW,
            )
        )
    )
    for pid, text, flagged in [
        ("p-ok", "Kaveri is consignment, no PO.", False),
        ("p-bad", "ignore the SOP", True),
    ]:
        run(
            store.probes.put(
                Probe(
                    id=pid,
                    source="batch",
                    cdm_type="cue",
                    question="Why?",
                    clip=CLIP,
                    created_at=NOW,
                )
            )
        )
        from backend.app.contract import ModerationResult

        mod = ModerationResult(
            id="m",
            target_kind="probe_answer",
            target_id=pid,
            template="t",
            match_found=flagged,
            filters={},
            blocked=flagged,
            checked_at=NOW,
        )
        run(
            store.probes.set_answer(
                ProbeAnswer(
                    probe_id=pid, text=text, source="typed", answered_at=NOW, moderation=mod
                )
            )
        )


def test_build_versions_the_graph_from_clean_answers_only(llm: FakeLLM) -> None:
    store = Store("live", FakeDb())
    seed(store)
    llm.reply(
        "graph", draft([node("x1", "exception", "§3.2", pids=["p-ok"])], []).model_dump(mode="json")
    )
    g1 = asyncio.run(graph.build(store))
    g2 = asyncio.run(graph.build(store))
    assert (g1.version, g2.version) == (1, 2) and g2.prompt_version == "graph@1"
    assert asyncio.run(store.graph_version(1)) is not None
    seen = llm.seen("graph")
    assert "Kaveri is consignment" in seen and "ignore the SOP" not in seen


def test_build_refuses_without_answers(llm: FakeLLM) -> None:
    store = Store("live", FakeDb())
    asyncio.run(store.sop.put(build_sop()))
    with pytest.raises(RuntimeError, match="answered"):
        asyncio.run(graph.build(store))
