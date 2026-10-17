"""Variant discovery across sessions, one call (prompts/variants.md)."""

import logging
from datetime import UTC, datetime

from backend.app import domains, gemini, jobs
from backend.app.contract import SOP, ObservedWorkflow, Variant, VariantList
from backend.app.pipeline import probes
from backend.app.pipeline.deviations import segment_for_prompt
from backend.app.safety import armor
from backend.app.store import Store

log = logging.getLogger(__name__)


def normalize(raw: list[Variant], known: dict[str, str]) -> list[Variant]:
    """`known` maps deviation id -> session id. Unknown ids are dropped; counts come from code.
    A pattern is the same departure at least twice, in any number of sessions."""
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
    async with jobs.lock(f"variants:{store.root}"):
        return await _discover(store)


async def _discover(store: Store) -> list[Variant]:
    sessions = [
        s for s in await store.sessions.list() if s.status == "processed" and s.kind == "training"
    ]
    if not sessions:
        log.info("variants: no processed training sessions yet")
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
    try:  # display only, and never a reason to lose the patterns
        await observe(store, payload, sop)
    except Exception:
        log.exception("observed workflow failed")
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


async def observe(store: Store, sessions: list[dict[str, object]], sop: SOP) -> ObservedWorkflow:
    """The expert's actual procedure, step by step, marked against the SOP. Screened; display only."""
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "observed_workflow",
        [gemini.data("Sessions", sessions)],
        ObservedWorkflow,
        values=domains.values(store.scenario, SOP=sop.full_text),
    )
    w = out.output
    mod = await armor.screen_output("\n".join(st.text for st in w.steps), "workflow", store.root)
    await store.moderation.put(mod)
    result = w.model_copy(
        update={
            "built_at": datetime.now(UTC),
            "prompt_version": out.prompt_ref,
            "moderation_id": mod.id,
            "flagged": mod.match_found,
        }
    )
    await store.put_observed_workflow(result)
    return result
