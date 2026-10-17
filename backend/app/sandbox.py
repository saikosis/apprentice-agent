"""Judge sandbox membership (docs/Judge_Sandbox.md): a judge code, redeemed once per Google account."""

import hmac
import os
from datetime import UTC, datetime

from fastapi import HTTPException

from backend.app import store
from backend.app.contract import SandboxInfo


def enabled() -> bool:
    """Off unless SANDBOX_CODE is set; SANDBOX_ENABLED=0 closes it without forgetting the code."""
    return bool(os.getenv("SANDBOX_CODE")) and os.getenv("SANDBOX_ENABLED", "1") != "0"


def _doc(uid: str) -> object:
    return store.default_db().document(f"sandboxes/{uid}")


async def get(uid: str) -> SandboxInfo | None:
    snap = await _doc(uid).get()  # type: ignore[attr-defined]
    return SandboxInfo.model_validate(snap.to_dict()) if snap.exists else None


async def join(uid: str, email: str, code: str) -> SandboxInfo:
    if not enabled():
        raise HTTPException(403, "The judge sandbox is closed.")
    expected = os.environ["SANDBOX_CODE"].encode()
    if not hmac.compare_digest(code.strip().encode(), expected):
        raise HTTPException(403, "That judge code isn't right.")
    if existing := await get(uid):
        return existing
    info = SandboxInfo(uid=uid, email=email, created_at=datetime.now(UTC))
    await _doc(uid).set(info.model_dump(mode="json"))  # type: ignore[attr-defined]
    return info
