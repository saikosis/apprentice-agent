"""Judge sandbox: redeem the judge code, read the sandbox's state (docs/Judge_Sandbox.md)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app import sandbox
from backend.app.contract import SandboxInfo
from backend.app.routers.auth import CurrentUser, is_admin

router = APIRouter(tags=["sandbox"])


class ResetReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["sample", "empty"]


class JoinReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(max_length=200)


@router.post("/sandbox/join")
async def join(body: JoinReq, user: CurrentUser) -> SandboxInfo:
    return await sandbox.join(user.uid, user.email, body.code)


async def _mine(user: CurrentUser) -> SandboxInfo:
    info = await sandbox.get(user.uid)
    if info is None:
        raise HTTPException(404, "No sandbox for this account yet. Enter the judge code.")
    return info


@router.post("/sandbox/reset")
async def reset(body: ResetReq, user: CurrentUser) -> SandboxInfo:
    """Delete everything in the sandbox, then copy the sample again or leave it empty."""
    await _mine(user)
    await sandbox.reset(user.uid, body.mode)
    return await _mine(user)


@router.delete("/sandbox")
async def delete(user: CurrentUser) -> dict[str, bool]:
    """Delete my sandbox: data, recordings and the redeemed code."""
    await _mine(user)
    await sandbox.delete(user.uid)
    return {"ok": True}


@router.get("/admin/sandboxes")
async def list_sandboxes(user: CurrentUser) -> list[SandboxInfo]:
    if not is_admin(user):
        raise HTTPException(403, "Only an admin can see the judges' sandboxes.")
    return await sandbox.all_sandboxes()


@router.get("/sandbox")
async def get_sandbox(user: CurrentUser) -> SandboxInfo:
    info = await sandbox.get(user.uid)
    if info is None:
        raise HTTPException(404, "No sandbox for this account yet. Enter the judge code.")
    return info
