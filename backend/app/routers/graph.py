"""Variants and the decision graph: read them, or start a rebuild in the background."""

from fastapi import APIRouter, HTTPException

from backend.app import errors, jobs, sandbox
from backend.app.contract import DecisionGraph, ObservedWorkflow, Variant
from backend.app.pipeline import graph, variants
from backend.app.workspace import LiveStore, ReadStore

router = APIRouter(tags=["graph"])


@router.post("/variants/discover", status_code=202)
async def discover(store: LiveStore) -> dict[str, str]:
    await sandbox.charge(store, "graph_builds")
    jobs.spawn("discover variants", variants.discover(store))
    return {"status": "discovering"}


@router.get("/variants")
async def list_variants(store: ReadStore) -> list[Variant]:
    return sorted(await store.variants.list(), key=lambda v: v.frequency, reverse=True)


@router.get("/observed-workflow")
async def observed_workflow(store: ReadStore) -> ObservedWorkflow | None:
    """Written on every pattern refresh; null until the first one."""
    return await store.get_observed_workflow()


@router.post("/graph/build", status_code=202)
async def build(store: LiveStore) -> dict[str, str]:
    if not any(p.status == "answered" for p in await store.probes.list()):
        raise errors.conflict(
            "Answer at least one question first: the graph is built from answers."
        )
    await sandbox.charge(store, "graph_builds")
    jobs.spawn("build graph", graph.build(store))
    return {"status": "building"}


@router.get("/graph")
async def get_graph(store: ReadStore) -> DecisionGraph:
    g = await store.get_graph()
    if g is None:
        raise HTTPException(404, "No decision graph yet.")
    return g
