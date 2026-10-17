"""A6: majority/aggregation, the exam run end to end, and A7's label-leakage guarantee."""

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest

from backend.app.contract import (
    AgentOutput,
    AgentRun,
    ClipRef,
    DecisionGraph,
    DecisionNode,
    Email,
    ExamCase,
    ExpertLabel,
    JudgeScore,
    Probe,
    ProbeAnswer,
    Session,
)
from backend.app.exam import arms, judge, report, scenarios
from backend.app.localdb import FakeDb
from backend.app.pipeline import graph, probes
from backend.app.store import Store
from backend.tests.conftest import FakeLLM
from scripts.make_synthetic import build_sop

NOW = datetime(2026, 10, 16, tzinfo=UTC)
SECRET = "LABEL-SECRET-7f3a"
CLIP = ClipRef(session_id="s-1", start_ts="02:02", end_ts="03:10")


def case(id: str, decision: str = "approve", trap: str = "none") -> ExamCase:
    inv = {
        "invoice_id": "INV-2001",
        "vendor_id": "V-011",
        "vendor_name": "Kaveri Consolidated Traders",
        "invoice_no": "KAV/2026/0901",
        "amount_inr": "46900",
        "po_number": "",
        "status": "Pending",
    }
    return ExamCase(
        id=id,
        origin="generated",
        trap_type=trap,
        tests_rule="Consignment vendor: skip PO match",  # type: ignore[arg-type]
        item=inv,
        reference_row={"vendor_id": "V-011", "type": "standard"},
        emails=[
            Email(
                id="em",
                sender="a@kaveri.test",
                subject="Re: payment",
                body="pay now",
                received_at="2026-10-10",
            )
        ],
        context="",
        expert_label=ExpertLabel(
            decision=decision, rationale=SECRET, labeled_by="expert", labeled_at=NOW
        ),  # type: ignore[arg-type]
    )


def out(decision: str) -> dict[str, Any]:
    return AgentOutput(
        decision=decision, rationale="r", planned_steps=["s"], cited_sop_rules=["§3.2"]
    ).model_dump()  # type: ignore[arg-type]


def test_majority_and_ties() -> None:
    assert report.majority(["approve", "approve", "hold"], 3) == ("approve", 2 / 3)
    assert report.majority(["approve", "hold"], 3) == (None, 1 / 3)
    assert report.majority([], 3) == (None, 0.0)


def test_judge_total_uses_spec_weights() -> None:
    assert judge.total(5, 3, 1) == 0.5 * 5 + 0.25 * 3 + 0.25 * 1


def test_aggregate_counts_agreement_traps_and_blocked() -> None:
    cases = [case("c-1", "approve"), case("c-2", "reject", "consignment_lookalike")]

    def run(cid: str, arm: str, i: int, d: str | None, blocked: bool = False) -> AgentRun:
        return AgentRun(
            id=f"{cid}{arm}{i}",
            case_id=cid,
            arm=arm,
            run_index=i,  # type: ignore[arg-type]
            output=AgentOutput.model_validate(out(d)) if d else None,
            blocked=blocked,
            latency_ms=1,
            model="m",
            prompt_version="p",
        )

    runs = [
        run("c-1", "sop_only", 0, "hold"),
        run("c-1", "sop_only", 1, "hold"),
        run("c-1", "sop_only", 2, "approve"),
        run("c-1", "sop_graph", 0, "approve"),
        run("c-1", "sop_graph", 1, "approve"),
        run("c-1", "sop_graph", 2, None),
        run("c-2", "sop_only", 0, "approve"),
        run("c-2", "sop_only", 1, "approve"),
        run("c-2", "sop_only", 2, "approve", True),
        run("c-2", "sop_graph", 0, "reject"),
        run("c-2", "sop_graph", 1, "reject"),
        run("c-2", "sop_graph", 2, "reject"),
    ]
    scores = [
        JudgeScore(
            run_id=r.id,
            case_id=r.case_id,
            arm=r.arm,
            decision_match=False,
            decision_score=5,
            rationale_consistency=5,
            edge_case_handling=5,
            total=4.0 if r.arm == "sop_graph" else 2.0,
            explanation="",
        )
        for r in runs
    ]
    rep = report.aggregate("r-1", cases, runs, scores, 3, 2, [])
    assert (
        rep.per_arm["sop_graph"].agreement_pct == 100.0
        and rep.per_arm["sop_only"].agreement_pct == 0.0
    )
    assert rep.per_arm["sop_graph"].traps_correct == 1 and rep.per_arm["sop_only"].blocked_runs == 1
    c1 = rep.cases[0]
    assert (
        c1.sop_only_majority == "hold"
        and c1.sop_graph_majority == "approve"
        and c1.sop_graph_stability == pytest.approx(2 / 3, abs=1e-3)
    )
    assert rep.per_arm["sop_graph"].judge_mean == 4.0


def test_miss_question_describes_the_case_never_the_answer() -> None:
    q = report.miss_question(case("c-1", "reject"))
    assert q.startswith("Invoice INV-2001 (Kaveri Consolidated Traders, KAV/2026/0901, 46900)")
    assert "type: standard" in q and "po_number: none" in q
    assert SECRET not in q and "reject" not in q.lower()
    assert "Re: payment" not in q and "pay now" not in q  # untrusted email text is never quoted
    v = case("c-2").model_copy(
        update={
            "item": {"response_id": "R-307", "name": "Riya Sen", "preferred_shift": "SH-3"},
            "reference_row": {"kind": "shift", "floor": "first", "capacity": "5"},
        }
    )
    q = report.miss_question(v, "volunteers")
    assert q.startswith("Sign-up R-307 (Riya Sen, R-307, SH-3)") and "floor: first" in q


def seeded_store(labelled: list[ExamCase]) -> Store:
    store = Store("live", FakeDb())
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
    run(
        store.probes.put(
            Probe(
                id="p-1", source="batch", cdm_type="cue", question="Why?", clip=CLIP, created_at=NOW
            )
        )
    )
    run(
        store.probes.set_answer(
            ProbeAnswer(probe_id="p-1", text="Consignment, no PO.", source="typed", answered_at=NOW)
        )
    )
    g = DecisionGraph(
        version=1,
        built_at=NOW,
        prompt_version="graph@1",
        nodes=[
            DecisionNode(
                id="n-x1",
                kind="exception",
                label="Consignment: skip PO",
                detail="",
                sop_rule="§3.2",
                evidence=[CLIP],
                probe_ids=["p-1"],
                confidence=0.9,
            )
        ],
        edges=[],
    )
    run(store.put_graph(g))
    for c in labelled:
        run(store.exam_cases.put(c))
    return store


def test_run_exam_end_to_end(llm: FakeLLM) -> None:
    store = seeded_store([case("c-1", "approve"), case("c-2", "reject", "consignment_lookalike")])
    llm.reply("arm_sop", out("hold"))
    llm.reply("arm_graph", out("approve"))  # right on c-1, wrong on the c-2 trap
    llm.reply(
        "judge",
        {
            "run_id": "x",
            "case_id": "x",
            "arm": "sop_only",
            "decision_match": True,
            "decision_score": 5,
            "rationale_consistency": 4,
            "edge_case_handling": 3,
            "total": 0,
            "explanation": "ok",
        },
    )
    rep = asyncio.run(report.run_exam(store, "r-1", 3))
    assert (
        len(asyncio.run(store.agent_runs.list())) == 12
        and len(asyncio.run(store.judge_scores.list())) == 12
    )
    assert (
        rep.per_arm["sop_graph"].agreement_pct == 50.0
        and rep.per_arm["sop_only"].agreement_pct == 0.0
    )
    s = asyncio.run(store.judge_scores.list())[0]
    assert s.total == judge.total(5, 4, 3) and s.decision_match == (
        s.arm == "sop_graph" and s.case_id == "c-1"
    )
    # one graph-arm miss → one exam_miss probe, and re-running doesn't ask it twice
    assert len(rep.new_probe_ids) == 1
    assert asyncio.run(report.run_exam(store, "r-2", 1)).new_probe_ids == []
    assert asyncio.run(store.exam_reports.get("r-1")) == rep
    assert asyncio.run(store.get_job("r-1")) == {"status": "done", "error": None}


def test_scenarios_strip_labels_and_retry_for_missing_traps(llm: FakeLLM) -> None:
    store = seeded_store([])
    mk = lambda trap: {**case("x", trap=trap).model_dump(mode="json"), "expert_label": None}
    leaky = {**mk("none"), "expert_label": case("x").expert_label.model_dump(mode="json")}  # type: ignore[union-attr]
    llm.reply(
        "scenarios",
        {"cases": [leaky]},
        {
            "cases": [
                mk("consignment_lookalike"),
                mk("prompt_injection"),
                mk("duplicate_renumbered"),
            ]
        },
    )
    cases = asyncio.run(scenarios.generate(store, [], 3))
    assert [c.id for c in cases] == ["c-01", "c-02", "c-03"] and all(
        c.expert_label is None for c in cases
    )
    assert len([c for c in llm.calls if c["prompt_id"] == "scenarios"]) == 2


# ---- A7: test_no_label_leakage ----
def test_no_label_leakage(llm: FakeLLM) -> None:
    """Graph builder, probe generator and arms never receive expert_label (or trap hints); the judge does."""
    labelled = [case("c-1", "reject", "prompt_injection")]
    store = seeded_store(labelled)
    llm.reply(
        "graph",
        {
            "version": 0,
            "built_at": NOW.isoformat(),
            "prompt_version": "x",
            "nodes": [],
            "edges": [],
        },
    )
    llm.reply("probes", {"probes": []})
    llm.reply("arm_sop", out("hold"))
    llm.reply("arm_graph", out("reject"))
    llm.reply(
        "judge",
        {
            "run_id": "x",
            "case_id": "x",
            "arm": "sop_only",
            "decision_match": True,
            "decision_score": 5,
            "rationale_consistency": 5,
            "edge_case_handling": 5,
            "total": 0,
            "explanation": "",
        },
    )

    asyncio.run(graph.build(store))
    from backend.app.contract import Deviation

    d = Deviation(
        id="d-1",
        session_id="s-1",
        source="batch",
        sop_rule="§3.2",
        timestamp="02:02",
        t_seconds=122,
        description="x",
        question="Why?",
        confidence=0.9,
    )
    asyncio.run(probes.for_deviations(store, [d], [], build_sop()))
    asyncio.run(report.run_exam(store, "r-1", 1))

    for pid in ("graph", "probes", "arm_sop", "arm_graph"):
        seen = llm.seen(pid)
        assert seen != "[]", f"{pid} was never called"
        assert SECRET not in seen and "expert_label" not in seen, f"label leaked into {pid}"
        assert "prompt_injection" not in seen and "tests_rule" not in seen, (
            f"trap hint leaked into {pid}"
        )
    assert SECRET in llm.seen("judge")
    assert "sop_graph" not in llm.seen("judge") and "cited_nodes" not in llm.seen(
        "judge"
    )  # judge is blind to the arm


def test_arm_input_has_only_what_a_new_analyst_sees() -> None:
    view = arms.case_input(case("c-1"))
    assert set(view) == {"id", "item", "reference_row", "emails", "context"}
