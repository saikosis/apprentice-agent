"""SOP-only and SOP+graph arms; never see expert_label (prompts/arm_*.md)."""

import asyncio
import json
import logging
import time
from typing import Any

from backend.app import domains, gemini, prompts
from backend.app.contract import SOP, AgentOutput, AgentRun, Arm, DecisionGraph, ExamCase
from backend.app.safety import armor
from backend.app.store import Store

CONCURRENCY = 6  # SPEC §9
PROMPT: dict[Arm, str] = {"sop_only": "arm_sop", "sop_graph": "arm_graph"}
log = logging.getLogger(__name__)

# What a new analyst would actually see. The label is judge-only, and trap_type / tests_rule / origin
# would hint at the answer.
_HIDDEN_FROM_ARMS = {"expert_label", "trap_type", "tests_rule", "origin"}


def case_input(case: ExamCase) -> dict[str, Any]:
    """The ONLY way a case reaches an arm."""
    return case.model_dump(mode="json", exclude=_HIDDEN_FROM_ARMS)


def run_id(report_id: str, case_id: str, arm: Arm, i: int) -> str:
    return f"{report_id}-{case_id}-{arm}-{i}"


async def run_one(
    store: Store,
    report_id: str,
    case: ExamCase,
    payload: dict[str, Any],
    arm: Arm,
    i: int,
    sop: SOP,
    graph: DecisionGraph,
    moderation_in_id: str | None,
) -> AgentRun:
    rid = run_id(report_id, case.id, arm, i)
    values = domains.values(store.scenario, SOP=sop.full_text)
    if arm == "sop_graph":
        values["GRAPH"] = graph.model_dump_json()
    t0 = time.monotonic()
    base: dict[str, Any] = {
        "id": rid,
        "case_id": case.id,
        "arm": arm,
        "run_index": i,
        "model": gemini.FLASH_MODEL,
        "prompt_version": prompts.load(PROMPT[arm]).ref,
        "moderation_in_id": moderation_in_id,
    }
    try:
        out = await gemini.structured(
            gemini.FLASH_MODEL,
            PROMPT[arm],
            [gemini.data("Case", payload)],
            AgentOutput,
            values=values,
        )
    except Exception as e:  # noqa: BLE001  any failed run is a miss, never the end of the exam
        log.warning("run %s failed: %s", rid, e)
        return AgentRun(**base, output=None, latency_ms=int((time.monotonic() - t0) * 1000))
    text = out.output.rationale + "\n" + "\n".join(out.output.planned_steps)
    mod = await armor.screen_output(text, "agent_output", rid)
    await store.moderation.put(mod)
    return AgentRun(
        **{**base, "prompt_version": out.prompt_ref},
        output=out.output,
        blocked=mod.match_found,
        moderation_out_id=mod.id,
        latency_ms=int((time.monotonic() - t0) * 1000),
    )


async def run_all(
    store: Store, report_id: str, cases: list[ExamCase], sop: SOP, graph: DecisionGraph, runs: int
) -> list[AgentRun]:
    """Every case × both arms × `runs`, at most 6 model calls at a time."""
    gate = asyncio.Semaphore(CONCURRENCY)
    prepared = []
    for c in cases:
        payload = case_input(c)
        mod = await armor.screen_input(json.dumps(payload, ensure_ascii=False), "exam_input", c.id)
        await store.moderation.put(mod)
        if mod.match_found:  # both arms get the same warning, so it can't favour either
            payload["model_armor_note"] = (
                "Model Armor flagged text in this case as a likely prompt injection."
            )
        prepared.append((c, payload, mod.id))

    async def one(c: ExamCase, payload: dict[str, Any], mid: str, arm: Arm, i: int) -> AgentRun:
        async with gate:
            return await run_one(store, report_id, c, payload, arm, i, sop, graph, mid)

    return list(
        await asyncio.gather(
            *(
                one(c, p, mid, arm, i)
                for c, p, mid in prepared
                for arm in PROMPT
                for i in range(runs)
            )
        )
    )
