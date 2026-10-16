from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import jobs, storage, store
from backend.app.main import app
from backend.app.routers import auth
from backend.tests.fake_firestore import FakeDb


@dataclass
class Api:
    client: TestClient
    db: FakeDb
    uploaded: set[str] = field(default_factory=set)  # gs:// uris that "exist" in the fake bucket
    signed: list[tuple[str, str]] = field(default_factory=list)

    def drain(self) -> None:
        """Let background jobs (202 endpoints) finish inside the app's event loop."""
        self.client.portal.call(jobs.drain)  # type: ignore[union-attr]

    def store(self, ws: store.Ws = "live") -> store.Store:
        return store.Store(ws, self.db, allow_demo_writes=True)


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> Iterator[Api]:
    db = FakeDb()
    monkeypatch.setattr(store, "default_db", lambda: db)
    monkeypatch.setenv("BUCKET", "test-bucket")
    monkeypatch.setenv("EXPERT_EMAIL", "expert@example.com")
    a = Api(client=None, db=db)  # type: ignore[arg-type]

    async def signed_url(uri: str, method: str, minutes: int, content_type: Any = None) -> str:
        a.signed.append((method, uri))
        return f"https://storage.test/{uri.removeprefix('gs://')}?method={method}"

    async def exists(uri: str) -> bool:
        return uri in a.uploaded

    monkeypatch.setattr(storage, "signed_url", signed_url)
    monkeypatch.setattr(storage, "exists", exists)
    expert = auth.User(uid="u-expert", email="expert@example.com", email_verified=True)
    app.dependency_overrides[auth.require_user] = lambda: expert
    app.dependency_overrides[auth.optional_user] = lambda: expert
    with TestClient(app) as c:
        a.client = c
        yield a
    app.dependency_overrides.clear()
