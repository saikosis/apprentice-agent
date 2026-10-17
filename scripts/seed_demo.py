"""Load fixtures/demo_seed.json into workspace `demo`. docs/SPEC.md §8.

uv run python scripts/seed_demo.py fixtures/demo_seed.json   (needs GCP credentials)
uv run python scripts/seed_demo.py fixtures/demo_seed_essays.json essays   (another scenario's demo)
"""

import asyncio
import sys
from pathlib import Path

from backend.app.routers.demo import DemoSeed, load_seed
from backend.app.store import Store


def main() -> None:
    seed = DemoSeed.model_validate_json(Path(sys.argv[1]).read_text(encoding="utf-8"))
    scenario = sys.argv[2] if len(sys.argv) > 2 else "ap"
    store = Store("demo", allow_demo_writes=True, scenario=scenario)  # type: ignore[arg-type]
    asyncio.run(load_seed(store, seed))
    print(f"seeded {store.root}: {len(seed.sessions)} sessions, {len(seed.probes)} probes")


if __name__ == "__main__":
    main()
