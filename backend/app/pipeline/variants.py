"""Variant discovery across sessions, one call (prompts/variants.md)."""

import logging

from backend.app import domains, gemini, jobs
from backend.app.contract import Variant, VariantList
from backend.app.pipeline import probes
from backend.app.pipeline.deviations import segment_for_prompt
from backend.app.store import Store

MIN_SESSIONS = 3
log = logging.getLogger(__name__)


def normalize(raw: list[Variant], known: dict[str, str]) -> list[Variant]:
    """`known` maps deviation id -> session id. Unknown ids are dropped; counts come from code."""
    out = []
    for i, v in enumerate(raw, start=1):
        devs = [d for d in dict.fromkeys(v.deviation_ids) if d in known]
        sessions = list(dict.fromkeys(known[d] for d in devs))
        if len(devs) < 2:
            continue
        clips = [c for c in v.exemplar_clips if c.session_id in sessions][:2]
        out.append(
            v.model_copy(
                update={
                    "id": "var-"
                    + (
                        "".join(ch if ch.isalnum() else "-" for ch in v.name.lower()).strip("-")[
                            :48
                        ]
                        or str(i)
                    ),
                    "deviation_ids": devs,
                    "session_ids": sessions,
                    "frequency": len(devs),
                    "exemplar_clips": clips,
                }
            )
        )
    return out


async def discover(store: Store) -> list[Variant]:
    """One call over all processed sessions; replaces the variants; probes the newly found ones.
    Serialised: two sessions finishing together must not both probe the same new variants."""
    async with jobs.lock(f"variants:{store.ws}"):
        return await _discover(store)


async def _discover(store: Store) -> list[Variant]:
    sessions = [
        s for s in await store.sessions.list() if s.status == "processed" and s.kind == "training"
    ]
    if len(sessions) < MIN_SESSIONS:
        log.info("variants: %d processed training sessions, need %d", len(sessions), MIN_SESSIONS)
        return []
    sop = await store.current_sop()
    payload: list[dict[str, object]] = []
    known: dict[str, str] = {}
    for s in sessions:
        devs = await store.deviations(s.id).list()
        known |= {d.id: s.id for d in devs}
        payload.append(
            {
                "session_id": s.id,
                "segments": [segment_for_prompt(x) for x in await store.segments(s.id).list()],
                "deviations": [d.model_dump() for d in devs],
            }
        )
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "variants",
        [gemini.data("Sessions", payload)],
        VariantList,
        values=domains.values(store.scenario, SOP=sop.full_text),
    )
    before = {v.name.lower() for v in await store.variants.list()}
    found = await store.variants.replace(normalize(out.output.variants, known))
    await probes.for_variants(store, [v for v in found if v.name.lower() not in before], sop)
    return found
