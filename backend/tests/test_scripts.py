"""A8: export → seed round trip; A6: the pilot chart renders."""

import asyncio
from pathlib import Path

from backend.app.contract import ExamReport
from backend.app.localdb import FakeDb
from backend.app.routers.demo import load_seed
from backend.app.store import Store
from backend.tests.test_api import FIXTURES, fixture_seed
from scripts import export_demo, run_exam


def test_export_then_seed_round_trips(tmp_path: Path) -> None:
    db = FakeDb(tmp_path / "local.json")  # also exercises the on-disk local DB
    live = Store("live", db)
    seed = fixture_seed()
    asyncio.run(load_seed(live, seed))  # pretend the live run produced the fixtures

    exported = asyncio.run(export_demo.export(Store("live", FakeDb(tmp_path / "local.json"))))
    assert all(s.workspace == "demo" for s in exported.sessions)
    assert len(exported.sessions) == 8 and exported.report and exported.report.id == "r-pilot-01"
    assert sum(1 for p in exported.probes if p.answer) == 5
    assert exported.segments["s-03"] and exported.graph and len(exported.graph.nodes) == 14

    demo = Store("demo", FakeDb(), allow_demo_writes=True)
    asyncio.run(load_seed(demo, exported))
    assert len(asyncio.run(demo.sessions.list())) == 8
    assert asyncio.run(demo.get_graph()) == exported.graph


def test_pilot_chart_renders(tmp_path: Path) -> None:
    r = ExamReport.model_validate_json((FIXTURES / "exam_report.json").read_text(encoding="utf-8"))
    out = run_exam.chart(r, tmp_path / "pilot.png")
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
