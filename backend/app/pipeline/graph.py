"""Decision graph builder; clean inputs only, never expert_label (prompts/graph.md)."""

import os
from datetime import UTC, datetime
from typing import Any

from backend.app import gemini
from backend.app.contract import SOP, ClipRef, DecisionEdge, DecisionGraph, DecisionNode
from backend.app.pipeline.probes import clean_answers
from backend.app.safety import armor
from backend.app.store import Store

MAX_EVIDENCE = 3


def _sop_node_id(rule: str) -> str:
    return "n-sop-" + "".join(ch for ch in rule if ch.isalnum() or ch == ".").replace(".", "-")


def validate(
    raw: DecisionGraph, sop: SOP, clean_clips: dict[str, ClipRef | None], sessions: set[str]
) -> DecisionGraph:
    """Make the model's draft obey the rules in code. `clean_clips`: clean answered probe id → its
    clip; `sessions`: training session ids a clip may come from.

    - every node except plain SOP references must rest on at least one clean answer (no invented
      reasons); probe_ids may only cite clean answers
    - evidence clips must come from a real training session; else the answers' own clips are used
    - every exception names a real SOP section and has an `overrides` edge to its SOP rule node
    - SOP rule nodes borrow evidence from the exceptions that override them
    - edges must join existing nodes
    """
    sections = {s.id: s for s in sop.sections}
    nodes: dict[str, DecisionNode] = {}
    for n in raw.nodes:
        if n.id in nodes:
            continue
        pids = [p for p in dict.fromkeys(n.probe_ids) if p in clean_clips]
        is_sop_ref = n.kind == "rule" and n.sop_rule in sections and not pids
        if n.kind == "exception" and n.sop_rule not in sections:
            continue
        if not pids and not is_sop_ref:
            continue
        evidence = [c for c in n.evidence if c.session_id in sessions] or [
            c for p in pids if (c := clean_clips[p])
        ]
        if not evidence and not is_sop_ref:
            continue
        nodes[n.id] = n.model_copy(update={"probe_ids": pids, "evidence": evidence[:MAX_EVIDENCE]})

    edges = [
        e for e in raw.edges if e.source in nodes and e.target in nodes and e.source != e.target
    ]

    def sop_rule_node(rule: str) -> str:
        for n in nodes.values():
            if n.kind == "rule" and n.sop_rule == rule and not n.probe_ids:
                return n.id
        sec = sections[rule]
        nid = _sop_node_id(rule)
        nodes[nid] = DecisionNode(
            id=nid,
            kind="rule",
            label=f"{rule} {sec.title}",
            detail=sec.text,
            sop_rule=rule,
            evidence=[],
            probe_ids=[],
            confidence=1.0,
        )
        return nid

    for x in [n for n in nodes.values() if n.kind == "exception"]:
        if x.sop_rule is None:
            continue
        has = any(
            e.source == x.id
            and e.relation == "overrides"
            and nodes[e.target].sop_rule == x.sop_rule
            for e in edges
        )
        if not has:
            edges.append(
                DecisionEdge(
                    id="tmp", source=x.id, target=sop_rule_node(x.sop_rule), relation="overrides"
                )
            )

    for nid, n in list(nodes.items()):
        if n.kind == "rule" and not n.evidence:
            borrowed = [
                c
                for e in edges
                if e.target == nid and e.relation == "overrides"
                for c in nodes[e.source].evidence
            ]
            if borrowed:
                nodes[nid] = n.model_copy(update={"evidence": borrowed[:MAX_EVIDENCE]})
            else:
                del nodes[nid]
    edges = [e for e in edges if e.source in nodes and e.target in nodes]
    seen: set[tuple[str, str, str]] = set()
    unique: list[DecisionEdge] = []
    for e in edges:
        k = (e.source, e.target, e.relation)
        if k not in seen:
            seen.add(k)
            unique.append(e.model_copy(update={"id": f"e-{len(unique) + 1}"}))
    return raw.model_copy(update={"nodes": list(nodes.values()), "edges": unique})


async def inputs(store: Store) -> dict[str, Any]:
    """Everything the builder may see: deviations, variants, clean Q&A. Exam cases are never read.
    Deviation and variant text is model-written from the video, so it is screened too."""
    devs = []
    for s in await store.sessions.list():
        if s.kind == "training":
            devs += await store.deviations(s.id).list()
    variants = await store.variants.list()
    clean_devs = await armor.keep_clean(
        store, devs, lambda d: f"{d.description}\n{d.question}", "segment"
    )
    clean_vars = await armor.keep_clean(
        store, variants, lambda v: f"{v.name}\n{v.description}", "segment"
    )
    return {
        "deviations": [d.model_dump() for d in clean_devs],
        "variants": [v.model_dump() for v in clean_vars],
        "qa": await clean_answers(store),
    }


async def build(store: Store) -> DecisionGraph:
    """Build the next graph version from clean (unflagged) inputs and store it."""
    sop = await store.current_sop()
    data = await inputs(store)
    if not data["qa"]:
        raise RuntimeError(
            "No answered questions yet; the graph is built from the expert's answers."
        )
    model = gemini.PRO_MODEL if os.getenv("GRAPH_MODEL") == "pro" else gemini.FLASH_MODEL
    out = await gemini.structured(
        model, "graph", [gemini.data("Inputs", data)], DecisionGraph, values={"SOP": sop.full_text}
    )
    clean = {
        q["probe_id"]: ClipRef.model_validate(q["clip"]) if q["clip"] else None for q in data["qa"]
    }
    sessions = {s.id for s in await store.sessions.list() if s.kind == "training"}
    prev = await store.get_graph()
    graph = validate(out.output, sop, clean, sessions).model_copy(
        update={
            "version": (prev.version + 1) if prev else 1,
            "built_at": datetime.now(UTC),
            "prompt_version": out.prompt_ref,
        }
    )
    await store.put_graph(graph)
    return graph
