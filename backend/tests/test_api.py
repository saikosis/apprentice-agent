"""A2: the REST API end to end against the in-memory Firestore (SPEC §3)."""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from backend.app.contract import (
    AgentRun,
    ExamCase,
    ExamReport,
    ModerationResult,
    Variant,
)
from backend.app.exam import report, scenarios
from backend.app.main import app
from backend.app.pipeline import segment
from backend.app.routers.demo import DemoSeed, load_seed
from backend.app.safety import armor
from backend.tests.conftest import Api

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
NOW = datetime(2026, 10, 15, 10, 0, tzinfo=UTC)


def new_session(api: Api, kind: str = "training", live: bool = True) -> dict[str, Any]:
    r = api.client.post("/api/sessions", json={"kind": kind, "live_enabled": live})
    assert r.status_code == 200, r.text
    return r.json()


def upload(api: Api, sid: str) -> None:
    r = api.client.post(
        f"/api/sessions/{sid}/upload-url", json={"content_type": "video/webm", "size_bytes": 1000}
    )
    assert r.status_code == 200, r.text
    api.uploaded.add(r.json()["gcs_uri"])
    r = api.client.post(
        f"/api/sessions/{sid}/finalize", json={"duration_s": 412, "ended_at": NOW.isoformat()}
    )
    assert r.status_code == 200, r.text


# ---- sessions ----
def test_create_list_and_detail(api: Api) -> None:
    s = new_session(api)
    assert s["status"] == "created" and s["expert_uid"] == "u-expert" and s["workspace"] == "live"
    assert [x["id"] for x in api.client.get("/api/sessions").json()] == [s["id"]]
    assert api.client.get("/api/sessions?ws=demo").json() == []
    d = api.client.get(f"/api/sessions/{s['id']}").json()
    assert d == {"session": s, "segments": [], "deviations": [], "diff": None, "summary": None}
    r = api.client.get("/api/sessions/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_upload_finalize_process_state_machine(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = new_session(api)["id"]
    r = api.client.post(f"/api/sessions/{sid}/process")
    assert r.status_code == 409, "process before upload is a state violation"

    r = api.client.post(
        f"/api/sessions/{sid}/upload-url", json={"content_type": "video/webm", "size_bytes": 10}
    )
    body = r.json()
    assert body["method"] == "PUT" and body["headers"] == {"Content-Type": "video/webm"}
    assert body["gcs_uri"] == f"gs://test-bucket/live/{sid}.webm"
    assert ("PUT", body["gcs_uri"]) in api.signed

    fin = {"duration_s": 300, "ended_at": NOW.isoformat()}
    assert (
        api.client.post(f"/api/sessions/{sid}/finalize", json=fin).status_code == 409
    )  # nothing arrived
    api.uploaded.add(body["gcs_uri"])
    s = api.client.post(f"/api/sessions/{sid}/finalize", json=fin).json()
    assert s["status"] == "uploaded" and s["duration_s"] == 300

    ran: list[str] = []

    async def fake_process(store: Any, session_id: str) -> None:
        ran.append(session_id)
        cur = await store.sessions.get(session_id)
        await store.sessions.put(cur.model_copy(update={"status": "processed"}))

    monkeypatch.setattr(segment, "process_session", fake_process)
    r = api.client.post(f"/api/sessions/{sid}/process")
    assert r.status_code == 202 and r.json() == {"session_id": sid, "status": "processing"}
    api.drain()
    assert ran == [sid]
    assert api.client.get(f"/api/sessions/{sid}").json()["session"]["status"] == "processed"


def test_a_failing_pipeline_marks_the_session_failed(api: Api) -> None:
    sid = new_session(api)["id"]
    upload(api, sid)
    assert api.client.post(f"/api/sessions/{sid}/process").status_code == 202
    api.drain()  # no SOP stored yet, so the real pipeline stops at once
    s = api.client.get(f"/api/sessions/{sid}").json()["session"]
    assert s["status"] == "failed" and s["error"].startswith("No SOP")


def test_upload_rejects_wrong_type_and_oversize(api: Api) -> None:
    sid = new_session(api)["id"]
    url = f"/api/sessions/{sid}/upload-url"
    assert (
        api.client.post(url, json={"content_type": "video/mp4", "size_bytes": 10}).status_code
        == 422
    )
    assert (
        api.client.post(
            url, json={"content_type": "video/webm", "size_bytes": 3 * 1024**3}
        ).status_code
        == 422
    )


# ---- live deviations ----
def test_live_deviation_creates_deviation_and_probe_with_throttle(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from backend.app.routers import sessions

    clock = {"t": NOW}
    monkeypatch.setattr(sessions, "_now", lambda: clock["t"])
    sid = new_session(api)["id"]
    url = f"/api/sessions/{sid}/deviations"

    def ask(after_s: int, t_seconds: int = 0) -> Any:
        clock["t"] = NOW + timedelta(seconds=after_s)
        return api.client.post(
            url, json={"sop_rule": "§3.3", "question": "Why?", "t_seconds": t_seconds}
        )

    r = api.client.post(
        url,
        json={
            "sop_rule": "§3.2",
            "question": "Why skip the PO match?",
            "invoice_id": "INV-1032",
            "t_seconds": 125,
        },
    )
    assert r.status_code == 200, r.text
    dev, probe = r.json()["deviation"], r.json()["probe"]
    assert dev["source"] == "live" and dev["timestamp"] == "02:05" and dev["t_seconds"] == 125
    assert probe["deviation_id"] == dev["id"] and probe["status"] == "open"
    assert probe["clip"] == {"session_id": sid, "start_ts": "01:55", "end_ts": "02:25"}

    # spacing comes from the server clock: a client claiming t_seconds far apart doesn't help
    too_soon = ask(after_s=20, t_seconds=900)
    assert too_soon.status_code == 429 and too_soon.json()["error"]["code"] == "rate_limited"
    assert ask(after_s=50).status_code == 200
    assert ask(after_s=100).status_code == 200
    assert ask(after_s=200).status_code == 429  # fourth question in the session
    assert len(api.client.get(f"/api/sessions/{sid}").json()["deviations"]) == 3


def test_live_deviation_needs_a_live_recording(api: Api) -> None:
    sid = new_session(api, live=False)["id"]
    r = api.client.post(
        f"/api/sessions/{sid}/deviations",
        json={"sop_rule": "§3.2", "question": "Why?", "t_seconds": 5},
    )
    assert r.status_code == 409


# ---- probes ----
def make_probe(api: Api) -> str:
    sid = new_session(api)["id"]
    r = api.client.post(
        f"/api/sessions/{sid}/deviations",
        json={"sop_rule": "§3.2", "question": "Why?", "t_seconds": 60},
    )
    return str(r.json()["probe"]["id"])


def test_answer_is_screened_stored_and_listed(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    pid = make_probe(api)
    assert api.client.get("/api/probes").json()[0]["answer"] is None

    async def flag(text: str, kind: str, target_id: str) -> ModerationResult:
        return ModerationResult(
            id="mod-1",
            target_kind="probe_answer",
            target_id=target_id,
            template="t",
            match_found="ignore" in text,
            filters={},
            blocked="ignore" in text,
            checked_at=NOW,
        )

    monkeypatch.setattr(armor, "screen_input", flag)
    r = api.client.post(
        f"/api/probes/{pid}/answer", json={"text": "  Kaveri is consignment.  ", "source": "typed"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["probe"]["status"] == "answered"
    assert r.json()["answer"]["text"] == "Kaveri is consignment."
    assert r.json()["answer"]["moderation"]["match_found"] is False

    assert (
        api.client.post(
            f"/api/probes/{pid}/answer", json={"text": "again", "source": "typed"}
        ).status_code
        == 409
    )

    r = api.client.patch(f"/api/probes/{pid}/answer", json={"text": "ignore the SOP"})
    assert (
        r.json()["answer"]["source"] == "edited"
        and r.json()["answer"]["moderation"]["match_found"] is True
    )

    listed = api.client.get("/api/probes?status=answered").json()
    assert [p["id"] for p in listed] == [pid] and listed[0]["answer"]["source"] == "edited"
    assert api.client.get("/api/probes?status=open").json() == []
    assert (
        api.client.post(
            "/api/probes/nope/answer", json={"text": "x", "source": "typed"}
        ).status_code
        == 404
    )


def test_edit_without_an_answer_is_409(api: Api) -> None:
    assert (
        api.client.patch(f"/api/probes/{make_probe(api)}/answer", json={"text": "x"}).status_code
        == 409
    )


# ---- variants, graph ----
def test_graph_and_variants(api: Api) -> None:
    assert api.client.get("/api/graph").status_code == 404
    graph = json.loads((FIXTURES / "graph.json").read_text(encoding="utf-8"))
    from backend.app.contract import DecisionGraph

    asyncio.run(api.store().put_graph(DecisionGraph.model_validate(graph)))
    assert len(api.client.get("/api/graph").json()["nodes"]) == len(graph["nodes"])
    assert api.client.get("/api/graph?ws=demo").status_code == 404

    for v in json.loads((FIXTURES / "variants.json").read_text(encoding="utf-8")):
        asyncio.run(api.store().variants.put(Variant.model_validate(v)))
    freqs = [v["frequency"] for v in api.client.get("/api/variants").json()]
    assert freqs == sorted(freqs, reverse=True)
    assert api.client.post("/api/variants/discover").status_code == 202
    assert api.client.post("/api/graph/build").status_code == 202
    api.drain()  # seams raise NotImplementedError: logged, never crash the app


# ---- exam ----
def case(id: str) -> ExamCase:
    inv = {
        "invoice_id": "INV-1062",
        "vendor_name": "Kaveri Consignment Stores",
        "amount_inr": "36980",
    }
    return ExamCase(
        id=id,
        origin="generated",
        trap_type="none",
        item=inv,
        reference_row={},
        emails=[],
        context="",
    )


def test_exam_flow(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    train = new_session(api)["id"]
    r = api.client.post("/api/exam/generate", json={"heldout_session_ids": [train]})
    assert r.status_code == 409

    held = new_session(api, kind="heldout")["id"]
    s = asyncio.run(api.store().sessions.get(held))
    asyncio.run(api.store().sessions.put(s.model_copy(update={"status": "processed"})))  # type: ignore[union-attr]
    r = api.client.post("/api/exam/generate", json={"heldout_session_ids": [held]})
    assert (
        r.status_code == 409 and "SOP" in r.json()["error"]["message"]
    )  # nothing to build cases from yet

    async def fake_generate(store: Any, ids: list[str], n: int) -> list[ExamCase]:
        cases = [case("c-01"), case("c-02")]
        for c in cases:
            await store.exam_cases.put(c)
        return cases

    monkeypatch.setattr(scenarios, "generate", fake_generate)
    assert (
        len(api.client.post("/api/exam/generate", json={"heldout_session_ids": [held]}).json()) == 2
    )
    assert (
        api.client.post("/api/exam/run", json={"runs_per_arm": 3}).status_code == 409
    )  # nothing labelled

    r = api.client.put(
        "/api/exam/cases/c-01/label",
        json={"decision": "approve", "rationale": "Ties to statement."},
    )
    assert r.json()["expert_label"]["labeled_by"] == "expert@example.com"
    assert (
        api.client.put(
            "/api/exam/cases/c-99/label", json={"decision": "approve", "rationale": "x"}
        ).status_code
        == 404
    )
    assert [c["id"] for c in api.client.get("/api/exam/cases").json()] == ["c-01", "c-02"]

    assert api.client.get("/api/exam/reports/latest").status_code == 404
    fixture_report = ExamReport.model_validate_json(
        (FIXTURES / "exam_report.json").read_text(encoding="utf-8")
    )

    async def fake_run(store: Any, report_id: str, runs: int) -> None:
        await store.exam_reports.put(fixture_report.model_copy(update={"id": report_id}))
        await store.agent_runs.put(
            AgentRun(
                id="run-1",
                case_id="c-01",
                arm="sop_graph",
                run_index=0,
                output=None,
                latency_ms=900,
                model="m",
                prompt_version="arm_graph@1",
            )
        )

    monkeypatch.setattr(report, "run_exam", fake_run)
    r = api.client.post("/api/exam/run", json={"runs_per_arm": 3})
    assert r.status_code == 202
    rid = r.json()["report_id"]
    api.drain()
    assert api.client.get(f"/api/exam/report/{rid}").json()["id"] == rid
    assert api.client.get("/api/exam/reports/latest").json()["id"] == rid
    assert [x["id"] for x in api.client.get("/api/exam/runs?case_id=c-01").json()] == ["run-1"]
    assert api.client.get("/api/exam/runs?case_id=c-02").json() == []


# ---- sheets ----
def row(inv: str, status: str = "Pending") -> dict[str, Any]:
    return {
        "invoice_id": inv,
        "vendor_id": "V-001",
        "vendor_name": "Sahyadri",
        "invoice_no": "SAH/1",
        "invoice_date": "2026-10-01",
        "amount_inr": "1000",
        "gst_inr": "180",
        "due_date": "2026-10-31",
        "category": "Office supplies",
        "status": status,
    }


def test_sheet_snapshots_produce_a_diff(api: Api) -> None:
    sid = new_session(api)["id"]
    before = api.client.post(
        "/api/sheets/snapshot",
        json={"session_id": sid, "phase": "before", "rows": [row("INV-1"), row("INV-2")]},
    )
    assert before.json()["id"] == f"{sid}-before"
    api.client.post(
        "/api/sheets/snapshot",
        json={
            "session_id": sid,
            "phase": "after",
            "rows": [row("INV-1", "Approved"), row("INV-3")],
        },
    )
    detail = api.client.get(f"/api/sessions/{sid}").json()
    assert detail["session"]["sheet_snapshot_after_id"] == f"{sid}-after"
    assert detail["diff"]["changes"] == [
        {"invoice_id": "INV-1", "column": "status", "before": "Pending", "after": "Approved"},
        {"invoice_id": "INV-2", "column": "row", "before": "present", "after": None},
        {"invoice_id": "INV-3", "column": "row", "before": None, "after": "added"},
    ]


# ---- demo: public bundle, public demo playback, admin seed ----
def fixture_seed() -> DemoSeed:
    load = lambda name: json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    group = lambda xs: {
        x["session_id"]: [y for y in xs if y["session_id"] == x["session_id"]] for x in xs
    }
    answers = {a["probe_id"]: a for a in load("probe_answers.json")}
    return DemoSeed.model_validate(
        {
            "sessions": load("sessions.json"),
            "segments": group(load("segments.json")),
            "deviations": group(load("deviations.json")),
            "summaries": {x["session_id"]: x for x in load("summaries.json")},
            "variants": load("variants.json"),
            "probes": [{**p, "answer": answers.get(p["id"])} for p in load("probes.json")],
            "graph": load("graph.json"),
            "observed_workflow": load("observed_workflow.json"),
            "report": load("exam_report.json"),
            "exam_cases": load("exam_cases.json"),
            "agent_runs": load("agent_runs.json"),
        }
    )


def test_demo_bundle_is_public_and_complete(api: Api) -> None:
    asyncio.run(load_seed(api.store("demo"), fixture_seed()))
    app.dependency_overrides.clear()  # anonymous from here on
    b = api.client.get("/api/demo/bundle").json()
    assert len(b["sessions"]) == 8 and b["report"]["id"] == "r-pilot-01"
    assert len(b["segments"]["s-03"]) > 0 and "s-01" in b["deviations"]
    assert b["summaries"]["s-01"]["items"][1]["invoice_id"] == "INV-1041"
    answered = [p for p in b["probes"] if p["answer"]]
    assert len(answered) == 5 and all(p["status"] == "answered" for p in answered)
    assert len(b["graph"]["nodes"]) == 14
    assert b["observed_workflow"]["steps"][0]["n"] == 1
    assert len(b["exam_cases"]) == 10 and len(b["agent_runs"]) == 60
    assert all(r["id"].startswith("r-pilot-01-") for r in b["agent_runs"])
    assert api.client.get("/api/sessions").status_code == 401  # everything else still needs sign-in


def test_video_url_anonymous_reads_demo_signed_in_reads_live(api: Api) -> None:
    asyncio.run(load_seed(api.store("demo"), fixture_seed()))
    live_sid = new_session(api)["id"]
    upload(api, live_sid)
    r = api.client.get(f"/api/sessions/{live_sid}/video-url")
    assert r.status_code == 200 and f"live/{live_sid}" in r.json()["url"]
    assert (
        api.client.get("/api/sessions/s-01/video-url?ws=live").status_code == 404
    )  # demo id, not in live

    app.dependency_overrides.clear()
    r = api.client.get("/api/sessions/s-01/video-url")
    assert r.status_code == 200 and "demo/s-01.webm" in r.json()["url"]
    assert (
        api.client.get(f"/api/sessions/{live_sid}/video-url").status_code == 404
    )  # live is never public


def test_seed_demo_is_admin_only(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"bundle": fixture_seed().model_dump(mode="json")}
    assert api.client.post("/api/admin/seed-demo", json=body).status_code == 403
    monkeypatch.setenv("ADMIN_UIDS", "someone, u-expert")
    assert api.client.post("/api/admin/seed-demo", json=body).json() == {"ok": True}
    assert len(api.client.get("/api/sessions?ws=demo").json()) == 8


def test_live_workspace_is_the_only_write_target(api: Api) -> None:
    # writes have no ws parameter; asking for demo is ignored, never a demo write
    s = api.client.post(
        "/api/sessions?ws=demo", json={"kind": "training", "live_enabled": True}
    ).json()
    assert s["workspace"] == "live"
    assert api.client.get("/api/sessions?ws=demo").json() == []


# ---- who may use the live workspace ----
def test_only_the_expert_can_use_the_live_workspace(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.app.routers import auth

    stranger = auth.User(uid="u-x", email="judge@example.com", email_verified=True)
    app.dependency_overrides[auth.require_user] = lambda: stranger
    r = api.client.get("/api/sessions")
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert (
        api.client.put(
            "/api/exam/cases/c-01/label", json={"decision": "approve", "rationale": "x"}
        ).status_code
        == 403
    )
    assert api.client.get("/api/me").json()["is_demo_expert"] is False  # /me still answers

    monkeypatch.delenv("EXPERT_EMAIL")
    app.dependency_overrides[auth.require_user] = lambda: auth.User(
        uid="u-expert", email="expert@example.com", email_verified=True
    )
    assert api.client.get("/api/sessions").status_code == 403  # fails closed when unconfigured


def test_video_url_for_a_demo_clip_when_signed_in_or_with_a_stale_token(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.app.routers import auth

    def expired(token: str) -> dict[str, str]:
        raise ValueError("expired")

    monkeypatch.setattr(auth, "_verify", expired)
    asyncio.run(load_seed(api.store("demo"), fixture_seed()))
    # signed in, on the /demo page: no ws → live misses → demo
    assert "demo/s-01.webm" in api.client.get("/api/sessions/s-01/video-url").json()["url"]
    assert "demo/s-01.webm" in api.client.get("/api/sessions/s-01/video-url?ws=demo").json()["url"]
    app.dependency_overrides.clear()  # real token check: a stale token is just anonymous here
    r = api.client.get("/api/sessions/s-01/video-url", headers={"Authorization": "Bearer stale"})
    assert r.status_code == 200


def test_force_restarts_a_session_stuck_in_processing(api: Api) -> None:
    sid = new_session(api)["id"]
    upload(api, sid)
    s = asyncio.run(api.store().sessions.get(sid))
    asyncio.run(api.store().sessions.put(s.model_copy(update={"status": "processing"})))  # type: ignore[union-attr]
    assert api.client.post(f"/api/sessions/{sid}/process").status_code == 409
    assert api.client.post(f"/api/sessions/{sid}/process?force=true").status_code == 202
    api.drain()


def test_a_malformed_model_timestamp_does_not_break_the_session_page(api: Api) -> None:
    from backend.app.contract import Segment

    sid = new_session(api)["id"]
    for i, ts in enumerate(["01:02.5", "00:10", "1m02s"]):
        seg = Segment(
            id=f"seg-{i}", session_id=sid, start_ts=ts, end_ts=ts, app="sheets", action="x"
        )
        asyncio.run(api.store().segments(sid).put(seg))
    r = api.client.get(f"/api/sessions/{sid}")
    assert r.status_code == 200 and r.json()["segments"][0]["start_ts"] == "00:10"


def test_a_failed_exam_run_stops_the_poller(api: Api) -> None:
    from backend.app.contract import ExpertLabel

    lbl = ExpertLabel(decision="approve", rationale="x", labeled_by="e", labeled_at=NOW)
    asyncio.run(api.store().exam_cases.put(case("c-01").model_copy(update={"expert_label": lbl})))
    rid = api.client.post("/api/exam/run", json={"runs_per_arm": 1}).json()["report_id"]
    api.drain()  # real seam raises NotImplementedError
    r = api.client.get(f"/api/exam/report/{rid}")
    assert r.status_code == 500 and "decision graph" in r.json()["error"]["message"]


def test_sheet_diff_survives_reordered_snapshots_and_duplicate_ids(api: Api) -> None:
    sid = new_session(api)["id"]
    post = lambda phase, rows: api.client.post(
        "/api/sheets/snapshot", json={"session_id": sid, "phase": phase, "rows": rows}
    )
    post("after", [row("INV-1", "Approved"), row("INV-1", "Rejected")])
    assert api.client.get(f"/api/sessions/{sid}").json()["diff"] is None
    post("before", [row("INV-1"), row("INV-1")])  # late 'before' still produces the diff
    changes = api.client.get(f"/api/sessions/{sid}").json()["diff"]["changes"]
    assert [(c["invoice_id"], c["after"]) for c in changes] == [
        ("INV-1", "Approved"),
        ("INV-1#2", "Rejected"),
    ]


# ---- A3: live token ----
def test_live_token_locks_the_whole_setup(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from backend.app.routers import live
    from scripts.make_synthetic import build_sop

    asyncio.run(api.store().sop.put(build_sop()))
    made: list[Any] = []

    async def create(config: Any) -> Any:
        made.append(config)
        return SimpleNamespace(name="auth_tokens/abc")

    fake = SimpleNamespace(aio=SimpleNamespace(auth_tokens=SimpleNamespace(create=create)))
    monkeypatch.setattr(live, "_client", lambda: fake)
    sid = new_session(api)["id"]
    r = api.client.post("/api/live/token", json={"session_id": sid, "resume_handle": "h-1"})
    assert r.status_code == 200, r.text
    assert r.json()["token"] == "auth_tokens/abc" and r.json()["model"] == "gemini-3.8-live"
    cfg = made[0]
    assert cfg.uses == 1 and cfg.lock_additional_fields is None
    assert (cfg.expire_time - cfg.new_session_expire_time).total_seconds() == 29 * 60
    c = cfg.live_connect_constraints.config
    assert "§3.2" in c.system_instruction and "Thanks, noted." in c.system_instruction
    assert c.tools[0].function_declarations[0].name == "log_deviation"
    assert c.session_resumption.handle == "h-1"
    assert c.context_window_compression.trigger_tokens == 25000

    off = new_session(api, live=False)["id"]
    assert api.client.post("/api/live/token", json={"session_id": off}).status_code == 409


def test_upload_without_a_bucket_says_so(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BUCKET")
    sid = new_session(api)["id"]
    r = api.client.post(
        f"/api/sessions/{sid}/upload-url", json={"content_type": "video/webm", "size_bytes": 10}
    )
    assert r.status_code == 503 and "BUCKET" in r.json()["error"]["message"]


def test_each_scenario_has_its_own_sessions_and_recordings(api: Api) -> None:
    r = api.client.post("/api/sessions?scenario=essays", json={"kind": "training"})
    sid = r.json()["id"]
    assert [s["id"] for s in api.client.get("/api/sessions?scenario=essays").json()] == [sid]
    assert api.client.get("/api/sessions").json() == []  # AP sees nothing
    r = api.client.post(
        f"/api/sessions/{sid}/upload-url?scenario=essays",
        json={"content_type": "video/webm", "size_bytes": 1000},
    )
    assert r.json()["gcs_uri"] == f"gs://test-bucket/essays-live/{sid}.webm"
    assert api.client.get(f"/api/sessions/{sid}").status_code == 404


def test_connect_sheet_diffs_any_tab_by_the_scenarios_id_column(api: Api) -> None:
    sid = api.client.post("/api/sessions?scenario=volunteers", json={"kind": "training"}).json()[
        "id"
    ]
    r = lambda rid, status: {"response_id": rid, "name": "Riya Sen", "status": status}
    for phase, rows in (("before", [r("R-301", "Pending")]), ("after", [r("R-301", "Accepted")])):
        res = api.client.post(
            "/api/sheets/snapshot?scenario=volunteers",
            json={"session_id": sid, "phase": phase, "rows": rows},
        )
        assert res.status_code == 200, res.text
    diff = api.client.get(f"/api/sessions/{sid}?scenario=volunteers").json()["diff"]
    assert diff["changes"] == [
        {"invoice_id": "R-301", "column": "status", "before": "Pending", "after": "Accepted"}
    ]


def test_observed_workflow_is_null_until_patterns_run(api: Api) -> None:
    r = api.client.get("/api/observed-workflow")
    assert r.status_code == 200 and r.json() is None
