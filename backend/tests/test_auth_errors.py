from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from backend.app import errors
from backend.app.main import app
from backend.app.routers import auth


def test_error_shape_and_409() -> None:
    a = FastAPI()
    errors.install(a)

    class Body(BaseModel):
        n: int

    @a.post("/process")
    async def process() -> None:
        raise errors.conflict("Upload the recording before processing it.")

    @a.post("/typed")
    async def typed(body: Body) -> int:
        return body.n

    c = TestClient(a)
    r = c.post("/process")
    assert r.status_code == 409
    assert r.json() == {
        "error": {"code": "conflict", "message": "Upload the recording before processing it."}
    }

    r = c.post("/typed", json={"n": "lots"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_request"
    assert "n" in r.json()["error"]["message"]


def test_health_is_public() -> None:
    assert TestClient(app).get("/api/health").json()["ok"] is True


def test_protected_route_needs_a_token() -> None:
    r = TestClient(app).get("/api/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_bad_token_is_401_not_500(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def reject(token: str) -> dict[str, str]:
        raise ValueError("bad token")

    monkeypatch.setattr(auth, "_verify", reject)
    r = TestClient(app).get("/api/me", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_me_with_a_verified_token(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(
        auth,
        "_verify",
        lambda t: {"uid": "u1", "email": "expert@example.com", "email_verified": True},
    )
    monkeypatch.setenv("EXPERT_EMAIL", "expert@example.com")
    r = TestClient(app).get("/api/me", headers={"Authorization": "Bearer good"})
    assert r.json() == {"uid": "u1", "email": "expert@example.com", "is_demo_expert": True}


def test_unverified_email_is_not_the_expert(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(
        auth,
        "_verify",
        lambda t: {"uid": "u2", "email": "expert@example.com", "email_verified": False},
    )
    monkeypatch.setenv("EXPERT_EMAIL", "expert@example.com")
    r = TestClient(app).get("/api/me", headers={"Authorization": "Bearer good"})
    assert r.json()["is_demo_expert"] is False


def test_firebase_init_runs_once_under_concurrency(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import threading

    calls: list[int] = []
    state: dict[str, object] = {}

    def get_app() -> object:
        if "app" not in state:
            raise ValueError("no app")
        return state["app"]

    def initialize_app(**kw: object) -> object:
        calls.append(1)
        if "app" in state:
            raise ValueError("already exists")
        state["app"] = object()
        return state["app"]

    monkeypatch.setattr(auth.firebase_admin, "get_app", get_app)
    monkeypatch.setattr(auth.firebase_admin, "initialize_app", initialize_app)
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda t: {"uid": "u", "email": ""})
    errs: list[BaseException] = []

    def hit() -> None:
        try:
            auth._verify("t")
        except BaseException as e:  # noqa: BLE001
            errs.append(e)

    threads = [threading.Thread(target=hit) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errs == [] and len(calls) == 1


def test_body_errors_name_the_problem_and_500s_keep_the_shape() -> None:
    a = FastAPI()
    errors.install(a)

    class Body(BaseModel):
        n: int

    @a.post("/typed")
    async def typed(body: Body) -> int:
        return body.n

    @a.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internals")

    c = TestClient(a, raise_server_exceptions=False)
    msg = c.post("/typed").json()["error"]["message"]
    assert msg.startswith("body")
    r = c.get("/boom")
    assert r.status_code == 500
    assert r.json() == {
        "error": {"code": "internal", "message": "Something went wrong on the server."}
    }


def test_local_dev_bypass_only_with_local_db_and_never_on_cloud_run(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from backend.app import store
    from backend.app.localdb import FakeDb

    monkeypatch.setattr(store, "default_db", lambda: FakeDb())
    monkeypatch.setenv("EXPERT_EMAIL", "expert@example.com")
    monkeypatch.setenv("DEV_USER_EMAIL", "expert@example.com")
    c = TestClient(app)
    monkeypatch.delenv("LOCAL_DB", raising=False)
    assert c.get("/api/sessions").status_code == 401  # no LOCAL_DB: real sign-in only

    monkeypatch.setenv("LOCAL_DB", "data/local.json")
    assert c.get("/api/sessions").status_code == 200
    assert c.get("/api/me").json() == {
        "uid": "dev",
        "email": "expert@example.com",
        "is_demo_expert": True,
    }

    monkeypatch.setenv("K_SERVICE", "apprentice")  # Cloud Run sets this: bypass is off
    assert c.get("/api/sessions").status_code == 401
