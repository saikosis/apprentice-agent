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


CurrentUser = Annotated[User, Depends(require_user)]


@router.get("/me")
async def me(user: CurrentUser) -> dict[str, object]:
    return {
        "uid": user.uid,
        "email": user.email,
        "is_demo_expert": user.email_verified and user.email == os.getenv("EXPERT_EMAIL"),
    }
