"""Public routes: the demo bundle and recording playback; plus the admin-only demo seed (SPEC §3, §8)."""

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from backend.app import domains, storage
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


@router.get("/packs/{scenario}/{name}")
async def pack_file(scenario: Scenario, name: str) -> FileResponse:
    """Judges' download pack (synthetic data, public): only the files the quick plan lists."""
    files = domains.load(scenario).quick_plan.get("files", [])
    if name not in files:
        raise HTTPException(404, f"No file {name} for {scenario}.")
    return FileResponse(domains.DOMAINS_DIR / scenario / "files" / name, filename=name)


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


async def export_seed(store: Store) -> DemoSeed:
    """A workspace as a DemoSeed (scripts/export_demo.py, and the sample copied into judges' sandboxes)."""
    sessions = await store.sessions.list()
    reports = await store.exam_reports.list()
    sops = await store.sop.list()
    return DemoSeed(
        workspace="demo",
        sop=max(sops, key=lambda s: s.version) if sops else None,
        sessions=[s.model_copy(update={"workspace": "demo"}) for s in sessions],
        segments={s.id: await store.segments(s.id).list() for s in sessions},
        deviations={s.id: await store.deviations(s.id).list() for s in sessions},
        summaries={s.id: x for s in sessions if (x := await store.get_summary(s.id))},
        variants=await store.variants.list(),
        probes=[
            SeedProbe(**p.model_dump(), answer=a) for p, a in await store.probes.with_answers()
        ],
        graph=await store.get_graph(),
        observed_workflow=await store.get_observed_workflow(),
        exam_cases=await store.exam_cases.list(),
        agent_runs=await store.agent_runs.list(),
        judge_scores=await store.judge_scores.list(),
        report=max(reports, key=lambda r: r.created_at) if reports else None,
        clips={s.id: s.gcs_uri for s in sessions if s.gcs_uri},
    )


async def load_seed(store: Store, seed: DemoSeed) -> None:
    # ponytail: overwrites by id and never deletes, so re-seeding with fewer docs leaves old ones.
    if seed.sop:
        await store.sop.put(seed.sop)
    for s in seed.sessions:
        uri = seed.clips.get(s.id)
        await store.sessions.put(
            s.model_copy(update={"workspace": store.ws, **({"gcs_uri": uri} if uri else {})})
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
