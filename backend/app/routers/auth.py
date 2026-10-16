"""Firebase ID token check. Every router except demo depends on `require_user`."""

import os
import threading
from dataclasses import dataclass
from typing import Annotated, Any

import firebase_admin
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as fb_auth
from firebase_admin.exceptions import FirebaseError

router = APIRouter(tags=["auth"])
_bearer = HTTPBearer(auto_error=False)
_init_lock = threading.Lock()  # _verify runs in threadpool workers


@dataclass(frozen=True)
class User:
    uid: str
    email: str
    email_verified: bool = False


def _verify(token: str) -> dict[str, Any]:
    with _init_lock:
        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(options={"projectId": os.getenv("GCP_PROJECT")})
    return fb_auth.verify_id_token(token)  # type: ignore[no-any-return]


async def require_user(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if cred is None:
        raise HTTPException(401, "Sign in first.", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = await run_in_threadpool(_verify, cred.credentials)
    except (ValueError, FirebaseError) as e:
        raise HTTPException(401, "Sign-in expired or invalid. Sign in again.") from e
    return User(
        uid=claims["uid"],
        email=claims.get("email", ""),
        email_verified=bool(claims.get("email_verified")),
    )


async def optional_user(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    """For routes that also serve the public demo: a missing or stale token means anonymous."""
    try:
        return await require_user(cred) if cred else None
    except HTTPException:
        return None


def _experts() -> set[str]:
    return {e.strip().lower() for e in os.getenv("EXPERT_EMAIL", "").split(",") if e.strip()}


def is_expert(user: User) -> bool:
    return user.email_verified and user.email.lower() in _experts()


CurrentUser = Annotated[User, Depends(require_user)]
MaybeUser = Annotated[User | None, Depends(optional_user)]


async def require_expert(user: CurrentUser) -> User:
    """The live workspace belongs to the expert: any other Google account is refused (fails closed)."""
    if not _experts():
        raise HTTPException(403, "EXPERT_EMAIL isn't configured on this server.")
    if not is_expert(user):
        raise HTTPException(403, "Only the expert's account can use the live workspace.")
    return user


@router.get("/me")
async def me(user: CurrentUser) -> dict[str, object]:
    return {
        "uid": user.uid,
        "email": user.email,
        "is_demo_expert": is_expert(user),
    }
