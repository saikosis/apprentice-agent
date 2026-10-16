"""Exam case generator (prompts/scenarios.md)."""

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.app import gemini
from backend.app.contract import ExamCase, ExamCaseList
from backend.app.pipeline.deviations import segment_for_prompt
from backend.app.store import Store

TRAPS = {"consignment_lookalike", "prompt_injection", "duplicate_renumbered"}
# Written by scripts/make_synthetic.py; lives in the backend so the Cloud Run image has it.
VENDOR_MASTER = Path(__file__).with_name("vendor_master.json")
log = logging.getLogger(__name__)


def missing_traps(cases: list[ExamCase]) -> set[str]:
    return TRAPS - {c.trap_type for c in cases if c.origin == "generated"}


def normalize(raw: list[ExamCase]) -> list[ExamCase]:
    """Stable ids and no labels, whatever the model returned."""
    return [
        c.model_copy(update={"id": f"c-{i:02d}", "expert_label": None})
        for i, c in enumerate(raw, start=1)
    ]


async def generate(
    store: Store, heldout_session_ids: list[str], n_generated: int
) -> list[ExamCase]:
    """Write exam cases (labels empty) from the graph and held-out sessions; they replace any old exam."""
    sop = await store.current_sop()
    graph = await store.get_graph()
    if graph is None:
        raise HTTPException(409, "Build the decision graph before generating exam cases.")
    heldout: list[dict[str, Any]] = []
    for sid in heldout_session_ids:
        snap = await store.sheet_snapshots(sid).get(
            f"{sid}-before"
        )  # real invoice rows, if Connect Sheet ran
        heldout.append(
            {
                "session_id": sid,
                "segments": [segment_for_prompt(s) for s in await store.segments(sid).list()],
                "deviations": [d.model_dump() for d in await store.deviations(sid).list()],
                "sheet_rows": [r.model_dump() for r in snap.rows] if snap else [],
            }
        )
    vendors = (
        json.loads(VENDOR_MASTER.read_text(encoding="utf-8")) if VENDOR_MASTER.exists() else []
    )
    payload = {"vendor_master": vendors, "heldout": heldout, "n_generated": n_generated}
    values = {"SOP": sop.full_text, "GRAPH": graph.model_dump_json(), "N": str(n_generated)}
    parts: list[Any] = [gemini.data("Exam inputs", payload)]
    cases: list[ExamCase] = []
    for _ in range(2):  # one retry if a trap type is missing (SPEC §11: never drop the traps)
        out = await gemini.structured(
            gemini.FLASH_MODEL, "scenarios", parts, ExamCaseList, values=values
        )
        cases = normalize(out.output.cases)
        gap = missing_traps(cases)
        if not gap:
            break
        log.warning("scenarios missing traps %s; retrying", gap)
        parts = [
            *parts[:1],
            f"The previous set had no case for these traps: {sorted(gap)}. Include them.",
        ]
    return await store.exam_cases.replace(cases)
