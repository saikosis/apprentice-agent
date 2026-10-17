"""Drive the whole pipeline from a laptop before Firestore exists (needs only GEMINI_API_KEY).

State lives in a JSON file (LOCAL_DB, default data/local.json). Model Armor reports "skipped" unless
GCP_PROJECT + MA_TEMPLATE are set and you have credentials.

    uv run --env-file .env python -m scripts.local seed-sop
    uv run --env-file .env python -m scripts.local process recordings/s1.webm --kind training
    uv run --env-file .env python -m scripts.local probes --open
    uv run --env-file .env python -m scripts.local answer p-1a2b3c4d "Kaveri is consignment, no PO."
    uv run --env-file .env python -m scripts.local discover
    uv run --env-file .env python -m scripts.local build-graph
    uv run --env-file .env python -m scripts.local generate-cases --heldout s-xxxx s-yyyy
    uv run --env-file .env python -m scripts.local label c-01 approve "Ties to the consignment statement."
    uv run --env-file .env python -m scripts.run_exam --ws live --runs 3

Other scenarios: put --scenario essays|volunteers before the command (and on run_exam).
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from typing import Any

os.environ.setdefault("LOCAL_DB", "data/local.json")

from backend.app.contract import ExpertLabel, ProbeAnswer, Session
from backend.app.store import Store, new_id


def show(obj: Any) -> None:
    print(json.dumps(obj, indent=2, ensure_ascii=False, default=str))


async def main(args: argparse.Namespace) -> None:
    store = Store("live", scenario=args.scenario)
    match args.cmd:
        case "seed-sop":
            from scripts import make_synthetic, synthetic_essays, synthetic_volunteers

            builders = {
                "ap": make_synthetic.build_sop,
                "essays": synthetic_essays.build_sop,
                "volunteers": synthetic_volunteers.build_sop,
            }
            sop = builders[args.scenario]()
            await store.sop.put(sop)
            print(f"stored SOP {sop.id}")
        case "process":
            from backend.app.pipeline import files, segment

            s = Session(
                id=args.session_id or new_id("s"),
                workspace="live",
                expert_uid="local",
                kind=args.kind,
                status="processing",
                started_at=datetime.now(UTC),
                live_enabled=False,
            )
            await store.sessions.put(s)
            print(f"session {s.id}: uploading {args.video} to the Gemini Files API…")
            video = await files.upload_path(args.video)
            try:
                await segment.process_session(store, s.id, video=video)
            except Exception as e:  # record why, then show the traceback
                await store.sessions.put(
                    s.model_copy(update={"status": "failed", "error": str(e)[:300]})
                )
                raise
            devs = await store.deviations(s.id).list()
            print(
                f"session {s.id}: {len(await store.segments(s.id).list())} steps, {len(devs)} deviations"
            )
            show(
                [
                    d.model_dump(include={"sop_rule", "timestamp", "invoice_id", "description"})
                    for d in devs
                ]
            )
        case "probes":
            rows = [
                (p, a) for p, a in await store.probes.with_answers() if not args.open or a is None
            ]
            show(
                [
                    {
                        "id": p.id,
                        "type": p.cdm_type,
                        "sop": p.sop_rule,
                        "question": p.question,
                        "answer": a.text if a else None,
                    }
                    for p, a in rows
                ]
            )
        case "answer":
            from backend.app.routers.probes import save_answer

            answer = (await save_answer(store, args.probe_id, args.text, "typed"))["answer"]
            flagged = (
                isinstance(answer, ProbeAnswer)
                and answer.moderation
                and answer.moderation.match_found
            )
            print(
                "saved; flagged by Model Armor, so it stays out of the graph"
                if flagged
                else "saved"
            )
        case "discover":
            from backend.app.pipeline import variants

            show(
                [
                    v.model_dump(include={"name", "frequency", "session_ids"})
                    for v in await variants.discover(store)
                ]
            )
        case "build-graph":
            from backend.app.pipeline import graph

            g = await graph.build(store)
            print(f"graph v{g.version}: {len(g.nodes)} nodes, {len(g.edges)} edges")
            show(
                [{"id": n.id, "kind": n.kind, "label": n.label, "sop": n.sop_rule} for n in g.nodes]
            )
        case "generate-cases":
            from backend.app.exam import scenarios

            cases = await scenarios.generate(store, args.heldout, args.n)
            show(
                [
                    {
                        "id": c.id,
                        "origin": c.origin,
                        "trap": c.trap_type,
                        "item": c.item,
                        "tests": c.tests_rule,
                    }
                    for c in cases
                ]
            )
        case "label":
            c = await store.exam_cases.get(args.case_id)
            if c is None:
                raise SystemExit(f"no case {args.case_id}")
            lbl = ExpertLabel(
                decision=args.decision,
                rationale=args.rationale,
                labeled_by="local",
                labeled_at=datetime.now(UTC),
            )
            await store.exam_cases.put(c.model_copy(update={"expert_label": lbl}))
            print(f"labelled {c.id}: {args.decision}")


def cli() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # ₹ on Windows consoles
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--scenario", choices=["ap", "essays", "volunteers"], default="ap")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed-sop")
    p = sub.add_parser("process")
    p.add_argument("video")
    p.add_argument("--kind", choices=["training", "heldout"], default="training")
    p.add_argument("--session-id")
    p = sub.add_parser("probes")
    p.add_argument("--open", action="store_true")
    p = sub.add_parser("answer")
    p.add_argument("probe_id")
    p.add_argument("text")
    sub.add_parser("discover")
    sub.add_parser("build-graph")
    p = sub.add_parser("generate-cases")
    p.add_argument("--heldout", nargs="*", default=[])
    p.add_argument("--n", type=int, default=8)
    p = sub.add_parser("label")
    p.add_argument("case_id")
    p.add_argument("decision", choices=["approve", "reject", "hold", "escalate"])
    p.add_argument("rationale")
    asyncio.run(main(ap.parse_args()))


if __name__ == "__main__":
    cli()
