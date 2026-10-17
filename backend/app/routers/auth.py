"""Firebase ID token check. Every router except demo depends on `require_user`."""

import os
import threading
from dataclasses import dataclass
from typing import Annotated, Any, Literal

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


def _dev_user() -> User | None:
    """Laptop-only sign-in bypass so the UI can run against the real backend before Firebase exists.
    Needs LOCAL_DB (the file-backed store) and DEV_USER_EMAIL; never active on Cloud Run (K_SERVICE)."""
    email = os.getenv("DEV_USER_EMAIL")
    if email and os.getenv("LOCAL_DB") and not os.getenv("K_SERVICE"):
        return User(uid="dev", email=email, email_verified=True)
    return None


async def require_user(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if cred is None and (dev := _dev_user()):
        return dev
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
    if cred is None:
        return _dev_user()  # None everywhere except a laptop run with the dev bypass
    try:
        return await require_user(cred)
    except HTTPException:
        return None


def _experts() -> set[str]:
    return {e.strip().lower() for e in os.getenv("EXPERT_EMAIL", "").split(",") if e.strip()}


def is_admin(user: User) -> bool:
    """ADMIN_UIDS: may seed the demo and read any judge's sandbox."""
    return user.uid in {u.strip() for u in os.getenv("ADMIN_UIDS", "").split(",") if u.strip()}


def is_expert(user: User) -> bool:
    return user.email_verified and user.email.lower() in _experts()


CurrentUser = Annotated[User, Depends(require_user)]
MaybeUser = Annotated[User | None, Depends(optional_user)]
Role = Literal["expert", "judge", "none"]


async def role_of(user: User) -> Role:
    """The expert owns the live workspace; a judge (code redeemed) owns a private sandbox."""
    from backend.app import sandbox

    if is_expert(user):
        return "expert"
    return "judge" if await sandbox.get(user.uid) else "none"


async def current_role(user: CurrentUser) -> Role:
    return await role_of(user)


CurrentRole = Annotated[Role, Depends(current_role)]  # cached per request by FastAPI


async def require_member(user: CurrentUser, role: CurrentRole) -> Role:
    """Every data route: the expert or a judge (admins may read). Anyone else is asked for the judge
    code (fails closed); workspace.py still gives an admin-only account no workspace to write to."""
    if role == "none" and not is_admin(user):
        raise HTTPException(
            403, "This account isn't the expert's. Enter the judge code to use Apprentice."
        )
    return role


@router.get("/me")
async def me(user: CurrentUser, role: CurrentRole) -> dict[str, object]:
    return {
        "uid": user.uid,
        "email": user.email,
        "is_demo_expert": role == "expert",
        "role": role,
        "is_admin": is_admin(user),
    }
