"""Sessions: create, list, detail, process, and live deviations (SPEC §3, §4)."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app import errors, jobs
from backend.app.contract import ClipRef, Deviation, Probe, Segment, Session
from backend.app.pipeline import segment
from backend.app.routers.auth import CurrentUser
from backend.app.store import LiveStore, ReadStore, Store, new_id

router = APIRouter(tags=["sessions"])

PROBE_MIN_INTERVAL_S = 45  # SPEC §0
PROBE_MAX_PER_SESSION = 3


class Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewSession(Req):
    kind: Literal["training", "heldout"]
    live_enabled: bool = True


class LiveDeviation(Req):
    sop_rule: str = Field(min_length=1, max_length=20)
    question: str = Field(min_length=1, max_length=300)
    invoice_id: str | None = Field(default=None, max_length=40)
    t_seconds: int
    model_timestamp: str | None = None


def mmss(seconds: int) -> str:
    m, s = divmod(max(0, seconds), 60)
    return f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m:02d}:{s:02d}"


def ts_seconds(ts: str) -> int:
    """MM:SS or H:MM:SS to seconds. Model-written stamps can be malformed: those sort last."""
    if not _valid_ts(ts):
        return 10**9
    n = 0
    for part in ts.split(":"):
        n = n * 60 + int(part)
    return n


def _now() -> datetime:
    return datetime.now(UTC)


async def get_or_404(store: Store, session_id: str) -> Session:
    s = await store.sessions.get(session_id)
    if s is None:
        raise HTTPException(404, f"Session {session_id} not found.")
    return s


@router.post("/sessions")
async def create_session(body: NewSession, user: CurrentUser, store: LiveStore) -> Session:
    s = Session(
        id=new_id("s"),
        workspace="live",
        expert_uid=user.uid,
        kind=body.kind,
        status="created",
        started_at=datetime.now(UTC),
        live_enabled=body.live_enabled,
    )
    return await store.sessions.put(s)


@router.get("/sessions")
async def list_sessions(store: ReadStore) -> list[Session]:
    return sorted(await store.sessions.list(), key=lambda s: s.started_at, reverse=True)


@router.get("/sessions/{session_id}")
async def session_detail(session_id: str, store: ReadStore) -> dict[str, object]:
    s = await get_or_404(store, session_id)
    segments: list[Segment] = await store.segments(session_id).list()
    deviations: list[Deviation] = await store.deviations(session_id).list()
    return {
        "session": s,
        "segments": sorted(segments, key=lambda x: ts_seconds(x.start_ts)),
        "deviations": sorted(deviations, key=lambda x: x.t_seconds),
        "diff": await store.get_sheet_diff(session_id),
    }


@router.post("/sessions/{session_id}/process", status_code=202)
async def process(session_id: str, store: LiveStore, force: bool = False) -> dict[str, str]:
    """`force=true` restarts a session stuck in `processing` (e.g. the instance died mid-run)."""
    s = await get_or_404(store, session_id)
    allowed = ("uploaded", "failed", "processing") if force else ("uploaded", "failed")
    if s.status not in allowed:
        raise errors.conflict(
            f"Session {session_id} is {s.status}; upload the recording before processing it."
        )
    await store.sessions.put(s.model_copy(update={"status": "processing", "error": None}))

    async def failed(e: Exception) -> None:
        cur = await store.sessions.get(session_id)
        if cur:
            await store.sessions.put(
                cur.model_copy(update={"status": "failed", "error": str(e)[:300]})
            )

    jobs.spawn(f"process {session_id}", segment.process_session(store, session_id), failed)
    return {"session_id": session_id, "status": "processing"}


@router.post("/sessions/{session_id}/deviations")
async def live_deviation(
    session_id: str, body: LiveDeviation, store: LiveStore
) -> dict[str, object]:
    """A `log_deviation` tool call from the Live session, relayed by the browser."""
    async with jobs.lock(f"live:{session_id}"):  # two tool calls at once must not both pass
        return await _live_deviation(session_id, body, store)


async def _live_deviation(session_id: str, body: LiveDeviation, store: Store) -> dict[str, object]:
    s = await get_or_404(store, session_id)
    if not s.live_enabled or s.status not in ("created", "uploading"):
        raise errors.conflict(f"Session {session_id} isn't recording with live questions.")
    t = max(0, body.t_seconds)
    now = _now()
    asked = [
        p for p in await store.probes.list() if p.session_id == session_id and p.source == "live"
    ]
    if len(asked) >= PROBE_MAX_PER_SESSION:
        raise HTTPException(429, f"At most {PROBE_MAX_PER_SESSION} live questions per session.")
    # server clock, not the client's t_seconds
    if any((now - p.created_at).total_seconds() < PROBE_MIN_INTERVAL_S for p in asked):
        raise HTTPException(429, f"At most one live question every {PROBE_MIN_INTERVAL_S} seconds.")

    stamp = (
        body.model_timestamp
        if body.model_timestamp and _valid_ts(body.model_timestamp)
        else mmss(t)
    )
    dev = Deviation(
        id=new_id("d"),
        session_id=session_id,
        source="live",
        sop_rule=body.sop_rule,
        timestamp=stamp,
        t_seconds=t,
        invoice_id=body.invoice_id,
        description=f"Live: possible departure from SOP {body.sop_rule}"
        + (f" on {body.invoice_id}" if body.invoice_id else ""),
        question=body.question,
        confidence=0.7,
    )
    probe = Probe(
        id=new_id("p"),
        session_id=session_id,
        deviation_id=dev.id,
        source="live",
        cdm_type="cue",
        question=body.question,
        sop_rule=body.sop_rule,
        clip=ClipRef(session_id=session_id, start_ts=mmss(t - 10), end_ts=mmss(t + 20)),
        created_at=now,
    )
    await store.deviations(session_id).put(dev)
    await store.probes.put(probe)
    return {"deviation": dev, "probe": probe}


def _valid_ts(ts: str) -> bool:
    parts = ts.split(":")
    return 2 <= len(parts) <= 3 and all(p.isdigit() for p in parts)
