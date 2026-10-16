# Apprentice: task list and status

Status as of **Oct 13, 2026**. Done items are ~~struck through~~. Section numbers point to `docs/SPEC.md`.

Split:
- **Person A (ML/backend):** the Gemini pipeline (segment → deviations/variants → probes → graph → scenarios → two arms → judge), the REST API and Firestore behind it, Model Armor, and the evaluation numbers.
- **Person B (UI/deploy):** the React UI (recorder + PiP, probe answers, graph view, exam report, demo mode), Cloud Run deploy, deck and video.

## Where things stand

| Area | State |
|---|---|
| Docs, repo layout, AGENTS.md / CLAUDE.md | Done |
| Data contract (`contract.py`) + JSON Schema + generated TS types | Done |
| Fixtures (8 files, validated by `test_fixtures.py`) | Done (synthetic; replace with the real demo seed on Oct 16) |
| Frontend: all views, recorder, PiP, Live client, demo mode | Done against fixtures; not yet tested against a real backend |
| Backend: routers, store, `gemini.py`, pipeline, exam, safety | **Stubs only** (empty routers, one-line docstrings) |
| Prompts (`/prompts/*.md`) | Front-matter only; every body is `TODO` |
| Scripts (`make_synthetic`, `run_exam`, `seed_demo`, `export_demo`) | Stubs only |
| GCP / Firebase / Model Armor setup | Not started (`gcloud` isn't installed on this machine) |
| Dockerfile + `deploy.sh` | Written, never run. **The Dockerfile build will fail** (see B, Deploy) |

---

## Person A: backend, pipeline, evaluation

### A0. Cloud setup (Oct 13, SPEC §10)
- [ ] Install the gcloud CLI; `gcloud auth login`; `gcloud config set project apprentice-aibc`
- [ ] Create project `apprentice-aibc`, link billing
- [ ] Enable APIs: `run`, `firestore`, `storage`, `secretmanager`, `modelarmor`, `sheets`, `iamcredentials`, `cloudbuild`, `artifactregistry`
- [ ] Firestore (Native) in `asia-south1`; rules deny all client access (SPEC §2)
- [ ] AI Studio API key → Secret Manager secret `gemini-api-key`
- [ ] Service account `apprentice-run@apprentice-aibc.iam.gserviceaccount.com` with these roles:
  - [ ] `roles/secretmanager.secretAccessor` on `gemini-api-key`
  - [ ] `roles/datastore.user`
  - [ ] `roles/storage.objectAdmin` on the bucket
  - [ ] `roles/iam.serviceAccountTokenCreator` on itself (V4 signed URLs on Cloud Run)
  - [ ] `roles/modelarmor.user`
- [ ] Model Armor template `apprentice-default` in `asia-south1` (SPEC §6):
  - [ ] Prompt injection and jailbreak detection, LOW_AND_ABOVE
  - [ ] Sensitive Data Protection basic. Test whether bank-account numbers are caught; if not, switch to advanced with FINANCIAL_ACCOUNT_NUMBER and IBAN_CODE
  - [ ] Malicious URLs on
  - [ ] RAI, MEDIUM_AND_ABOVE
- [ ] Local dev credentials: `gcloud auth application-default login`; put `GEMINI_API_KEY` in `.env` (never commit it)
- [ ] **Live spike (notebook):** ephemeral token + `gemini-3.8-live` + one frame + `log_deviation` tool call. **AC:** a tool call arrives in a script.

### A1. Backend foundation
- [x] ~~`contract.py` (SPEC §1), `scripts/export_schema.py`, `make types`~~
- [x] ~~Contract round-trip and fixture validation tests~~
- [x] ~~`app/gemini.py`:~~
  - [x] ~~Client from `GEMINI_API_KEY`~~
  - [x] ~~`structured(model, prompt_id, parts, schema)`: JSON mime type + schema, validate, retry once, record `prompt_id@version` + model~~ (sends `response_json_schema`; the SDK's `response_schema` rejects the contract's `dict` fields in Developer API mode)
- [x] ~~`app/prompts.py`: load front-matter and body, fill `{{SOP}}` / `{{SEGMENTS}}`-style placeholders~~
- [x] ~~`app/store.py`: Firestore Admin client, workspace-scoped helpers for every collection in SPEC §2. Writes to `demo` return 403.~~
- [x] ~~Auth dependency: verify the Firebase ID token (`firebase-admin`); public routes are `/api/health` and `/api/demo/bundle`~~
- [x] ~~Error shape `{error: {code, message}}`; 409 on state violations~~ (`errors.conflict()`)
- [x] ~~`scripts/make_synthetic.py`:~~ output in `data/synthetic/` (CSV per Sheet tab, emails, SOP, session plan)
  - [x] ~~SOP AP-SOP-07~~
  - [x] ~~10 vendors (incl. V-007 / V-011 lookalike, V-003 critical)~~
  - [x] ~~About 40 invoices; POs; Consignment Statement~~
  - [x] ~~About 14 emails, incl. the injection email (SPEC §7)~~
- [ ] Store the SOP in `workspaces/live/sop/`: run `uv run python -m scripts.make_synthetic --upload-sop` once A0 (Firestore + ADC) is done

### A2. REST API (SPEC §3). The frontend already calls all of these.
- [x] ~~`GET /api/me`~~ (`is_demo_expert` = email matches `EXPERT_EMAIL` env)
- [ ] `POST /api/sessions`, `GET /api/sessions?ws=`, `GET /api/sessions/{id}` (session + segments + deviations + diff)
- [ ] `POST /api/sessions/{id}/upload-url` (V4 signed PUT, 15 min), `/finalize`, `/process` (202 + `asyncio.create_task`)
- [ ] `GET /api/sessions/{id}/video-url` (signed GET, 1 h). Must also work **without login for workspace `demo`**.
- [ ] `POST /api/sessions/{id}/deviations` (live deviation → Deviation + Probe)
- [ ] `GET /api/probes`, `POST` / `PATCH /api/probes/{id}/answer` (Model Armor before storing)
- [ ] `POST /api/variants/discover`, `GET /api/variants`
- [ ] `POST /api/graph/build`, `GET /api/graph?ws=`
- [ ] `POST /api/exam/generate`, `PUT /api/exam/cases/{id}/label`, `POST /api/exam/run`, `GET /api/exam/report/{id}`, `GET /api/exam/reports/latest?ws=`
- [ ] `POST /api/sheets/snapshot` (+ SheetDiff when `phase=after`)
- [ ] `GET /api/demo/bundle` (public), `POST /api/admin/seed-demo` (admin uid only)

### A3. Live backend (SPEC §4)
- [ ] `prompts/live_system.md` (persona, SOP verbatim, rules, "Thanks, noted.", guardrail)
- [ ] `POST /api/live/token`:
  - [ ] `uses: 1`, 30 min expiry, 1 min new-session window
  - [ ] Full `live_connect_constraints`: SOP system prompt, `LOG_DEVIATION` tool, transcription on, sliding-window compression, session resumption handle
- [ ] If the SDK rejects a field, run the fallback ladder in SPEC §4
- [ ] **AC (Oct 14):** an end-to-end live session on the deployed URL logs a deviation and the PiP shows the question
- [ ] **Oct 14, 22:00 kill switch:** if fewer than 2 of 3 planted deviations trigger the tool, go batch-only

### A4. Batch pipeline (SPEC §5, ARCHITECTURE §2)
- [ ] `pipeline/files.py`: GCS → Gemini Files API; poll until ACTIVE
- [ ] `segmenter.md` + `segment.py` (fps 1, media_resolution high) → SegmentList
- [ ] `safety/armor.py` (SPEC §6):
  - [ ] `screen_input` / `screen_output` → ModerationResult
  - [ ] Cache by sha256; `asyncio.gather` with a limit of 8
  - [ ] Treat `skipped` as not flagged, but log it
- [ ] Model Armor on each segment's text; flagged segments get `quarantined=true` and are excluded from the graph
- [ ] `deviations.md` + `deviations.py`: SOP + segments + sheet diff + live deviations; dedup (same rule within 20 s, or same invoice)
- [ ] `variants.md` + `variants.py`: one call over all sessions; runs once 3 or more sessions are processed
- [ ] `probes.md` + `probes.py`: CDM types, at most 4 probes per item, at most 20 words each, few-shot examples from SPEC §5
- [ ] Session status flow `processing → processed | failed` with `error`
- [ ] **AC (Oct 14):** all 3 planted exception types are detected on the dry-run recording

### A5. Graph (SPEC §5)
- [ ] `graph.md` + `graph.py`. Inputs are clean (moderated) answers only.
- [ ] Every exception node has an `overrides` edge to its SOP rule
- [ ] Every cue / rule / exception node cites at least one clip
- [ ] Keep `graph/current` and `graph_history/{version}`
- [ ] Use `PRO_MODEL` only if Flash quality is poor
- [ ] Answer the batch probes with the expert
- [ ] **AC (Oct 15):** at least 3 exception nodes, each linked to an SOP section and a clip; the injection email is flagged

### A6. Exam and evaluation (SPEC §5, §9)
- [ ] `scenarios.md` + `scenarios.py`:
  - [ ] 8 generated cases, with all 3 trap types and at least one case per exception
  - [ ] Plus 2 held-out cases
  - [ ] No labels in the generated cases
- [ ] Expert labels all 10 cases (through the exam page)
- [ ] `arm_sop.md`, `arm_graph.md`, `arms.py`:
  - [ ] Model Armor on inputs and outputs; blocked runs recorded
  - [ ] 3 runs per arm
  - [ ] Concurrency 6
- [ ] `judge.md` + `judge.py`:
  - [ ] Blind to the arm
  - [ ] Rubric weights 0.5 / 0.25 / 0.25
  - [ ] `decision_match` computed in code
- [ ] `report.py` → ExamReport:
  - [ ] Majority decision, stability, judge means, traps handled
  - [ ] Every graph-arm miss creates a `Probe(source="exam_miss")`
- [ ] `scripts/run_exam.py --ws live --runs 3` → stored report + `eval/pilot_chart.png`
- [ ] Hand-check 3 cases (1 trap, 1 agree, 1 disagree); if any differs by more than 1 point, tighten the rubric and re-run
- [ ] Write up the results and the hand-check in `eval/`
- [ ] **AC (Oct 16):** ExamReport stored. Targets: graph arm at least 80% agreement and at least 30 points above SOP-only, or documented actuals.

### A7. Tests (AGENTS.md)
- [x] ~~Contract round-trip, fixture validation~~
- [ ] `test_no_label_leakage`: graph builder, probe generator and arms never receive `expert_label`
- [ ] Dedup unit test (deviations)
- [ ] Mocked Model Armor client test
- [ ] Live smoke test behind `RUN_LIVE_TESTS=1`
- [ ] A `pytest -k demo` test that `/api/demo/bundle` returns data

### A8. Demo seed and wrap-up
- [ ] `scripts/export_demo.py --from live` → `fixtures/demo_seed.json` (SPEC §8)
- [ ] `scripts/seed_demo.py` / `make seed-demo` into workspace `demo`
- [ ] README (setup, architecture, eval results); bug fixes only after Oct 17, 18:00

---

## Person B: UI, deploy, deck, video

### B0. Setup (Oct 13)
- [x] ~~Repo, AGENTS.md / CLAUDE.md, docs~~
- [x] ~~Vite + React + TS skeleton, FastAPI skeleton~~
- [ ] Install pnpm globally (`npm i -g pnpm`) so `make setup` / `make dev` work
- [ ] Firebase project + Google sign-in; set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` at build time
- [ ] Demo Google account; OAuth consent screen (External, Testing, test user = demo account); OAuth client ID → `VITE_GOOGLE_CLIENT_ID` (Connect Sheet)
- [ ] Bucket `apprentice-recordings-<suffix>` in `asia-south1` + CORS (PUT/GET from the service URL and `localhost:5173`)
- [ ] Synthetic Sheet "AP Queue – Oct" (4 tabs) + Gmail emails from a second test account, using A's `make_synthetic.py` output
- [ ] **AC:** deployed hello page; sign-in works; the expert can do one dry-run session

### B1. Frontend (built against fixtures)
- [x] ~~API client (`src/api/client.ts`) for every SPEC §3 endpoint; tokens in memory only~~
- [x] ~~Firebase Auth with in-memory persistence~~
- [x] ~~Sessions list and session detail (steps, clip jump, departures from the SOP, sheet diff, quarantine badge)~~
- [x] ~~Recorder: tab + mic, mixed webm, 1 FPS JPEG frames, 16 kHz PCM mic, signed-URL upload → finalize → process~~
- [x] ~~PiP companion (Document PiP), with an inline fallback~~
- [x] ~~Live client: ephemeral token, `log_deviation` → deviation POST, silent tool response, speech fallback ladder, voice answer save, resume on `goAway`~~
- [x] ~~Probe answer screen with jump-to-clip player~~
- [x] ~~Patterns (variants) view~~
- [x] ~~Decision graph view (cytoscape, node panel with clips and answers)~~
- [x] ~~Exam: arm summary, pilot charts, per-case table, labelling, run exam~~
- [x] ~~Demo mode at `/demo/` (no login, read-only, falls back to fixtures)~~
- [x] ~~Connect Sheet (GIS token client → Invoices tab → snapshot)~~
- [x] ~~Google-style theme (Roboto, Material colours, status chips), light/dark, responsive~~
- [x] ~~Render test per view + parser and graph-layout checks (`pnpm test`)~~
- [ ] Switch off fixtures and run each view against A's live endpoints as they land
- [ ] Manual Chrome checklist: PiP opens; recording indicator; Stop uploads within 30 s for a 4-minute session; live probe appears within 15 s
- [ ] Test Connect Sheet with the real demo Sheet (drop it if it doesn't work by Oct 15, 18:00)
- [ ] Polish empty and error states with real backend errors

### B2. Deploy (Cloud Run)
- [x] ~~`Dockerfile` and `scripts/deploy.sh` written~~
- [ ] **Fix the Dockerfile:** the web stage must `COPY fixtures fixtures`. Demo mode imports `../fixtures/*.json`, so the frontend build fails without it.
- [ ] Pass the `VITE_*` values into the web build stage (build args or a non-secret `.env.production`)
- [ ] First deploy with `BUCKET=... make deploy`; confirm `/api/health`, `/`, `/demo/` on the service URL
- [ ] Deploy every day at end of day IST and post the URL in team chat
- [ ] **AC (Oct 16):** `/demo/` works logged-out in incognito and loads in under 3 s

### B3. Deck and video (Oct 17)
- [ ] Video, 2:45 (hard cap 2:59), following the PRD §13 beats; record the Live clip early in case Live is cut
- [ ] Deck PDF: problem, benefit, feasibility, scalability, architecture, pilot results (A's numbers + chart), roadmap. Verify the METI figure against the source PDF.
- [ ] Oct 17, 18:00 code freeze, final deploy, tag `v1.0`
- [ ] Oct 18: 09:00 incognito smoke test; submit by 10:00 (URL, public repo, video, PDF); hard deadline 12:00 IST

---

## Shared: decisions needed between A and B

Four API gaps the frontend already works around. Agree on each, then update `contract.py` or SPEC §3 and run `make types`.
- [ ] `GET /api/probes` should include each probe's `answer` (ProbeAnswer). The UI reads an optional `answer` field.
- [ ] Add `GET /api/exam/cases` so labelled cases survive a page reload.
- [ ] `GET /api/demo/bundle` should also return `segments` and `deviations` keyed by session id, so demo session pages aren't empty.
- [ ] Expose agent runs (for example `GET /api/exam/runs?case_id=`) so the exam page can show both agents' reasoning side by side (PRD §13 beat 2:00–2:25).
- [ ] Contract freeze v1 at Oct 14, 09:30. `contract.py` already exists; freeze it after the four gaps above are settled.

## Cut order if behind (SPEC §11)
Live → Connect Sheet → probe depth (1 per deviation) → scenario count (8 → 6, keep all traps).
Never cut: decision graph, SOP-only baseline, Model Armor on the injection email, demo mode.
