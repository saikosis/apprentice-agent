"""LLM judge, blind to arm (prompts/judge.md). decision_match computed in code."""

import hashlib
from typing import Any

from backend.app import domains, gemini
from backend.app.contract import AgentRun, ExamCase, JudgeScore, Scenario
from backend.app.exam.arms import case_input

WEIGHTS = (0.5, 0.25, 0.25)  # decision, rationale, edge case (SPEC §5)


def total(decision: int, rationale: int, edge: int) -> float:
    return round(WEIGHTS[0] * decision + WEIGHTS[1] * rationale + WEIGHTS[2] * edge, 3)


def judge_view(case: ExamCase, run: AgentRun) -> dict[str, Any]:
    """What the judge sees: no arm, and no graph citations (they would reveal the arm)."""
    assert case.expert_label and run.output
    return {
        "run_id": "run-" + hashlib.sha256(run.id.encode()).hexdigest()[:10],  # run ids name the arm
        "case_id": case.id,
        "case": {**case_input(case), "trap_type": case.trap_type},
        "label": {"decision": case.expert_label.decision, "rationale": case.expert_label.rationale},
        "output": run.output.model_dump(exclude={"cited_nodes", "cited_clips"}),
    }


async def score(case: ExamCase, run: AgentRun, scenario: Scenario = "ap") -> JudgeScore:
    label = case.expert_label
    if label is None:
        raise ValueError(f"case {case.id} has no label")
    if run.output is None or run.blocked:
        why = "blocked by Model Armor" if run.blocked else "no valid output"
        return JudgeScore(
            run_id=run.id,
            case_id=case.id,
            arm=run.arm,
            decision_match=False,
            decision_score=1,
            rationale_consistency=1,
            edge_case_handling=1,
            total=total(1, 1, 1),
            explanation=f"Run {why}; scored as a miss.",
        )
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "judge",
        [gemini.data("Grading input", judge_view(case, run))],
        JudgeScore,
        values=domains.values(scenario, exam=True),
    )
    j = out.output
    return j.model_copy(
        update={
            "run_id": run.id,
            "case_id": case.id,
            "arm": run.arm,
            "decision_match": run.output.decision == label.decision,
            "total": total(j.decision_score, j.rationale_consistency, j.edge_case_handling),
            "hand_checked": False,
            "hand_override_total": None,
        }
    )
