# AGENTS.md — Apprentice (read this before writing any code)

Tool-neutral instructions for AI coding agents (Claude Code via CLAUDE.md import; Pi reads this file directly).

## Project summary
Apprentice watches an expert work in Google Sheets + Gmail (screen + voice), asks CDM "why" probes (live via Gemini Live, and in batch), builds a decision graph citing video timestamps and SOP sections, and runs a successor exam: SOP-only agent vs SOP+graph agent, scored by an LLM judge. Hackathon build: Oct 14–16, 2026; code freeze Oct 17 18:00 IST; submit Oct 18 by 12:00 IST.

## Repo layout
````
/AGENTS.md  /CLAUDE.md  /README.md  /Dockerfile  /Makefile
/backend/            # Person A owns (FastAPI, Python 3.12)
  app/main.py        # FastAPI app, static mount, routers
  app/contract.py    # Pydantic v2 models = SOURCE OF TRUTH
  app/routers/       # auth.py live.py uploads.py sessions.py probes.py graph.py exam.py sheets.py demo.py
  app/pipeline/      # files.py segment.py deviations.py variants.py probes.py graph.py
  app/exam/          # scenarios.py arms.py judge.py report.py
  app/safety/armor.py
  app/store.py       # Firestore access (workspace-scoped)
  app/gemini.py      # client, model IDs, structured-call helper
  app/domains/       # one pack per scenario (ap, essays, volunteers): domain.md, config.json, reference.json
  tests/
/frontend/           # Person B owns (Vite + React + TS)
  src/types/contract.ts   # GENERATED from backend contract — do not hand-edit
  src/api/  src/pip/  src/recorder/  src/live/  src/views/  src/demo/
/shared/schema.json  # generated JSON Schema of the contract
/fixtures/           # JSON fixtures matching the contract (demo seed + UI dev)
/prompts/            # one .md file per Gemini call, versioned
/scripts/            # export_schema.py gen_types.sh seed_demo.py make_synthetic.py run_exam.py deploy.sh
/docs/               # PRD.md ARCHITECTURE.md SPEC.md
/eval/               # exam outputs, chart PNG, hand-check notes
````

## Tech stack (pin these)
- Python 3.12, `uv`; FastAPI, uvicorn, pydantic v2, `google-genai` (latest 2026-10), `google-cloud-firestore`, `google-cloud-storage`, `google-cloud-modelarmor`, `firebase-admin`, `pytest`, `ruff`, `mypy` (lenient).
- Node 22, pnpm; Vite, React 19, TypeScript strict, `@google/genai` (latest 2026-10), `firebase` (Auth), `cytoscape` + `react-cytoscapejs`, `recharts`, `json-schema-to-typescript`.
- Models (env-overridable): `LIVE_MODEL=gemini-3.8-live`, `FLASH_MODEL=gemini-3.8-flash`, `PRO_MODEL=gemini-3.1-pro-preview` (optional, graph builder only).
- GCP: project `aibuildercup-india-2026`, region `asia-south1`; Cloud Run service `apprentice`; bucket `apprentice-recordings-aibc2026`; Firestore (Native) asia-south1; Model Armor template `apprentice-default` in asia-south1.

## Commands
````
make setup        # uv sync; cd frontend && pnpm i
make dev          # backend :8080 (uvicorn --reload) + vite :5173 (proxy /api → 8080)
make types        # uv run python -m scripts.export_schema > shared/schema.json && pnpm --dir frontend exec json2ts -i ../shared/schema.json -o src/types/contract.ts
make test         # uv run pytest -q backend/tests && pnpm --dir frontend test --run
make lint         # uv run ruff check backend && uv run ruff format --check backend && pnpm --dir frontend lint && pnpm --dir frontend tsc --noEmit
make build        # pnpm --dir frontend build → backend/app/static
make seed-demo    # uv run python scripts/seed_demo.py fixtures/demo_seed.json
make deploy       # scripts/deploy.sh (gcloud run deploy --source .)
````
Deploy flags (scripts/deploy.sh): `gcloud run deploy apprentice --source . --region asia-south1 --allow-unauthenticated --min-instances 1 --no-cpu-throttling --timeout 900 --memory 1Gi --service-account apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com --set-secrets GEMINI_API_KEY=gemini-api-key:latest --set-env-vars GCP_PROJECT=aibuildercup-india-2026,BUCKET=apprentice-recordings-aibc2026,MA_LOCATION=asia-south1,MA_TEMPLATE=apprentice-default,EXPERT_EMAIL=...,ADMIN_UIDS=...`. One-time Google Cloud setup: `docs/Cloud_Setup.md`.

## Coding conventions
- Python: full type hints; Pydantic v2 models only (`model_config = ConfigDict(extra="forbid")`); async FastAPI handlers; ruff defaults + isort; no bare `except`; log with `structlog`/`logging` JSON.
- TS: `strict: true`; React function components + hooks only; no `any` (use generated types); data fetching through `src/api/client.ts` only; Tailwind or plain CSS modules, no UI-kit churn.
- Every Gemini batch call goes through `app/gemini.py::structured(model, prompt_id, parts, schema)`, which sets `response_mime_type="application/json"` and `response_json_schema=<PydanticModel>.model_json_schema()` (the SDK's `response_schema` rejects the contract's `dict` fields in Developer API mode), validates, retries once on validation error, and records `prompt_id@version` + model on the output.

## Data-contract-first rule
1. `backend/app/contract.py` is the source of truth. Change it first, then run `make types`, then commit both in the same commit.
2. Never hand-edit `frontend/src/types/contract.ts`.
3. Fixtures in `/fixtures` must validate against the contract (`pytest backend/tests/test_fixtures.py`).
4. API shapes are in docs/SPEC.md §3; changing a shape needs a message to the other person.

## Ownership boundaries
- Person A (Claude Code): `backend/app/pipeline`, `backend/app/exam`, `backend/app/safety`, `backend/app/routers/live.py`, `prompts/`, `eval/`, `scripts/run_exam.py`, `scripts/make_synthetic.py`.
- Person B (Pi): `frontend/**`, `Dockerfile`, `scripts/deploy.sh`, deck, video.
- Shared (announce before editing): `backend/app/contract.py`, `backend/app/main.py`, `backend/app/store.py`, `fixtures/`, `Makefile`, docs.
- Agents must not edit files outside their owner's area unless the task says so.

## Guardrails (hard rules)
- Never commit secrets, `.env`, service-account keys, OAuth client secrets, or tokens. `.gitignore` covers them; run `git diff --cached` before committing.
- The Gemini API key exists only server-side (Secret Manager → env). The browser only ever receives ephemeral Live tokens with `uses: 1`, minted with full `liveConnectConstraints`.
- No tokens (ephemeral, OAuth access, Firebase) in localStorage/sessionStorage/IndexedDB. Memory only.
- All Gemini batch outputs are structured through Pydantic schemas. No free-text parsing.
- All untrusted text (segment text/transcripts, email text seen in video, probe answers, exam case inputs, agent outputs) goes through `safety/armor.py` before the graph builder or before display as "trusted". Flagged text is stored with its ModerationResult and excluded from graph inputs.
- Exam labels (`expert_label`) are NEVER passed to the graph builder, probe generator or arms. Only the judge reads them. A unit test enforces this.
- No writes to Google Sheets or Gmail. Sheets access is read-only and only for the Connect Sheet flow.
- Demo mode (`/demo`, workspace `demo`) must work at every commit; CI-like check: `pytest -k demo` + manual load of `/demo`.
- Deploy at least once a day (end of day IST) and post the URL in the team chat.
- Do not add new cloud services, databases, vector stores or frameworks without both people agreeing.

## Prompts
- One file per call in `/prompts`: `segmenter.md, deviations.md, variants.md, probes.md, graph.md, scenarios.md, arm_sop.md, arm_graph.md, judge.md, live_system.md, summary.md, observed_workflow.md` (the last two are display only).
- Front-matter: `id`, `version` (int), `model`, `thinking_level`, `output_schema` (Pydantic class name). Bump `version` on any change; outputs store `prompt_id@version`.
- Use `{{SOP}}`, `{{SEGMENTS}}`-style placeholders filled by `app/prompts.py`.
- Prompts are scenario-neutral: every one has `{{DOMAIN}}`, filled from `app/domains/<scenario>/domain.md` via `domains.values(...)`. The part after `<!-- exam-only` (trap definitions) goes only to `scenarios` and `judge`. Scenarios: `docs/Scenarios.md`.

## Fixtures
- `fixtures/*.json` mirror API responses (session list, session detail, probes, graph, exam report). B builds the UI against these until A's endpoints are live (`VITE_USE_FIXTURES=1`).
- `fixtures/demo_seed.json` is produced from a real run by `scripts/export_demo.py` and loaded with `make seed-demo`.

## Testing expectations (minimal but real)
- Backend: contract round-trip tests; fixture validation; `test_no_label_leakage` (graph builder inputs contain no `expert_label` fields); dedup unit test; armor client mocked test; one live smoke test behind `RUN_LIVE_TESTS=1`.
- Frontend: type-check; one render test per view against fixtures; manual checklist for PiP/recorder (Chrome only).

## Definition of done (per task)
Code merged to `main`; `make lint test` green; types regenerated if the contract changed; works in the deployed URL (not only localhost); demo mode still loads; screenshots/notes in the PR description.

## Do NOT build
Human-successor arm; Sheets/Gmail writes; computer use; Chrome extension; multi-language; RBAC; RAG/vector store/policy KB; embeddings/clustering; Agent Runtime/Agent Gateway deployment; Firebase Hosting; Cloud SQL; mobile layouts; user management screens.