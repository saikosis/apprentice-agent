# Apprentice

**Live app: https://apprentice-410061958227.asia-south1.run.app** · Read-only demo, no sign-in:
https://apprentice-410061958227.asia-south1.run.app/demo/

Apprentice is an AI apprentice that sits beside an expert while they work in Google Sheets, Docs, Forms and Gmail. It
watches the screen, listens, and asks *why* whenever the expert departs from the written procedure. It turns the answers
into a decision graph, then **tests whether the knowledge carried over**: an AI successor with only the SOP is compared
with one that also has the graph, on cases the expert labels.

Built for the AI Builder Cup (Oct 14–18, 2026).

## The problem

When an experienced operator leaves, retires or rotates, the SOP stays but the judgement leaves with them. SOPs say
*what* to do; experts know *when the rule doesn't apply, and why*: the consignment vendor that never has a PO, the
student whose accommodation waives the late penalty, the returning volunteer who always gets a place on a full shift.

Tools that record clicks (step recorders) or search documents capture none of that, and none of them check whether a
successor can actually make those calls. Apprentice does both: it captures the reasons, and measures the transfer.

**Who it helps:** any team that runs on a few experienced people and a procedure that doesn't cover everything.
Finance ops, schools, non-profits and back offices are the examples built here. Team leads get evidence of what a
successor can now handle before the expert leaves, plus a list of the gaps still to close.

## What it does

| Step | What happens | Where in the app |
|---|---|---|
| 1. Record | The expert shares the tab they work in and talks as they go. Optionally, Gemini Live watches (1 frame/s + mic) and asks a short "why" question out loud, in a floating companion window, the moment they step outside the SOP. | **Record a session** |
| 2. Understand | Gemini splits the video into steps per work item, writes a plain-language summary, and finds each departure from the SOP, citing the section and the video moment. | **Sessions** |
| 3. Ask why | Critical Decision Method (CDM) questions: what cue you noticed, what you were protecting, what would change your mind. The expert answers by voice or typing. | **Questions** |
| 4. Find patterns | A departure seen twice becomes a pattern, from as little as one session. Apprentice also shows the workflow the expert actually followed, marked against the SOP. | **Patterns** |
| 5. Build the graph | SOP rules, the expert's exceptions and their reasons, each linked to the video clip and the SOP section it overrides. Only the expert's own words become rules. | **Decision graph** |
| 6. Successor exam | Gemini writes practice cases from the graph, including traps (lookalike names, instructions hidden in an email). The expert labels them. Both AI successors decide each case, and a blind LLM judge scores them against the labels. | **Successor exam** |
| 7. Close the gaps | Every case the graph successor still gets wrong becomes a new question to the expert. Answer it, rebuild the graph, re-run the exam. | **Questions** |

**What the exam proves.** Both successors use the same model and the same case; the only difference is the graph. If
the graph successor agrees with the expert more often, the gain came from what Apprentice learned. Exam labels never
reach the graph builder, the question generator or the successors (enforced by `test_no_label_leakage`). The report
shows agreement per successor, the judge's score, trap cases handled, and the answers per case side by side.

## Try it

**Judges:** open the live app, sign in with any Google account, and enter the judge code from the submission notes.
You get a private sandbox that already holds a sample run for each workflow. Download the practice files, record a few
minutes of work, answer the questions, and watch the patterns, graph and exam change. A guided tour starts on your first
sign-in (the compass button beside the theme toggle replays it). Full walkthrough: [docs/Judge_Guide.md](docs/Judge_Guide.md)
(Part 2).

**Three workflows**, switched from the sidebar, each with its own SOP, planted unwritten rules and exam traps
([docs/Scenarios.md](docs/Scenarios.md)):

| Workflow | Tools | Example unwritten rule |
|---|---|---|
| Invoice approval | Sheets + Gmail | A consignment vendor has no PO: tick it against the statement tab instead |
| Essay marking | Docs + Sheets + Gmail | An approved accommodation means no late deduction |
| Volunteer sign-ups | Forms responses Sheet + Gmail | A 16–17-year-old can come if a parent emails consent themselves |

**Results so far** (one sample session per workflow from its 6-item recording plan, on real Gemini; the session is
written as steps, with no video):

| Workflow | Patterns found | Exam agreement: SOP only → SOP + graph |
|---|---|---|
| Volunteer sign-ups | 3 of 3 planted | 50% → 83% (6 cases) |
| Essay marking | 3 of 3 planted | 33% → 67% (6 cases) |

These are pilot numbers on synthetic data and small case sets; they show the mechanism, not a statistically strong result.

## How we built it

```
record (tab + mic) ──► Gemini Live asks "why?" in a floating companion window (optional)
        │
        ▼
Cloud Storage ──► Gemini Files API ──► segmenter ──► Model Armor (quarantine injected text)
        ──► deviation detector (vs SOP, deduped against live questions) ──► CDM questions ──► summary
        ──► expert answers (Model Armor) ──► patterns (+ observed workflow) ──► decision graph
        ──► exam cases (+ traps) ──► expert labels ──► SOP-only successor | SOP + graph successor
        ──► blind judge (the only reader of labels) ──► report + new questions for the graph successor's misses
```

- **Google Cloud:** one Cloud Run service (FastAPI + the React build) in asia-south1, Firestore, Cloud Storage,
  Secret Manager, Firebase Auth, Model Armor.
- **Gemini:** `gemini-3.8-live` for the live interviewer; `gemini-3.8-flash` for every batch step. Every batch call
  returns JSON validated against a Pydantic schema, and records the prompt version and model.
- **Safety:**
  - The Gemini key stays on the server. The browser gets a one-use Live token, with the whole session setup locked
    into it, and keeps tokens in memory only.
  - Text read from the screen, the expert's answers, exam cases and the successors' outputs all pass through Model
    Armor. Flagged text is kept out of the graph.
  - Instructions found in emails are treated as data: one exam trap tests exactly that.
  - Sheets access is read-only, and there are no writes to Sheets or Gmail.
- **Workflows as data:** each workflow is a domain pack (`backend/app/domains/<id>/`) holding its wording, labels,
  reference table, recording plan and practice files. Every prompt is scenario-neutral and gets a `{{DOMAIN}}` block.
- **Judge sandbox:** a code-gated private workspace per Google account, with limits per judge and a daily global cap.
  Sandboxes are deleted after 14 days, and admins get a read-only view ([docs/Judge_Sandbox.md](docs/Judge_Sandbox.md)).
- **Frontend:** Vite + React 19 + TypeScript (strict), shadcn/ui + Tailwind v4, Cytoscape for the graph, recharts.
  It has a Document Picture-in-Picture companion, light and dark themes, and a guided tour with coach marks and beacons.

More detail: [architecture](docs/ARCHITECTURE.md) (diagrams), [implementation spec](docs/SPEC.md) (contract, API,
prompts), [PRD](docs/PRD.md), [task list](docs/TASKS.md).

## Repo map

```
backend/app/        FastAPI: routers/, pipeline/ (segment, deviations, variants, probes, graph, summary),
                    exam/ (scenarios, arms, judge, report), safety/armor.py, domains/, sandbox.py, contract.py
frontend/src/       React app: views/, recorder/, pip/, live/, tour.tsx; types/contract.ts is generated
prompts/            one versioned .md per Gemini call
scripts/            synthetic data, local runner, sample run, exam runner, deploy, cloud setup
fixtures/           JSON matching the contract (UI development + demo fallback)
docs/               PRD, architecture, spec, cloud setup, scenarios, judge sandbox and guide
```

## Run it yourself

```
make setup                      # uv sync + pnpm i
echo GEMINI_API_KEY=... > .env  # AI Studio key; .env is git-ignored, server-side only
make test                       # backend + frontend tests (offline)
make dev                        # UI on :5173 (+ backend :8080); /demo/ works with no backend (fixtures)
```

**Whole pipeline on a laptop, with no Google Cloud** (state in `data/local.json`, Model Armor "skipped"):

```
uv run python -m scripts.make_synthetic                      # invoices → data/synthetic/ (--scenario essays|volunteers → data/synthetic/<scenario>/)
uv run --env-file .env python -m scripts.local seed-sop
uv run --env-file .env python -m scripts.local process recording.webm --kind training
uv run --env-file .env python -m scripts.local probes --open
uv run --env-file .env python -m scripts.local answer <probe_id> "your answer"
uv run --env-file .env python -m scripts.local build-graph
uv run --env-file .env python -m scripts.local generate-cases --heldout <s-id> <s-id>
uv run --env-file .env python -m scripts.local label c-01 approve "one-line reason"
LOCAL_DB=data/local.json uv run --env-file .env python -m scripts.run_exam --runs 3
```

A sample run of one workflow from its recording plan, on real Gemini and with no video:
`LOCAL_DB=data/sample.json uv run --env-file .env python -m scripts.sample_run --scenario essays`.

`make dev` doesn't load `.env` or set `LOCAL_DB`. For a backend that calls Gemini and keeps state in a local file, use:

**UI against a local backend:** start the backend with `LOCAL_DB=data/local.json DEV_USER_EMAIL=expert@example.com
EXPERT_EMAIL=expert@example.com uv run --env-file .env uvicorn backend.app.main:app --reload --port 8080`, then run
`VITE_DEV_AUTH=1 pnpm --dir frontend dev`. This sign-in bypass is laptop-only; it never ships.

**Deploy:** one-time setup in [docs/Cloud_Setup.md](docs/Cloud_Setup.md), then `bash scripts/deploy.sh`. It needs
`EXPERT_EMAIL`, `ADMIN_UIDS`, `SANDBOX_CODE` and the public `VITE_*` Firebase values; the Gemini key comes from
Secret Manager. The judge sandbox steps are in [docs/Judge_Guide.md](docs/Judge_Guide.md).

Real-API smoke test: `RUN_LIVE_TESTS=1 uv run --env-file .env pytest -q backend/tests/test_live_smoke.py`.

## Limits and what's next

- **Pilot scale:** 6–10 exam cases with synthetic data. A real deployment needs dozens of real cases per decision type.
- **Out of scope:** Apprentice doesn't do the work. It has no computer use and no writes. It measures how much of
  the job a successor can take on, which is the evidence you need before deciding what to automate.
- **Roadmap:**
  - a Chrome extension for richer Gmail context
  - a policy knowledge base from Drive
  - live interviews in Japanese and Hindi
  - compiled successor agents that hand uncertain cases back to a person
