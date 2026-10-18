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
from backend.app.routers.demo import DemoSeed, export_seed
from backend.app.store import Store, Ws


async def export(store: Store) -> DemoSeed:
    return await export_seed(store)


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
