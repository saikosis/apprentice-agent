"""Successor exam: generate cases, label them, run both arms, read reports (SPEC §3, §5).

Labels are the expert's own and go back to the expert's UI; only the judge sees them in the pipeline.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app import errors, jobs, sandbox
from backend.app.contract import AgentRun, Decision, ExamCase, ExamReport, ExpertLabel
from backend.app.exam import report, scenarios
from backend.app.routers.auth import CurrentUser
from backend.app.store import new_id
from backend.app.workspace import LiveStore, ReadStore

router = APIRouter(tags=["exam"])


class GenerateReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    n_generated: int = Field(default=8, ge=1, le=20)
    heldout_session_ids: list[str] = Field(min_length=1, max_length=2)


class LabelReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Decision
    rationale: str = Field(min_length=1, max_length=500)


class RunReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runs_per_arm: int = Field(default=3, ge=1, le=5)


@router.post("/exam/generate")
async def generate(body: GenerateReq, store: LiveStore) -> list[ExamCase]:
    await sandbox.charge(store, "case_generations")
    for sid in body.heldout_session_ids:
        s = await store.sessions.get(sid)
        if s is None or s.kind != "heldout" or s.status != "processed":
            raise errors.conflict(f"Session {sid} isn't an analysed held-out session.")
    return await scenarios.generate(store, body.heldout_session_ids, body.n_generated)


@router.get("/exam/cases")
async def list_cases(store: ReadStore) -> list[ExamCase]:
    return sorted(await store.exam_cases.list(), key=lambda c: c.id)


@router.put("/exam/cases/{case_id}/label")
async def label(case_id: str, body: LabelReq, user: CurrentUser, store: LiveStore) -> ExamCase:
    case = await store.exam_cases.get(case_id)
    if case is None:
        raise HTTPException(404, f"Exam case {case_id} not found.")
    lbl = ExpertLabel(
        decision=body.decision,
        rationale=body.rationale.strip(),
        labeled_by=user.email or user.uid,
        labeled_at=datetime.now(UTC),
    )
    return await store.exam_cases.put(case.model_copy(update={"expert_label": lbl}))


@router.post("/exam/run", status_code=202)
async def run(body: RunReq, store: LiveStore) -> dict[str, str]:
    await sandbox.charge(store, "exam_runs")
    if not any(c.expert_label for c in await store.exam_cases.list()):
        raise errors.conflict("Label at least one exam case before running the exam.")
    report_id = new_id("r")
    await store.put_job(report_id, "running")

    async def failed(e: Exception) -> None:
        await store.put_job(report_id, "failed", str(getattr(e, "detail", e))[:300])

    jobs.spawn(f"exam {report_id}", report.run_exam(store, report_id, body.runs_per_arm), failed)
    return {"report_id": report_id}


@router.get("/exam/report/{report_id}")
async def get_report(report_id: str, store: ReadStore) -> ExamReport:
    r = await store.exam_reports.get(report_id)
    if r is None:
        job = await store.get_job(report_id)
        if job and job["status"] == "failed":
            raise HTTPException(500, f"The exam run failed: {job['error']}")
        raise HTTPException(404, f"Report {report_id} isn't ready.")
    return r


@router.get("/exam/reports/latest")
async def latest_report(store: ReadStore) -> ExamReport:
    reports = await store.exam_reports.list()
    if not reports:
        raise HTTPException(404, "No exam has run yet.")
    return max(reports, key=lambda r: r.created_at)


@router.get("/exam/runs")
async def list_runs(
    store: ReadStore, case_id: str | None = None, report_id: str | None = None
) -> list[AgentRun]:
    runs = await store.agent_runs.list()
    return sorted(
        (
            r
            for r in runs
            if (case_id is None or r.case_id == case_id)
            and (report_id is None or r.id.startswith(f"{report_id}-"))
        ),
        key=lambda r: (r.case_id, r.arm, r.run_index),
    )
