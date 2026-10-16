"""Upload recordings to the Gemini Files API."""

import asyncio
import logging
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from google.genai import errors as genai_errors
from google.genai import types

from backend.app import gemini, storage
from backend.app.contract import Session
from backend.app.store import Store

FILE_TTL = timedelta(hours=46)  # Files API keeps uploads 48 h; re-upload a little early
POLL_S = 5
MAX_WAIT_S = 600
log = logging.getLogger(__name__)


async def wait_active(f: types.File, client: Any = None) -> types.File:
    """Poll until the file is ACTIVE (video processing done) or fail after MAX_WAIT_S."""
    c = client or gemini.default_client()
    for _ in range(MAX_WAIT_S // POLL_S):
        if f.state == types.FileState.ACTIVE:
            return f
        if f.state == types.FileState.FAILED:
            raise RuntimeError(f"Gemini couldn't process {f.name}: {f.error}")
        await asyncio.sleep(POLL_S)
        f = await c.aio.files.get(name=f.name or "")
    raise TimeoutError(f"{f.name} still not ACTIVE after {MAX_WAIT_S} s")


async def upload_path(path: str | Path, client: Any = None) -> types.File:
    """A local recording straight to the Files API (laptop runs; the API path goes through GCS)."""
    c = client or gemini.default_client()
    f = await c.aio.files.upload(
        file=str(path), config=types.UploadFileConfig(mime_type="video/webm")
    )
    return await wait_active(f, c)


async def ensure_uploaded(store: Store, session: Session, client: Any = None) -> types.File:
    """The session's recording as an ACTIVE Gemini file, reusing a recent upload."""
    c = client or gemini.default_client()
    fresh = (
        session.gemini_file_uploaded_at
        and datetime.now(UTC) - session.gemini_file_uploaded_at < FILE_TTL
    )
    if session.gemini_file_name and fresh:
        try:
            return await wait_active(await c.aio.files.get(name=session.gemini_file_name), c)
        except (genai_errors.APIError, RuntimeError, TimeoutError) as e:  # expired or gone
            log.info("re-uploading %s: %s", session.id, e)
    if not session.gcs_uri:
        raise RuntimeError(f"Session {session.id} has no recording in storage.")
    # ponytail: Cloud Run's /tmp is RAM; fine for ~10 min recordings (~100 MB) on 1 Gi. Stream if longer.
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"{session.id}.webm"
        await storage.download(session.gcs_uri, str(path))
        f = await upload_path(path, c)
    await store.sessions.put(
        session.model_copy(
            update={"gemini_file_name": f.name, "gemini_file_uploaded_at": datetime.now(UTC)}
        )
    )
    return f
