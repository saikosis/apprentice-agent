"""Model Armor screen_input/screen_output -> ModerationResult. docs/SPEC.md §6."""

import asyncio
import hashlib
import logging
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal

from google.api_core.client_options import ClientOptions
from google.cloud import modelarmor_v1

from backend.app.contract import ModerationResult

log = logging.getLogger(__name__)

MA_LOCATION = os.getenv("MA_LOCATION", "asia-south1")
_PROJECT, _NAME = os.getenv("GCP_PROJECT"), os.getenv("MA_TEMPLATE")
TEMPLATE = (
    f"projects/{_PROJECT}/locations/{MA_LOCATION}/templates/{_NAME}" if _PROJECT and _NAME else ""
)

TargetKind = Literal["segment", "probe_answer", "exam_input", "agent_output", "email"]
# sha256(direction + text) -> (match_found, filters). ponytail: per-process, unbounded; fine for a demo.
_cache: dict[str, tuple[bool, dict[str, str]]] = {}


@lru_cache
def _default_client() -> Any:
    return modelarmor_v1.ModelArmorAsyncClient(
        client_options=ClientOptions(api_endpoint=f"modelarmor.{MA_LOCATION}.rep.googleapis.com")
    )


def _filters(res: modelarmor_v1.SanitizationResult) -> dict[str, str]:
    out = {}
    for name, fr in res.filter_results.items():
        for field in fr._pb.DESCRIPTOR.fields:
            if fr._pb.HasField(field.name):
                sub = getattr(fr, field.name)
                state = (
                    sub.inspect_result.match_state
                    if field.name == "sdp_filter_result"
                    else sub.match_state
                )
                out[name] = modelarmor_v1.FilterMatchState(state).name
    return out


async def _screen(
    direction: str, text: str, kind: TargetKind, target_id: str, client: Any
) -> ModerationResult:
    def result(match: bool, filters: dict[str, str], skipped: bool = False) -> ModerationResult:
        return ModerationResult(
            id=f"mod-{uuid.uuid4().hex[:12]}",
            target_kind=kind,
            target_id=target_id,
            template=TEMPLATE or "unconfigured",
            match_found=match,
            filters=filters,
            skipped=skipped,
            blocked=match,
            checked_at=datetime.now(UTC),
        )

    key = hashlib.sha256(f"{direction}\0{text}".encode()).hexdigest()
    if key in _cache:
        return result(*_cache[key])
    if not TEMPLATE:
        log.warning("Model Armor not configured; %s %s not screened", kind, target_id)
        return result(False, {}, skipped=True)
    client = client or _default_client()
    item = modelarmor_v1.DataItem(text=text)
    try:
        if direction == "in":
            resp = await client.sanitize_user_prompt(
                request=modelarmor_v1.SanitizeUserPromptRequest(
                    name=TEMPLATE, user_prompt_data=item
                )
            )
        else:
            resp = await client.sanitize_model_response(
                request=modelarmor_v1.SanitizeModelResponseRequest(
                    name=TEMPLATE, model_response_data=item
                )
            )
    except Exception:  # SPEC §6: treat as skipped (not flagged), but log it
        log.exception("Model Armor call failed for %s %s", kind, target_id)
        return result(False, {}, skipped=True)
    res = resp.sanitization_result
    _cache[key] = (
        res.filter_match_state == modelarmor_v1.FilterMatchState.MATCH_FOUND,
        _filters(res),
    )
    return result(*_cache[key])


async def screen_input(
    text: str, kind: TargetKind, target_id: str, *, client: Any = None
) -> ModerationResult:
    return await _screen("in", text, kind, target_id, client)


async def screen_output(
    text: str, kind: TargetKind, target_id: str, *, client: Any = None
) -> ModerationResult:
    return await _screen("out", text, kind, target_id, client)


async def keep_clean[X](
    store: Any, items: list[X], text: Callable[[X], str], kind: TargetKind
) -> list[X]:
    """Screen each item's text (8 at a time, results stored) and return only the unflagged items."""
    gate = asyncio.Semaphore(8)

    async def ok(x: X) -> bool:
        async with gate:
            m = await screen_input(text(x), kind, str(getattr(x, "id", "")))
        await store.moderation.put(m)
        return not m.match_found

    flags = await asyncio.gather(*(ok(x) for x in items))
    return [x for x, good in zip(items, flags, strict=True) if good]
