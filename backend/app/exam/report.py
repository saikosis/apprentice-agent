"""Aggregate AgentRuns + JudgeScores into an ExamReport."""

from backend.app.store import Store


async def run_exam(store: Store, report_id: str, runs_per_arm: int) -> None:
    """Run both arms on every labelled case, judge, aggregate, store exam_reports/{report_id}."""
    raise NotImplementedError("The exam runner isn't built yet (A6).")
