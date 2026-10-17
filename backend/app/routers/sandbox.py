"""Judge sandbox: redeem the judge code, read the sandbox's state (docs/Judge_Sandbox.md)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app import sandbox
from backend.app.contract import SandboxInfo
from backend.app.routers.auth import CurrentUser

router = APIRouter(tags=["sandbox"])


class JoinReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(max_length=200)


@router.post("/sandbox/join")
async def join(body: JoinReq, user: CurrentUser) -> SandboxInfo:
    return await sandbox.join(user.uid, user.email, body.code)


@router.get("/sandbox")
async def get_sandbox(user: CurrentUser) -> SandboxInfo:
    info = await sandbox.get(user.uid)
    if info is None:
        raise HTTPException(404, "No sandbox for this account yet. Enter the judge code.")
    return info
