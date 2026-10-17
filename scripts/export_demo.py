"""Export workspace `live` to fixtures/demo_seed.json. docs/SPEC.md §8.

uv run python -m scripts.export_demo --from live --out fixtures/demo_seed.json
uv run python scripts/seed_demo.py fixtures/demo_seed.json        (then load it into `demo`)
Other scenarios: --scenario essays --out fixtures/demo_seed_essays.json, then seed_demo.py <file> essays.
"""

import argparse
import asyncio
from pathlib import Path
from typing import get_args

from backend.app.contract import Scenario
from backend.app.routers.demo import DemoSeed, SeedProbe
from backend.app.store import Store, Ws


async def export(store: Store) -> DemoSeed:
    sessions = await store.sessions.list()
    reports = await store.exam_reports.list()
    sops = await store.sop.list()
    return DemoSeed(
        workspace="demo",
        sop=max(sops, key=lambda s: s.version) if sops else None,
        sessions=[s.model_copy(update={"workspace": "demo"}) for s in sessions],
        segments={s.id: await store.segments(s.id).list() for s in sessions},
        deviations={s.id: await store.deviations(s.id).list() for s in sessions},
        variants=await store.variants.list(),
        probes=[
            SeedProbe(**p.model_dump(), answer=a) for p, a in await store.probes.with_answers()
        ],
        graph=await store.get_graph(),
        exam_cases=await store.exam_cases.list(),
        agent_runs=await store.agent_runs.list(),
        judge_scores=await store.judge_scores.list(),
        report=max(reports, key=lambda r: r.created_at) if reports else None,
        clips={s.id: s.gcs_uri for s in sessions if s.gcs_uri},
    )


async def main(ws: Ws, out: Path, scenario: Scenario = "ap") -> None:
    seed = await export(Store(ws, scenario=scenario))
    out.write_text(seed.model_dump_json(indent=1), encoding="utf-8")
    print(
        f"wrote {out}: {len(seed.sessions)} sessions, {len(seed.probes)} probes, report={bool(seed.report)}"
    )


def cli() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--from", dest="ws", choices=["live", "demo"], default="live")
    ap.add_argument("--out", type=Path, default=Path("fixtures/demo_seed.json"))
    ap.add_argument("--scenario", choices=get_args(Scenario), default="ap")
    args = ap.parse_args()
    asyncio.run(main(args.ws, args.out, args.scenario))


if __name__ == "__main__":
    cli()
