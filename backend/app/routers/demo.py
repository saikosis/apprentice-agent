"""Public routes: the demo bundle and recording playback; plus the admin-only demo seed (SPEC §3, §8)."""

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.app import storage
from backend.app.contract import (
    SOP,
    AgentRun,
    DecisionGraph,
    Deviation,
    ExamCase,
    ExamReport,
    JudgeScore,
    ObservedWorkflow,
    Probe,
    ProbeAnswer,
    Scenario,
    Segment,
    Session,
    SessionSummary,
    Variant,
)
from backend.app.routers.auth import CurrentUser, MaybeUser, is_admin, role_of
from backend.app.routers.probes import probe_rows
from backend.app.store import Store, Ws

router = APIRouter(tags=["demo"])

VIDEO_URL_MINUTES = 60


class SeedProbe(Probe):
    answer: ProbeAnswer | None = None


class DemoSeed(BaseModel):
    """fixtures/demo_seed.json, produced by scripts/export_demo.py from a real live run."""

    model_config = ConfigDict(extra="forbid")
    workspace: str = "demo"
    sop: SOP | None = None
    sessions: list[Session]
    segments: dict[str, list[Segment]] = {}
    deviations: dict[str, list[Deviation]] = {}
    summaries: dict[str, SessionSummary] = {}
    variants: list[Variant] = []
    probes: list[SeedProbe] = []
    graph: DecisionGraph | None = None
    observed_workflow: ObservedWorkflow | None = None
    exam_cases: list[ExamCase] = []
    agent_runs: list[AgentRun] = []
    judge_scores: list[JudgeScore] = []
    report: ExamReport | None = None
    clips: dict[str, str] = {}  # session id -> gs:// uri, when it differs from session.gcs_uri


@router.get("/demo/bundle")
async def bundle(scenario: Scenario = "ap") -> dict[str, object]:
    store = Store("demo", scenario=scenario)
    sessions = await store.sessions.list()
    (
        (segs, devs, sums),
        (variants, probes, graph, reports),
        (cases, runs, observed),
    ) = await asyncio.gather(
        asyncio.gather(
            asyncio.gather(*(store.segments(s.id).list() for s in sessions)),
            asyncio.gather(*(store.deviations(s.id).list() for s in sessions)),
            asyncio.gather(*(store.get_summary(s.id) for s in sessions)),
        ),
        asyncio.gather(
            store.variants.list(),
            probe_rows(store),
            store.get_graph(),
            store.exam_reports.list(),
        ),
        asyncio.gather(
            store.exam_cases.list(), store.agent_runs.list(), store.get_observed_workflow()
        ),
    )
    report = max(reports, key=lambda r: r.created_at) if reports else None
    return {
        "sessions": sorted(sessions, key=lambda s: s.started_at, reverse=True),
        "segments": {s.id: x for s, x in zip(sessions, segs, strict=True)},
        "deviations": {s.id: x for s, x in zip(sessions, devs, strict=True)},
        "summaries": {s.id: x for s, x in zip(sessions, sums, strict=True) if x},
        "variants": variants,
        "probes": probes,
        "graph": graph,
        "observed_workflow": observed,
        "report": report,
        # the report table's cases (labels included, as in the seed) and that report's agent runs,
        # so the demo can show both agents' reasoning side by side
        "exam_cases": sorted(cases, key=lambda c: c.id),
        "agent_runs": [r for r in runs if report and r.id.startswith(f"{report.id}-")],
    }


@router.get("/sessions/{session_id}/video-url")
async def video_url(
    session_id: str,
    user: MaybeUser,
    ws: Ws | None = None,
    scenario: Scenario = "ap",
    uid: str | None = None,
) -> dict[str, str]:
    """Signed GET, 1 h. Demo recordings are public; the caller's own workspace (the expert's live one, a
    judge's sandbox) needs their sign-in. Without ?ws=, own workspace first and demo as a fallback.
    """
    role = await role_of(user) if user else "none"
    own: list[Store] = []
    if ws == "sandbox" and uid and user and is_admin(user):  # admin viewing a judge's sandbox
        own = [Store("sandbox", uid=uid, scenario=scenario)]
    elif ws != "demo" and role == "expert":
        own = [Store("live", scenario=scenario)]
    elif ws != "demo" and role == "judge" and user:
        own = [Store("sandbox", uid=user.uid, scenario=scenario)]
    demo_store = [Store("demo", scenario=scenario)] if ws in (None, "demo") else []
    for store in [*own, *demo_store]:
        s = await store.sessions.get(session_id)
        if s and s.gcs_uri and s.status not in ("created", "uploading"):
            return {"url": await storage.signed_url(s.gcs_uri, "GET", VIDEO_URL_MINUTES)}
    raise HTTPException(404, f"No recording for session {session_id}.")


async def load_seed(store: Store, seed: DemoSeed) -> None:
    # ponytail: overwrites by id and never deletes, so re-seeding with fewer docs leaves old ones.
    if seed.sop:
        await store.sop.put(seed.sop)
    for s in seed.sessions:
        uri = seed.clips.get(s.id)
        await store.sessions.put(
            s.model_copy(update={"workspace": "demo", **({"gcs_uri": uri} if uri else {})})
        )
    for sid, segs in seed.segments.items():
        for seg in segs:
            await store.segments(sid).put(seg)
    for sid, devs in seed.deviations.items():
        for d in devs:
            await store.deviations(sid).put(d)
    for summary in seed.summaries.values():
        await store.put_summary(summary)
    for v in seed.variants:
        await store.variants.put(v)
    for sp in seed.probes:
        await store.probes.put(Probe.model_validate(sp.model_dump(exclude={"answer"})))
        if sp.answer:
            await store.probes.set_answer(sp.answer)
    if seed.graph:
        await store.put_graph(seed.graph)
    if seed.observed_workflow:
        await store.put_observed_workflow(seed.observed_workflow)
    for c in seed.exam_cases:
        await store.exam_cases.put(c)
    for r in seed.agent_runs:
        await store.agent_runs.put(r)
    for j in seed.judge_scores:
        await store.judge_scores.put(j)
    if seed.report:
        await store.exam_reports.put(seed.report)


class SeedReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bundle: DemoSeed


@router.post("/admin/seed-demo")
async def seed_demo(body: SeedReq, user: CurrentUser, scenario: Scenario = "ap") -> dict[str, bool]:
    if not is_admin(user):
        raise HTTPException(403, "Only an admin can seed the demo workspace.")
    await load_seed(Store("demo", allow_demo_writes=True, scenario=scenario), body.bundle)
    return {"ok": True}
