"""Aggregate AgentRuns + JudgeScores into an ExamReport."""

import asyncio
import logging
from collections import Counter
from datetime import UTC, datetime
from statistics import fmean

from fastapi import HTTPException

from backend.app.contract import (
    AgentRun,
    Arm,
    ArmSummary,
    CaseRow,
    Decision,
    ExamCase,
    ExamReport,
    JudgeScore,
    Probe,
)
from backend.app.exam import arms, judge
from backend.app.store import Store, new_id

ARMS: tuple[Arm, Arm] = ("sop_only", "sop_graph")
log = logging.getLogger(__name__)


def majority(decisions: list[Decision], runs: int) -> tuple[Decision | None, float]:
    """Most common decision and the share of all runs that gave it. A tie at the top is no majority."""
    top = Counter(decisions).most_common(2)
    if not top:
        return None, 0.0
    if len(top) == 2 and top[0][1] == top[1][1]:
        return None, top[0][1] / runs
    return top[0][0], top[0][1] / runs


def aggregate(
    report_id: str,
    cases: list[ExamCase],
    runs: list[AgentRun],
    scores: list[JudgeScore],
    runs_per_arm: int,
    graph_version: int,
    new_probe_ids: list[str],
) -> ExamReport:
    rows, per_arm = [], {}
    stats: dict[Arm, dict[str, float]] = {a: {"agree": 0, "traps": 0, "blocked": 0} for a in ARMS}
    for c in cases:
        assert c.expert_label
        row: dict[str, object] = {
            "case_id": c.id,
            "trap_type": c.trap_type,
            "expert_decision": c.expert_label.decision,
        }
        for arm in ARMS:
            rs = [r for r in runs if r.case_id == c.id and r.arm == arm]
            maj, stab = majority(
                [r.output.decision for r in rs if r.output and not r.blocked], runs_per_arm
            )
            agree = maj == c.expert_label.decision
            totals = [s.total for s in scores if s.case_id == c.id and s.arm == arm]
            row |= {
                f"{arm}_majority": maj,
                f"{arm}_agree": agree,
                f"{arm}_stability": round(stab, 3),
                f"{arm}_judge_mean": round(fmean(totals), 3) if totals else 0.0,
            }
            stats[arm]["agree"] += agree
            stats[arm]["traps"] += agree and c.trap_type != "none"
            stats[arm]["blocked"] += sum(r.blocked for r in rs)
        rows.append(CaseRow.model_validate(row))
    for arm in ARMS:
        totals = [s.total for s in scores if s.arm == arm]
        per_arm[arm] = ArmSummary(
            agreement_pct=round(100 * stats[arm]["agree"] / len(cases), 1) if cases else 0.0,
            judge_mean=round(fmean(totals), 2) if totals else 0.0,
            traps_correct=int(stats[arm]["traps"]),
            blocked_runs=int(stats[arm]["blocked"]),
        )
    return ExamReport(
        id=report_id,
        created_at=datetime.now(UTC),
        n_cases=len(cases),
        runs_per_arm=runs_per_arm,
        per_arm=per_arm,
        cases=rows,
        new_probe_ids=new_probe_ids,
        graph_version=graph_version,
    )


def miss_question(c: ExamCase) -> str:
    """Describes the situation (vendor type, amount, email cue), never the expected decision."""
    inv = c.invoice
    vtype = c.vendor_master_row.get("type", "")
    who = f"{inv.vendor_name} ({vtype} vendor)" if vtype else inv.vendor_name
    email = ", with an email about it" if c.emails else ""  # email text is untrusted: never quoted
    po = "no PO" if not inv.po_number else f"PO {inv.po_number}"
    return f"{who} sends {inv.invoice_no} for ₹{inv.amount_inr:,.0f}, {po}{email}. What do you do, and why?"


async def run_exam(store: Store, report_id: str, runs_per_arm: int) -> ExamReport:
    """Run both arms on every labelled case, judge, aggregate, store exam_reports/{report_id}."""
    cases = [c for c in await store.exam_cases.list() if c.expert_label]
    graph = await store.get_graph()
    if not cases or graph is None:
        raise HTTPException(409, "The exam needs labelled cases and a decision graph.")
    sop = await store.current_sop()
    runs = await arms.run_all(store, report_id, cases, sop, graph, runs_per_arm)
    for r in runs:
        await store.agent_runs.put(r)
    by_id = {c.id: c for c in cases}
    gate = asyncio.Semaphore(arms.CONCURRENCY)

    async def scored(r: AgentRun) -> JudgeScore | None:
        async with gate:
            try:
                return await judge.score(by_id[r.case_id], r)
            except Exception:
                log.exception("judging %s failed; left out of the judge means", r.id)
                return None

    scores = [s for s in await asyncio.gather(*(scored(r) for r in runs)) if s]
    for s in scores:
        await store.judge_scores.put(s)

    report = aggregate(report_id, cases, runs, scores, runs_per_arm, graph.version, [])
    asked = {p.question for p in await store.probes.list() if p.source == "exam_miss"}
    new_ids = []
    for row in report.cases:
        q = miss_question(by_id[row.case_id])
        if not row.sop_graph_agree and q not in asked:
            p = Probe(
                id=new_id("p"),
                source="exam_miss",
                cdm_type="anomaly",
                question=q,
                created_at=datetime.now(UTC),
            )
            await store.probes.put(p)
            new_ids.append(p.id)
    report = report.model_copy(update={"new_probe_ids": new_ids})
    await store.exam_reports.put(report)
    await store.put_job(report_id, "done")
    return report
