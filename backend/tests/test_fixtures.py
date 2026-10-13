import json
from pathlib import Path

import pytest
from pydantic import BaseModel, TypeAdapter

from backend.app import contract as c

FIXTURES = Path(__file__).parents[2] / "fixtures"

# fixture filename -> type it must validate as. Add entries as fixtures land.
SCHEMAS: dict[str, object] = {
    "sessions.json": list[c.Session],
    "segments.json": list[c.Segment],
    "deviations.json": list[c.Deviation],
    "probe_answers.json": list[c.ProbeAnswer],
    "probes.json": list[c.Probe],
    "variants.json": list[c.Variant],
    "graph.json": c.DecisionGraph,
    "exam_report.json": c.ExamReport,
}


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("*.json")))
def test_fixture_validates(name: str) -> None:
    if name not in SCHEMAS:
        pytest.fail(f"{name} has no schema in SCHEMAS")
    tp = SCHEMAS[name]
    data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        tp.model_validate(data)
    else:
        TypeAdapter(tp).validate_python(data)
