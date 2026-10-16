"""Gemini client, model IDs, and `structured(model, prompt_id, parts, schema)` (AGENTS.md)."""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from backend.app import prompts

LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
FLASH_MODEL = os.getenv("FLASH_MODEL", "gemini-3.8-flash")
PRO_MODEL = os.getenv("PRO_MODEL", "gemini-3.1-pro-preview")

log = logging.getLogger(__name__)


class StructuredOutputError(RuntimeError):
    """The model returned output that failed schema validation twice."""


@dataclass(frozen=True)
class Structured[T: BaseModel]:
    output: T
    prompt_ref: str  # "prompt_id@version", stored on whatever is built from `output`
    model: str


@lru_cache
def default_client() -> genai.Client:
    # Server-side only (AGENTS.md): the key comes from Secret Manager via env.
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


async def structured[T: BaseModel](
    model: str,
    prompt_id: str,
    parts: list[Any],
    schema: type[T],
    *,
    values: dict[str, str] | None = None,
    client: Any = None,
) -> Structured[T]:
    """One batch call: prompt as system instruction, `parts` as contents, JSON out, validated.

    The schema goes in as JSON Schema (`response_json_schema`): the SDK's `response_schema`
    path rejects the contract's `dict[str, str]` fields in Developer API mode.
    """
    prompt = prompts.load(prompt_id)
    if prompt.output_schema != schema.__name__:
        raise ValueError(f"{prompt.ref} declares {prompt.output_schema}, got {schema.__name__}")
    config = types.GenerateContentConfig(
        system_instruction=prompt.render(**(values or {})),
        response_mime_type="application/json",
        response_json_schema=schema.model_json_schema(),
        thinking_config=(
            types.ThinkingConfig(thinking_level=types.ThinkingLevel(prompt.thinking_level.upper()))
            if prompt.thinking_level != "none"
            else None
        ),
    )
    models = (client or default_client()).aio.models
    contents = list(parts)
    for attempt in (1, 2):
        resp = await models.generate_content(model=model, contents=contents, config=config)
        try:
            return Structured(schema.model_validate_json(resp.text or ""), prompt.ref, model)
        except ValidationError as e:
            log.warning("%s attempt %d failed validation: %s", prompt.ref, attempt, e)
            error = e
            contents = [
                *parts,
                f"Your previous reply failed validation:\n{e}\nReturn JSON matching the schema.",
            ]
    raise StructuredOutputError(f"{prompt.ref} on {model}: {error}")
