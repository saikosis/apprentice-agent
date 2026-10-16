# apprentice-agent

An AI apprentice watches an expert work in Google apps (screen + voice) and asks the "why" behind each
decision using Critical Decision Method (CDM) probes. It turns the answers into a decision graph that cites
video timestamps and SOP sections, then checks the knowledge carries over: a successor exam pits an
SOP-only agent against an SOP + graph agent, scored by a blind LLM judge.

Built for the AI Builder Cup (Oct 14–18, 2026). Specs: [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md),
[implementation spec](docs/SPEC.md), [task list](docs/TASKS.md).

## How it works

```
record (tab + mic) ──► Gemini Live asks "why?" in a floating companion window (optional)
        │
        ▼
Cloud Storage ──► Gemini Files API ──► segmenter ──► Model Armor (quarantine injected text)
        ──► deviation detector (vs SOP, deduped against live questions) ──► CDM probes
        ──► expert answers (Model Armor) ──► decision graph (exceptions ⇢ overridden SOP §, every node cites a clip)
        ──► exam cases (+3 trap types) ──► expert labels ──► SOP-only arm ×3 | SOP+graph arm ×3
        ──► blind judge (labels only here) ──► report + new probes for graph-arm misses
```

- One Cloud Run service (FastAPI + the Vite build), Firestore, Cloud Storage, Gemini (`gemini-3.8-flash`,
  `gemini-3.8-live`), Model Armor. The Gemini key stays server-side; the browser gets one-use Live tokens.
- `backend/app/contract.py` is the data contract; `frontend/src/types/contract.ts` is generated from it.
- Exam labels never reach the graph builder, probe generator or arms (`test_no_label_leakage`).

## Setup

```
make setup                     # uv sync + pnpm i
echo GEMINI_API_KEY=... > .env  # AI Studio key; .env is git-ignored, server-side only
make test                      # backend + frontend tests (offline)
```

Run the app: `make dev` (backend :8080, Vite :5173). The demo works with no backend at
http://localhost:5173/demo/ (it falls back to `fixtures/`).

### Run the pipeline on a laptop (before any Google Cloud setup)

Only the Gemini key is needed; state goes to `data/local.json` instead of Firestore, and Model Armor reports
"skipped" until it is configured.

```
uv run python -m scripts.make_synthetic                    # SOP, Sheet tabs, emails → data/synthetic/
uv run --env-file .env python -m scripts.local seed-sop
uv run --env-file .env python -m scripts.local process recording.webm --kind training   # repeat per session
uv run --env-file .env python -m scripts.local probes --open
uv run --env-file .env python -m scripts.local answer <probe_id> "your answer"
uv run --env-file .env python -m scripts.local build-graph
uv run --env-file .env python -m scripts.local generate-cases --heldout <s-id> <s-id>
uv run --env-file .env python -m scripts.local label c-01 approve "one-line reason"
LOCAL_DB=data/local.json uv run --env-file .env python -m scripts.run_exam --runs 3   # → eval/pilot_chart.png
```

Real-API smoke tests: `RUN_LIVE_TESTS=1 uv run --env-file .env pytest -q backend/tests/test_live_smoke.py`.

### Deploy

`make deploy` (see `scripts/deploy.sh` and AGENTS.md). Environment: `GCP_PROJECT`, `BUCKET`, `MA_LOCATION`,
`MA_TEMPLATE`, `EXPERT_EMAIL` (the only account allowed into the live workspace), `ADMIN_UIDS` (may seed the
demo), and the `GEMINI_API_KEY` secret.

## Evaluation

Pending the expert's labelled pilot run (`scripts/run_exam.py --ws live --runs 3`). Results and the 3-case
hand-check go in `eval/`.
