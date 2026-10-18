"""Segmenter: video -> SegmentList (prompts/segmenter.md), and the per-session batch run."""

import asyncio
import logging
from typing import Any

from google.genai import types

from backend.app import domains, gemini
from backend.app.contract import SOP, Segment, SegmentList, Session
from backend.app.safety import armor
from backend.app.store import Store

ARMOR_CONCURRENCY = 8  # SPEC §6
log = logging.getLogger(__name__)


def video_part(f: types.File) -> types.Part:
    return types.Part(
        file_data=types.FileData(file_uri=f.uri, mime_type=f.mime_type),
        video_metadata=types.VideoMetadata(fps=1),
    )


async def screen(store: Store, segments: list[Segment]) -> list[Segment]:
    """Model Armor on each segment's text; flagged ones are quarantined (kept, never fed to the graph)."""
    gate = asyncio.Semaphore(ARMOR_CONCURRENCY)

    async def one(s: Segment) -> Segment:
        text = f"{s.on_screen_text}\n{s.transcript_excerpt}".strip()
        if not text:
            return s
        async with gate:
            m = await armor.screen_input(text, "segment", s.id)
        await store.moderation.put(m)
        return s.model_copy(update={"moderation_id": m.id, "quarantined": m.match_found})

    return list(await asyncio.gather(*(one(s) for s in segments)))


async def segment(store: Store, session: Session, video: Any, sop: SOP) -> list[Segment]:
    """`video` is an ACTIVE Gemini file (or any Part-able content in tests)."""
    part = video_part(video) if isinstance(video, types.File) else video
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "segmenter",
        [part, f"Session id: {session.id}"],
        SegmentList,
        values=domains.values(store.scenario, SOP=sop.full_text),
        extra_config={"media_resolution": types.MediaResolution.MEDIA_RESOLUTION_HIGH},
    )
    segs = [
        s.model_copy(
            update={
                "id": f"{session.id}-seg-{i:02d}",
                "session_id": session.id,
                "moderation_id": None,
                "quarantined": False,
            }
        )
        for i, s in enumerate(out.output.segments, start=1)
    ]
    return await store.segments(session.id).replace(await screen(store, segs))


async def process_session(store: Store, session_id: str, video: Any = None) -> None:
    """Whole batch run for one uploaded session: Files API → segment → armor → deviations → probes.

    Called in the background by POST /api/sessions/{id}/process. On success the session is
    `processed`; an exception propagates and the caller marks it `failed`. `video` lets a laptop run
    pass an already-uploaded Gemini file instead of fetching from Cloud Storage.
    """
    from backend.app.pipeline import deviations, files, probes, summary, variants

    session = await store.sessions.get(session_id)
    if session is None:
        raise RuntimeError(f"Session {session_id} disappeared.")
    sop = await store.current_sop()
    video = video or await files.ensure_uploaded(store, session)
    segs = await segment(store, session, video, sop)
    devs = await deviations.detect(
        store, session, segs, sop, await store.get_sheet_diff(session_id)
    )
    await probes.for_deviations(store, devs, segs, sop)
    try:  # display only: a failed summary never fails the session
        await summary.summarise(store, session_id, segs, sop)
    except Exception:
        log.exception("summary for %s failed", session_id)
    cur = await store.sessions.get(session_id) or session
    await store.sessions.put(cur.model_copy(update={"status": "processed", "error": None}))
    try:  # look for patterns after every processed session. Never fails the session.
        await variants.discover(store)
    except Exception:
        log.exception("variant discovery after %s failed", session_id)
