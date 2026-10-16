from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import jobs, storage, store
from backend.app.localdb import FakeDb
from backend.app.main import app
from backend.app.routers import auth


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


class FakeLLM:
    """Replaces gemini.structured: returns canned output per prompt id and records every call."""

    def __init__(self) -> None:
        self.replies: dict[str, list[Any]] = {}
        self.calls: list[dict[str, Any]] = []

    def reply(self, prompt_id: str, *outputs: Any) -> None:
        self.replies.setdefault(prompt_id, []).extend(outputs)

    async def __call__(
        self, model: str, prompt_id: str, parts: list[Any], schema: Any, **kw: Any
    ) -> Any:
        from backend.app.gemini import Structured

        self.calls.append(
            {"prompt_id": prompt_id, "parts": parts, "values": kw.get("values") or {}}
        )
        queue = self.replies.get(prompt_id) or []
        out = queue.pop(0) if len(queue) > 1 else queue[0]
        return Structured(schema.model_validate(out), f"{prompt_id}@1", model)

    def seen(self, prompt_id: str | None = None) -> str:
        """Everything a model was shown (instructions + data) as one string, for leakage checks."""
        import json

        return json.dumps(
            [c for c in self.calls if prompt_id is None or c["prompt_id"] == prompt_id], default=str
        )


@pytest.fixture
def llm(monkeypatch: pytest.MonkeyPatch) -> FakeLLM:
    from backend.app import gemini

    fake = FakeLLM()
    monkeypatch.setattr(gemini, "structured", fake)
    return fake
