"""Recording upload: signed PUT straight to Cloud Storage, then finalize (SPEC §3)."""

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from backend.app import errors, storage
from backend.app.contract import Session
from backend.app.routers.sessions import get_or_404
from backend.app.store import LiveStore

router = APIRouter(tags=["uploads"])

UPLOAD_URL_MINUTES = 15
# ~60 min of tab video at Chrome's default bitrate, with room to spare
MAX_UPLOAD_BYTES = 2 * 1024**3


class UploadReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_type: Literal["video/webm"]
    size_bytes: int = Field(gt=0, le=MAX_UPLOAD_BYTES)


class FinalizeReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_s: int = Field(ge=0, le=6 * 3600)
    ended_at: datetime


@router.post("/sessions/{session_id}/upload-url")
async def upload_url(session_id: str, body: UploadReq, store: LiveStore) -> dict[str, object]:
    s = await get_or_404(store, session_id)
    if s.status not in ("created", "uploading"):
        raise errors.conflict(f"Session {session_id} is {s.status}; it already has a recording.")
    gcs_uri = storage.object_uri(store.root_name, session_id)
    url = await storage.signed_url(gcs_uri, "PUT", UPLOAD_URL_MINUTES, body.content_type)
    await store.sessions.put(s.model_copy(update={"status": "uploading", "gcs_uri": gcs_uri}))
    return {
        "url": url,
        "method": "PUT",
        "headers": {"Content-Type": body.content_type},
        "gcs_uri": gcs_uri,
        "expires_at": datetime.now(UTC) + timedelta(minutes=UPLOAD_URL_MINUTES),
    }


@router.post("/sessions/{session_id}/finalize")
async def finalize(session_id: str, body: FinalizeReq, store: LiveStore) -> Session:
    s = await get_or_404(store, session_id)
    if s.status != "uploading" or not s.gcs_uri:
        raise errors.conflict(f"Session {session_id} is {s.status}; request an upload URL first.")
    if not await storage.exists(s.gcs_uri):
        raise errors.conflict("The recording hasn't arrived in storage yet. Retry the upload.")
    done = s.model_copy(
        update={"status": "uploaded", "duration_s": body.duration_s, "ended_at": body.ended_at}
    )
    return await store.sessions.put(done)
