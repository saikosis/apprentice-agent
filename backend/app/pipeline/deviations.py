"""Deviation detector + live/batch dedup (prompts/deviations.md)."""

from backend.app import domains, gemini, ts
from backend.app.contract import SOP, Deviation, DeviationList, Segment, Session, SheetDiff
from backend.app.store import Store

DEDUP_WINDOW_S = 20  # SPEC §0
QUARANTINED = "[withheld: flagged by Model Armor]"


def dedup(batch: list[Deviation], live: list[Deviation]) -> list[Deviation]:
    """A batch deviation is the same moment as a live one if it has the same SOP rule within 20 s,
    or the same invoice. Decided in code; the model's own `dedup_of` is only a hint."""
    out = []
    for d in batch:
        twin = next(
            (
                lv
                for lv in live
                if (lv.sop_rule == d.sop_rule and abs(lv.t_seconds - d.t_seconds) <= DEDUP_WINDOW_S)
                or (d.invoice_id is not None and lv.invoice_id == d.invoice_id)
            ),
            None,
        )
        out.append(d.model_copy(update={"dedup_of": twin.id if twin else None}))
    return out


def segment_for_prompt(s: Segment) -> dict[str, object]:
    """Flagged text never reaches a model again; the step itself (action, decision) still does."""
    d = s.model_dump(exclude={"moderation_id"})
    if s.quarantined:
        d["on_screen_text"] = d["transcript_excerpt"] = QUARANTINED
    return d


def normalize(raw: list[Deviation], session_id: str) -> list[Deviation]:
    out = []
    for i, d in enumerate(raw, start=1):
        t = ts.seconds(d.timestamp) if ts.valid(d.timestamp) else max(0, d.t_seconds)
        out.append(
            d.model_copy(
                update={
                    "id": f"{session_id}-dev-{i:02d}",
                    "session_id": session_id,
                    "source": "batch",
                    "t_seconds": t,
                    "timestamp": ts.mmss(t),
                }
            )
        )
    return out


async def detect(
    store: Store, session: Session, segments: list[Segment], sop: SOP, diff: SheetDiff | None
) -> list[Deviation]:
    """Batch deviations for one session, deduped against its live ones; stored alongside them."""
    existing = await store.deviations(session.id).list()
    live = [d for d in existing if d.source == "live"]
    payload = {
        "session_id": session.id,
        "segments": [segment_for_prompt(s) for s in segments],
        "sheet_diff": diff.model_dump() if diff else None,
        "live_deviations": [
            d.model_dump(include={"id", "sop_rule", "timestamp", "t_seconds", "invoice_id"})
            for d in live
        ],
    }
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "deviations",
        [gemini.data("Session", payload)],
        DeviationList,
        values=domains.values(store.scenario, SOP=sop.full_text),
    )
    batch = dedup(normalize(out.output.deviations, session.id), live)
    await store.deviations(session.id).replace([*live, *batch])
    return batch
