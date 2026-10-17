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
    "exam_cases.json": list[c.ExamCase],
    "agent_runs.json": list[c.AgentRun],
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


def test_exam_fixtures_agree_with_the_report() -> None:
    """agent_runs.json reproduces every majority and stability in exam_report.json."""
    from backend.app.exam.report import aggregate

    cases = [
        c.ExamCase.model_validate(x)
        for x in json.loads((FIXTURES / "exam_cases.json").read_text(encoding="utf-8"))
    ]
    runs = [
        c.AgentRun.model_validate(x)
        for x in json.loads((FIXTURES / "agent_runs.json").read_text(encoding="utf-8"))
    ]
    report = c.ExamReport.model_validate_json(
        (FIXTURES / "exam_report.json").read_text(encoding="utf-8")
    )
    got = aggregate(report.id, cases, runs, [], report.runs_per_arm, report.graph_version, [])
    for a, b in zip(got.cases, report.cases, strict=True):
        assert (a.case_id, a.sop_only_majority, a.sop_graph_majority) == (
            b.case_id,
            b.sop_only_majority,
            b.sop_graph_majority,
        )
        assert (round(a.sop_only_stability, 2), round(a.sop_graph_stability, 2)) == (
            b.sop_only_stability,
            b.sop_graph_stability,
        )
