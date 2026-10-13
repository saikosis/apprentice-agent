#!/usr/bin/env bash
set -euo pipefail
uv run python -m scripts.export_schema > shared/schema.json
pnpm --dir frontend exec json2ts -i ../shared/schema.json -o src/types/contract.ts
