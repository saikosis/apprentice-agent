from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.contract import ClipRef, DecisionGraph, DecisionNode
from backend.app.main import app


def test_graph_round_trip() -> None:
    clip = ClipRef(session_id="s1", start_ts="01:02", end_ts="01:30")
    node = DecisionNode(
        id="n1",
        kind="exception",
        label="Consignment",
        detail="",
        sop_rule="§3.2",
        evidence=[clip],
        probe_ids=[],
        confidence=0.9,
    )
    g = DecisionGraph(
        version=1, built_at=datetime.now(UTC), prompt_version="graph@1", nodes=[node], edges=[]
    )
    assert DecisionGraph.model_validate_json(g.model_dump_json()) == g


def test_extra_fields_forbidden() -> None:
    with pytest.raises(ValidationError):
        ClipRef(session_id="s1", start_ts="00:00", end_ts="00:01", bogus=1)  # type: ignore[call-arg]


def test_health() -> None:
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True
