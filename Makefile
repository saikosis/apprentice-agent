.PHONY: setup dev types test lint build seed-demo deploy

setup:
	uv sync
	cd frontend && pnpm i

dev:
	uv run uvicorn backend.app.main:app --reload --port 8080 & pnpm --dir frontend dev

types:
	uv run python -m scripts.export_schema > shared/schema.json
	pnpm --dir frontend exec json2ts -i ../shared/schema.json -o src/types/contract.ts

test:
	uv run pytest -q backend/tests
	pnpm --dir frontend test --run

lint:
	uv run ruff check backend
	uv run ruff format --check backend
	pnpm --dir frontend lint
	pnpm --dir frontend tsc --noEmit

build:
	pnpm --dir frontend build

seed-demo:
	uv run python scripts/seed_demo.py fixtures/demo_seed.json

deploy:
	bash scripts/deploy.sh
