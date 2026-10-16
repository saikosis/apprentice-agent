"""Probes and the expert's answers. Every answer is screened by Model Armor before it is stored."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app import errors, jobs
from backend.app.contract import Probe, ProbeAnswer
from backend.app.safety import armor
from backend.app.store import LiveStore, ReadStore, Store

router = APIRouter(tags=["probes"])
AnswerSource = Literal["voice_live", "typed", "edited"]


class AnswerReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    source: Literal["voice_live", "typed"]


class EditReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)


async def probe_rows(store: Store) -> list[dict[str, object]]:
    """Each probe with its `answer` (or null), oldest first. Shared with the demo bundle."""
    rows = [
        {**p.model_dump(mode="json"), "answer": a.model_dump(mode="json") if a else None}
        for p, a in await store.probes.with_answers()
    ]
    return sorted(rows, key=lambda r: str(r["created_at"]))


@router.get("/probes")
async def list_probes(
    store: ReadStore,
    status: Literal["open", "answered", "skipped"] | None = None,
    session_id: str | None = None,
) -> list[dict[str, object]]:
    return [
        r
        for r in await probe_rows(store)
        if (status is None or r["status"] == status)
        and (session_id is None or r["session_id"] == session_id)
    ]


async def save_answer(
    store: Store, probe_id: str, text: str, source: AnswerSource
) -> dict[str, object]:
    moderation = await armor.screen_input(text, "probe_answer", probe_id)
    await store.moderation.put(moderation)
    answer = ProbeAnswer(
        probe_id=probe_id,
        text=text,
        source=source,
        answered_at=datetime.now(UTC),
        moderation=moderation,
    )
    await store.probes.set_answer(answer)
    probe = await store.probes.get(probe_id)
    return {"probe": probe, "answer": answer}


async def _probe(store: Store, probe_id: str) -> Probe:
    p = await store.probes.get(probe_id)
    if p is None:
        raise HTTPException(404, f"Probe {probe_id} not found.")
    return p


@router.post("/probes/{probe_id}/answer")
async def answer(probe_id: str, body: AnswerReq, store: LiveStore) -> dict[str, object]:
    await _probe(store, probe_id)
    async with jobs.lock(f"answer:{probe_id}"):  # a double submit gets the 409, not an overwrite
        if await store.probes.answer(probe_id):
            raise errors.conflict("This question already has an answer. Edit it instead.")
        return await save_answer(store, probe_id, body.text.strip(), body.source)


@router.patch("/probes/{probe_id}/answer")
async def edit_answer(probe_id: str, body: EditReq, store: LiveStore) -> dict[str, object]:
    await _probe(store, probe_id)
    async with jobs.lock(f"answer:{probe_id}"):
        if not await store.probes.answer(probe_id):
            raise errors.conflict("This question has no answer to edit yet.")
        return await save_answer(store, probe_id, body.text.strip(), "edited")
