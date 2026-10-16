"""CDM probe generation (prompts/probes.md).

Inputs are deviations/variants and the expert's clean answers only. Exam cases (and their labels) are
never read here.
"""

from datetime import UTC, datetime
from typing import Any

from backend.app import gemini, ts
from backend.app.contract import SOP, ClipRef, Deviation, Probe, ProbeList, Segment, Variant
from backend.app.pipeline.deviations import segment_for_prompt
from backend.app.safety import armor
from backend.app.store import Store, new_id

MAX_PER_ITEM = 4
MAX_WORDS = 20


async def clean_answers(store: Store) -> list[dict[str, Any]]:
    """Answered probes whose answer Model Armor did not flag: the only answers any model sees."""
    return [
        {
            "probe_id": p.id,
            "question": p.question,
            "answer": a.text,
            "sop_rule": p.sop_rule,
            "clip": p.clip.model_dump() if p.clip else None,
            "deviation_id": p.deviation_id,
            "variant_id": p.variant_id,
        }
        for p, a in await store.probes.with_answers()
        if a and not (a.moderation and a.moderation.match_found)
    ]


def normalize(raw: list[Probe], items: dict[str, dict[str, Any]]) -> list[Probe]:
    """Keep probes tied to a real item, at most 4 per item and 20 words each; system fields from code."""
    per_item: dict[str, int] = {}
    out = []
    now = datetime.now(UTC)
    for p in raw:
        key = p.deviation_id or p.variant_id
        item = items.get(key or "")
        if (
            item is None
            or len(p.question.split()) > MAX_WORDS
            or per_item.get(key or "", 0) >= MAX_PER_ITEM
        ):
            continue
        per_item[key or ""] = per_item.get(key or "", 0) + 1
        out.append(
            p.model_copy(
                update={
                    "id": new_id("p"),
                    "source": "batch",
                    "status": "open",
                    "created_at": now,
                    "session_id": item.get("session_id"),
                    "clip": ClipRef.model_validate(item["clip"]) if item.get("clip") else None,
                    "sop_rule": p.sop_rule or item.get("sop_rule"),
                    "deviation_id": key if item["kind"] == "deviation" else None,
                    "variant_id": key if item["kind"] == "variant" else None,
                }
            )
        )
    return out


async def _generate(store: Store, items: dict[str, dict[str, Any]], sop: SOP) -> list[Probe]:
    if not items:
        return []
    payload = {"items": list(items.values()), "existing_answers": await clean_answers(store)}
    out = await gemini.structured(
        gemini.FLASH_MODEL,
        "probes",
        [gemini.data("Items", payload)],
        ProbeList,
        values={"SOP": sop.full_text},
    )
    probes = normalize(out.output.probes, items)
    for p in probes:
        await store.probes.put(p)
    return probes


async def for_deviations(
    store: Store, deviations: list[Deviation], segments: list[Segment], sop: SOP
) -> list[Probe]:
    """Probes for new batch deviations (not ones already asked live, nor ones Model Armor flags).

    Re-processing a session replaces its unanswered batch probes instead of adding a second set;
    answered ones are kept (their question and answer still stand on their own)."""
    sessions = {d.session_id for d in deviations}
    for p, a in await store.probes.with_answers():
        if p.source == "batch" and a is None and p.session_id in sessions and p.deviation_id:
            await store.probes.delete(p.id)
    fresh = [d for d in deviations if not d.dedup_of]
    clean = await armor.keep_clean(
        store, fresh, lambda d: f"{d.description}\n{d.question}", "segment"
    )
    items: dict[str, dict[str, Any]] = {}
    for d in clean:
        near = [
            segment_for_prompt(s)
            for s in segments
            if abs(ts.seconds(s.start_ts) - d.t_seconds) <= 60
        ]
        clip = ClipRef(
            session_id=d.session_id, start_ts=d.timestamp, end_ts=ts.mmss(d.t_seconds + 20)
        )
        items[d.id] = {
            "kind": "deviation",
            "id": d.id,
            "session_id": d.session_id,
            "sop_rule": d.sop_rule,
            "description": d.description,
            "invoice_id": d.invoice_id,
            "clip": clip.model_dump(),
            "steps_around_it": near,
        }
    return await _generate(store, items, sop)


async def for_variants(store: Store, variants: list[Variant], sop: SOP) -> list[Probe]:
    items = {
        v.id: {
            "kind": "variant",
            "id": v.id,
            "name": v.name,
            "description": v.description,
            "sop_rule": v.sop_rules[0] if v.sop_rules else None,
            "session_id": None,
            "clip": v.exemplar_clips[0].model_dump() if v.exemplar_clips else None,
        }
        for v in variants
    }
    return await _generate(store, items, sop)
