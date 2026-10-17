"""Firestore access, workspace-scoped (workspaces/{ws}/...). docs/SPEC.md §2.

All access is server-side through the Admin SDK. Workspace `demo` is read-only through the API;
only the seed script opens it with `allow_demo_writes=True`.
"""

import builtins
import os
import uuid
from functools import lru_cache
from typing import Annotated, Any, Literal

from fastapi import Depends, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from backend.app.contract import (
    SOP,
    AgentRun,
    DecisionEdge,
    DecisionGraph,
    DecisionNode,
    Deviation,
    ExamCase,
    ExamReport,
    JudgeScore,
    ModerationResult,
    Probe,
    ProbeAnswer,
    Scenario,
    Segment,
    Session,
    SessionSummary,
    SheetDiff,
    SheetSnapshot,
    Variant,
)

Ws = Literal["demo", "live"]


@lru_cache
def default_db() -> Any:
    if local := os.getenv("LOCAL_DB"):  # laptop runs before Firestore exists (localdb.py)
        from backend.app.localdb import FakeDb

        return FakeDb(local)
    return firestore.AsyncClient(project=os.getenv("GCP_PROJECT"))


def _dump(obj: BaseModel) -> dict[str, Any]:
    # JSON mode: datetimes become ISO strings with their offset, so they read back unchanged.
    return obj.model_dump(mode="json")


class Coll[T: BaseModel]:
    """One collection of contract objects, keyed by `key` (usually `id`)."""

    def __init__(self, store: "Store", path: str, model: type[T], key: str = "id") -> None:
        self._store, self.path, self.model, self.key = store, path, model, key

    def _ref(self, id: str) -> Any:
        return self._store.db.document(f"{self.path}/{id}")

    def _load(self, data: dict[str, Any]) -> T:
        return self.model.model_validate(data)

    async def get(self, id: str) -> T | None:
        snap = await self._ref(id).get()
        return self._load(snap.to_dict()) if snap.exists else None

    async def list(self) -> list[T]:
        return [
            self._load(s.to_dict()) async for s in self._store.db.collection(self.path).stream()
        ]

    async def put(self, obj: T) -> T:
        self._store.check_writable()
        await self._ref(getattr(obj, self.key)).set(_dump(obj))
        return obj

    async def delete(self, id: str) -> None:
        self._store.check_writable()
        await self._ref(id).delete()

    async def replace(self, objs: builtins.list[T]) -> builtins.list[T]:
        """Make the collection exactly `objs` in one atomic batch: stale docs deleted, the rest written.
        ponytail: one batch caps at 500 writes; per-session collections are far smaller."""
        self._store.check_writable()
        keep = {getattr(o, self.key) for o in objs}
        batch = self._store.db.batch()
        async for s in self._store.db.collection(self.path).stream():
            if s.id not in keep:
                batch.delete(self._ref(s.id))
        for o in objs:
            batch.set(self._ref(getattr(o, self.key)), _dump(o))
        await batch.commit()
        return objs


class Probes(Coll[Probe]):
    """Probe docs carry the expert's answer in an extra `answer` field (SPEC §2)."""

    def _load(self, data: dict[str, Any]) -> Probe:
        data.pop("answer", None)
        return super()._load(data)

    async def put(self, obj: Probe) -> Probe:
        """Merge, so re-saving a probe keeps its answer, and an answered probe stays answered."""
        self._store.check_writable()
        snap = await self._ref(obj.id).get()
        if snap.exists and (snap.to_dict() or {}).get("answer"):
            obj = obj.model_copy(update={"status": "answered"})
        await self._ref(obj.id).set(_dump(obj), merge=True)
        return obj

    async def answer(self, id: str) -> ProbeAnswer | None:
        snap = await self._ref(id).get()
        raw = (snap.to_dict() or {}).get("answer") if snap.exists else None
        return ProbeAnswer.model_validate(raw) if raw else None

    async def set_answer(self, answer: ProbeAnswer) -> None:
        self._store.check_writable()
        # a merge on a missing doc would create a partial probe that breaks list() for everyone
        if not (await self._ref(answer.probe_id).get()).exists:
            raise HTTPException(404, f"Probe {answer.probe_id} not found.")
        await self._ref(answer.probe_id).set(
            {"answer": _dump(answer), "status": "answered"}, merge=True
        )

    async def with_answers(self) -> list[tuple[Probe, ProbeAnswer | None]]:
        out = []
        async for s in self._store.db.collection(self.path).stream():
            data = s.to_dict()
            raw = data.get("answer")
            out.append((self._load(data), ProbeAnswer.model_validate(raw) if raw else None))
        return out


class Store:
    def __init__(
        self,
        ws: Ws,
        db: Any = None,
        *,
        allow_demo_writes: bool = False,
        scenario: Scenario = "ap",
    ) -> None:
        self.ws, self.db, self.scenario = ws, db if db is not None else default_db(), scenario
        self.writable = ws != "demo" or allow_demo_writes
        # AP keeps the original roots (workspaces/live, workspaces/demo); other scenarios get their own.
        self.root_name = ws if scenario == "ap" else f"{scenario}-{ws}"
        root = f"workspaces/{self.root_name}"
        self.root = root
        self.sop = Coll(self, f"{root}/sop", SOP)
        self.sessions = Coll(self, f"{root}/sessions", Session)
        self.variants = Coll(self, f"{root}/variants", Variant)
        self.probes = Probes(self, f"{root}/probes", Probe)
        self.exam_cases = Coll(
            self, f"{root}/exam_cases", ExamCase
        )  # expert_label inside: judge-only
        self.agent_runs = Coll(self, f"{root}/agent_runs", AgentRun)
        self.judge_scores = Coll(self, f"{root}/judge_scores", JudgeScore, key="run_id")
        self.exam_reports = Coll(self, f"{root}/exam_reports", ExamReport)
        self.moderation = Coll(self, f"{root}/moderation", ModerationResult)

    async def current_sop(self) -> SOP:
        """The newest SOP version. 409 until `make_synthetic --upload-sop` (or a seed) stores one."""
        sops = await self.sop.list()
        if not sops:
            raise HTTPException(409, f"No SOP in workspace {self.ws} yet. Store one first.")
        return max(sops, key=lambda s: s.version)

    def check_writable(self) -> None:
        if not self.writable:
            raise HTTPException(403, "The demo workspace is read-only.")

    # ---- per-session subcollections ----
    def segments(self, session_id: str) -> Coll[Segment]:
        return Coll(self, f"{self.root}/sessions/{session_id}/segments", Segment)

    def deviations(self, session_id: str) -> Coll[Deviation]:
        return Coll(self, f"{self.root}/sessions/{session_id}/deviations", Deviation)

    def sheet_snapshots(self, session_id: str) -> Coll[SheetSnapshot]:
        return Coll(self, f"{self.root}/sessions/{session_id}/sheet_snapshots", SheetSnapshot)

    async def get_summary(self, session_id: str) -> SessionSummary | None:
        snap = await self.db.document(f"{self.root}/sessions/{session_id}/summary/current").get()
        return SessionSummary.model_validate(snap.to_dict()) if snap.exists else None

    async def put_summary(self, summary: SessionSummary) -> None:
        self.check_writable()
        await self.db.document(f"{self.root}/sessions/{summary.session_id}/summary/current").set(
            _dump(summary)
        )

    async def get_sheet_diff(self, session_id: str) -> SheetDiff | None:
        snap = await self.db.document(f"{self.root}/sessions/{session_id}/sheet_diff/current").get()
        return SheetDiff.model_validate(snap.to_dict()) if snap.exists else None

    async def put_sheet_diff(self, diff: SheetDiff) -> None:
        self.check_writable()
        await self.db.document(f"{self.root}/sessions/{diff.session_id}/sheet_diff/current").set(
            _dump(diff)
        )

    # ---- background job status (not part of the contract; lets pollers stop on failure) ----
    async def put_job(self, job_id: str, status: str, error: str | None = None) -> None:
        self.check_writable()
        await self.db.document(f"{self.root}/jobs/{job_id}").set({"status": status, "error": error})

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        snap = await self.db.document(f"{self.root}/jobs/{job_id}").get()
        return snap.to_dict() if snap.exists else None

    # ---- decision graph: graph/current meta + nodes/edges subcollections, history per version ----
    async def get_graph(self) -> DecisionGraph | None:
        base = f"{self.root}/graph/current"
        meta = await self.db.document(base).get()
        if not meta.exists:
            return None
        nodes = [
            DecisionNode.model_validate(s.to_dict())
            async for s in self.db.collection(f"{base}/nodes").stream()
        ]
        edges = [
            DecisionEdge.model_validate(s.to_dict())
            async for s in self.db.collection(f"{base}/edges").stream()
        ]
        return DecisionGraph.model_validate({**meta.to_dict(), "nodes": nodes, "edges": edges})

    async def graph_version(self, version: int) -> DecisionGraph | None:
        snap = await self.db.document(f"{self.root}/graph_history/{version}").get()
        return DecisionGraph.model_validate(snap.to_dict()) if snap.exists else None

    async def put_graph(self, graph: DecisionGraph) -> None:
        """Replace the current graph atomically and keep a copy under graph_history/{version}."""
        self.check_writable()
        base = f"{self.root}/graph/current"
        # ponytail: one batch (500-op Firestore limit) is plenty for a ~50-node graph.
        data = _dump(graph)
        batch = self.db.batch()
        batch.set(
            self.db.document(base), {k: v for k, v in data.items() if k not in ("nodes", "edges")}
        )
        for sub in ("nodes", "edges"):
            keep = {item["id"] for item in data[sub]}
            async for s in self.db.collection(f"{base}/{sub}").stream():
                if s.id not in keep:  # only stale docs; never delete and set one doc in a batch
                    batch.delete(self.db.document(f"{base}/{sub}/{s.id}"))
            for item in data[sub]:
                batch.set(self.db.document(f"{base}/{sub}/{item['id']}"), item)
        batch.set(self.db.document(f"{self.root}/graph_history/{graph.version}"), data)
        await batch.commit()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---- FastAPI dependencies: reads take ?ws= (default live); writes always go to live.
# Both take ?scenario= (default ap), so every endpoint is scenario-scoped through these two.
def _read_store(ws: Ws = "live", scenario: Scenario = "ap") -> Store:
    return Store(ws, scenario=scenario)


def _live_store(scenario: Scenario = "ap") -> Store:
    return Store("live", scenario=scenario)


ReadStore = Annotated[Store, Depends(_read_store)]
LiveStore = Annotated[Store, Depends(_live_store)]
