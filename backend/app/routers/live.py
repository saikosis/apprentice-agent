"""Ephemeral Gemini Live tokens (SPEC §4). The whole Live setup is locked into the token server-side:
the browser only ever holds a one-use token, never the API key."""

import os
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

from fastapi import APIRouter
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from backend.app import domains, errors, gemini, prompts, sandbox
from backend.app.contract import SOP, Scenario
from backend.app.routers.sessions import get_or_404
from backend.app.workspace import LiveStore

router = APIRouter(tags=["live"])

TOKEN_TTL = timedelta(minutes=30)
NEW_SESSION_WINDOW = timedelta(minutes=1)

LOG_DEVIATION = types.FunctionDeclaration(
    name="log_deviation",
    description=(
        "Call ONLY when the expert visibly does something that departs from a numbered SOP rule "
        "(skips a step, approves without a required check, rejects outside the rule). Do not call for "
        "normal steps. Call at most once per work item."
    ),
    behavior=types.Behavior.NON_BLOCKING,
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "sop_rule": types.Schema(
                type=types.Type.STRING, description="SOP section id, e.g. §3.2"
            ),
            "invoice_id": types.Schema(
                type=types.Type.STRING,
                description="Id of the work item visible on screen (invoice, submission, sign-up)",
            ),
            "question": types.Schema(
                type=types.Type.STRING,
                description="One short CDM 'why' question, ≤ 15 words, neutral, no judgment",
            ),
            "timestamp": types.Schema(
                type=types.Type.STRING,
                description="Optional MM:SS if the recording timer is visible",
            ),
        },
        required=["sop_rule", "question"],
    ),
)


class TokenReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    resume_handle: str | None = Field(default=None, max_length=4096)


def live_config(
    sop: SOP, resume_handle: str | None, scenario: Scenario = "ap"
) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=prompts.load("live_system").render(
            **domains.values(scenario, SOP=sop.full_text)
        ),
        tools=[types.Tool(function_declarations=[LOG_DEVIATION])],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(), trigger_tokens=25000
        ),
        session_resumption=types.SessionResumptionConfig(handle=resume_handle),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
            )
        ),
    )


def token_config(
    sop: SOP, resume_handle: str | None, now: datetime, scenario: Scenario = "ap"
) -> types.CreateAuthTokenConfig:
    # No lock_additional_fields: the whole setup comes from the token; browser setup is ignored.
    return types.CreateAuthTokenConfig(
        uses=1,
        expire_time=now + TOKEN_TTL,
        new_session_expire_time=now + NEW_SESSION_WINDOW,
        live_connect_constraints=types.LiveConnectConstraints(
            model=gemini.LIVE_MODEL, config=live_config(sop, resume_handle, scenario)
        ),
    )


@lru_cache
def _client() -> Any:
    return genai.Client(
        api_key=os.environ["GEMINI_API_KEY"], http_options={"api_version": "v1alpha"}
    )


@router.post("/live/token")
async def live_token(body: TokenReq, store: LiveStore) -> dict[str, object]:
    s = await get_or_404(store, body.session_id)
    if not s.live_enabled or s.status not in ("created", "uploading"):
        raise errors.conflict(f"Session {s.id} isn't recording with live questions.")
    now = datetime.now(UTC)
    if store.ws == "sandbox" and (now - s.started_at).total_seconds() > sandbox.LIVE_WINDOW_S:
        raise errors.conflict("Live questions end with the 5 minutes of a sandbox recording.")
    token = await _client().aio.auth_tokens.create(
        config=token_config(await store.current_sop(), body.resume_handle, now, store.scenario)
    )
    return {
        "token": token.name,
        "model": gemini.LIVE_MODEL,
        "expires_at": now + TOKEN_TTL,
        "new_session_expires_at": now + NEW_SESSION_WINDOW,
    }
