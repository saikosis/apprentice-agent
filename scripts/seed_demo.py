"""Load fixtures/demo_seed.json into workspace `demo`. docs/SPEC.md §8.

uv run python scripts/seed_demo.py fixtures/demo_seed.json   (needs GCP credentials)
"""

import asyncio
import sys
from pathlib import Path

from backend.app.routers.demo import DemoSeed, load_seed
from backend.app.store import Store


def main() -> None:
    seed = DemoSeed.model_validate_json(Path(sys.argv[1]).read_text(encoding="utf-8"))
    asyncio.run(load_seed(Store("demo", allow_demo_writes=True), seed))
    print(f"seeded demo: {len(seed.sessions)} sessions, {len(seed.probes)} probes")


if __name__ == "__main__":
    main()
