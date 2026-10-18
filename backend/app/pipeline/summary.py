"""Plain-language session summary (prompts/summary.md). Display only: never a graph or exam input."""

from backend.app import domains, gemini
from backend.app.contract import SOP, Segment, SessionSummary
from backend.app.pipeline.deviations import segment_for_prompt
from backend.app.safety import armor
from backend.app.store import Store


async def summarise(store: Store, session_id: str, segs: list[Segment], sop: SOP) -> SessionSummary:
    """Written from the screened segments (quarantined text already replaced), then screened itself."""
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "summary",
        [gemini.data("Steps", [segment_for_prompt(s) for s in segs])],
        SessionSummary,
        values=domains.values(store.scenario, SOP=sop.full_text),
    )
    s = out.output
    text = s.summary + "\n" + "\n".join(step for item in s.items for step in item.steps)
    mod = await armor.screen_output(text, "summary", session_id)
    await store.moderation.put(mod)
    result = s.model_copy(
        update={
            "session_id": session_id,
            "prompt_version": out.prompt_ref,
            "moderation_id": mod.id,
            "flagged": mod.match_found,
        }
    )
    await store.put_summary(result)
    return result
