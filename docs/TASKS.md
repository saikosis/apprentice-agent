# Apprentice: task list and status

Status as of **Oct 17, 2026**. Done items are ~~struck through~~. Section numbers point to `docs/SPEC.md`.

Split:
- **Person A (ML/backend):** the Gemini pipeline (segment → deviations/variants → probes → graph → scenarios → two arms → judge), the REST API and Firestore behind it, Model Armor, and the evaluation numbers.
- **Person B (UI/deploy):** the React UI (recorder + PiP, probe answers, graph view, exam report, demo mode), Cloud Run deploy, deck and video.

## Where things stand

| Area | State |
|---|---|
| Docs, repo layout, AGENTS.md / CLAUDE.md | Done |
| Data contract (`contract.py`) + JSON Schema + generated TS types | Done |
| Fixtures (10 files incl. `exam_cases.json` and `agent_runs.json`, validated by `test_fixtures.py`) | Done (synthetic; replace with the real demo seed after the real run) |
| Frontend: all views, recorder, PiP, Live client, demo mode | Done; rebuilt on shadcn/ui + Tailwind v4 (Oct 16). Tested against fixtures; can run against a local backend (`VITE_DEV_AUTH=1`), not yet against a deployed one |
| Backend: routers, store, `gemini.py`, pipeline, exam, safety | Done and tested offline; pipeline + exam verified end to end on real Gemini (text dry run) |
| Prompts (`/prompts/*.md`) | All 10 written |
| Scripts (`make_synthetic`, `local`, `run_exam`, `seed_demo`, `export_demo`) | Done; `local.py` runs everything on a laptop before A0 |
| Real recording through the segmenter; expert answers and labels; real exam numbers | Not yet |
| GCP / Firebase / Model Armor setup | Not started. Steps written in `docs/Cloud_Setup.md` (Console, CLI and `scripts/cloud_setup.sh`); project `aibuildercup-india-2026` |
| Dockerfile + `deploy.sh` | Fixed; image built and smoke-tested locally. Never deployed |

---

## Person A: backend, pipeline, evaluation

### A0. Cloud setup (SPEC §10). Step-by-step: `docs/Cloud_Setup.md` (step numbers in brackets)
- [x] ~~Install the gcloud CLI; `gcloud auth login`~~
- [x] ~~Decide the project id~~: `aibuildercup-india-2026` (existing project; docs and `deploy.sh` updated)
- [ ] Link billing account "Personal" to `aibuildercup-india-2026` [2]; budget ₹5,000/month with alerts at 50/90/100% [3]
- [ ] Enable APIs: `run`, `firestore`, `storage`, `secretmanager`, `modelarmor`, `sheets`, `iamcredentials`, `cloudbuild`, `artifactregistry`
- [ ] Firestore (Native) in `asia-south1`; rules deny all client access (SPEC §2)
- [ ] AI Studio API key → Secret Manager secret `gemini-api-key`
- [ ] Service account `apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com` with these roles [7, 9]:
  - [ ] `roles/secretmanager.secretAccessor` on `gemini-api-key`
  - [ ] `roles/datastore.user`
  - [ ] `roles/storage.objectAdmin` on the bucket
  - [ ] `roles/iam.serviceAccountTokenCreator` on itself (V4 signed URLs on Cloud Run)
  - [ ] `roles/modelarmor.user`
- [ ] Model Armor template `apprentice-default` in `asia-south1` (SPEC §6):
  - [ ] Prompt injection and jailbreak detection, LOW_AND_ABOVE
  - [ ] Sensitive Data Protection basic. Test whether bank-account numbers are caught; if not, switch to advanced with FINANCIAL_ACCOUNT_NUMBER and IBAN_CODE
  - [x] ~~Malicious URLs on~~: not offered in asia-south1; left off
  - [ ] RAI, MEDIUM_AND_ABOVE
- [x] ~~Put `GEMINI_API_KEY` in `.env` (never commit it)~~
- [ ] Local dev credentials: `gcloud auth application-default login`
- [ ] **Live spike:** ephemeral token + `gemini-3.8-live` + one frame + `log_deviation` tool call. **AC:** a tool call arrives in a script. Half done: a real token with the full config opens a Live session (`test_live_smoke.py`); the frame + tool call part is still to test. Needs only the Gemini key, not A0.

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
- [x] ~~`GET /api/me`~~ (`is_demo_expert` = verified email matching `EXPERT_EMAIL`; the UI uses it to gate the live workspace)
- [x] ~~`POST /api/sessions`, `GET /api/sessions?ws=`, `GET /api/sessions/{id}` (session + segments + deviations + diff)~~
- [x] ~~`POST /api/sessions/{id}/upload-url` (V4 signed PUT, 15 min), `/finalize`, `/process` (202 + `asyncio.create_task`)~~ (finalize checks the object exists; real signing needs A0's bucket + `iam.serviceAccountTokenCreator`)
- [x] ~~`GET /api/sessions/{id}/video-url` (signed GET, 1 h). Must also work **without login for workspace `demo`**.~~ (anonymous → demo only; signed in → live)
- [x] ~~`POST /api/sessions/{id}/deviations` (live deviation → Deviation + Probe)~~ (server enforces 45 s / 3 per session → 429)
- [x] ~~`GET /api/probes`, `POST` / `PATCH /api/probes/{id}/answer` (Model Armor before storing)~~ (`safety/armor.py` client done; skipped when `MA_TEMPLATE` unset)
- [x] ~~`POST /api/variants/discover`, `GET /api/variants`~~
- [x] ~~`POST /api/graph/build`, `GET /api/graph?ws=`~~
- [x] ~~`POST /api/exam/generate`, `PUT /api/exam/cases/{id}/label`, `POST /api/exam/run`, `GET /api/exam/report/{id}`, `GET /api/exam/reports/latest?ws=`~~
- [x] ~~`GET /api/exam/cases`, `GET /api/exam/runs?case_id=&report_id=`~~ (the two shared gaps below)
- [x] ~~`POST /api/sheets/snapshot` (+ SheetDiff when `phase=after`)~~
- [x] ~~`GET /api/demo/bundle` (public), `POST /api/admin/seed-demo` (admin uid only)~~ (`ADMIN_UIDS` env; `scripts/seed_demo.py` loads the same seed directly; the bundle also carries segments, deviations, the report's exam cases and agent runs)
- Background work runs through: `pipeline.segment.process_session`, `pipeline.variants.discover`, `pipeline.graph.build`, `exam.scenarios.generate`, `exam.report.run_exam`. Background failures: a processed session goes `failed` with the error, an exam run's `GET /exam/report/{id}` returns 500 with the error, and discover/build only log it.
- Access: everything except `/api/me`, `/api/health` and the demo routes requires the expert (`EXPERT_EMAIL`, verified email; unset = refuse all). Set `EXPERT_EMAIL` and `ADMIN_UIDS` in the deploy env.
- `POST /api/sessions/{id}/process?force=true` restarts a session stuck in `processing`.
- Laptop-only sign-in bypass for UI work before Firebase: `LOCAL_DB` + `DEV_USER_EMAIL` (never on Cloud Run). No `BUCKET` → upload returns 503 with the reason.

### A3. Live backend (SPEC §4)
- [x] ~~`prompts/live_system.md` (persona, SOP verbatim, rules, "Thanks, noted.", guardrail)~~
- [x] ~~`POST /api/live/token`:~~
  - [x] ~~`uses: 1`, 30 min expiry, 1 min new-session window~~
  - [x] ~~Full `live_connect_constraints`: SOP system prompt, `LOG_DEVIATION` tool, transcription on, sliding-window compression, session resumption handle~~
- [x] ~~If the SDK rejects a field, run the fallback ladder in SPEC §4~~ Not needed: a real token with the full config opens a Live session (`test_live_smoke.py`, Oct 16).
- [ ] **AC (Oct 14):** an end-to-end live session on the deployed URL logs a deviation and the PiP shows the question (needs A0 + a deploy)
- [ ] **Oct 14, 22:00 kill switch:** if fewer than 2 of 3 planted deviations trigger the tool, go batch-only (needs a real screen-share test)

### A4. Batch pipeline (SPEC §5, ARCHITECTURE §2)
- [x] ~~`pipeline/files.py`: GCS → Gemini Files API; poll until ACTIVE~~ (also `upload_path` for local recordings)
- [x] ~~`segmenter.md` + `segment.py` (fps 1, media_resolution high) → SegmentList~~
- [x] ~~`safety/armor.py` (SPEC §6):~~
  - [x] ~~`screen_input` / `screen_output` → ModerationResult~~
  - [x] ~~Cache by sha256; `asyncio.gather` with a limit of 8~~
  - [x] ~~Treat `skipped` as not flagged, but log it~~
- [x] ~~Model Armor on each segment's text; flagged segments get `quarantined=true` and are excluded from the graph~~ (their text is withheld from every later prompt)
- [x] ~~`deviations.md` + `deviations.py`: SOP + segments + sheet diff + live deviations; dedup (same rule within 20 s, or same invoice)~~ (dedup decided in code)
- [x] ~~`variants.md` + `variants.py`: one call over all sessions; runs once 3 or more sessions are processed~~ (auto after each processed session; counts from code)
- [x] ~~`probes.md` + `probes.py`: CDM types, at most 4 probes per item, at most 20 words each, few-shot examples from SPEC §5~~
- [x] ~~Session status flow `processing → processed | failed` with `error`~~
- [ ] **AC (Oct 14):** all 3 planted exception types are detected on the dry-run recording. Text-only dry run on real Gemini (synthetic steps, no video) detected all planted E1/E2/E3 and the injection session; still to do on a real recording (`scripts/local.py process`).

### A5. Graph (SPEC §5)
- [x] ~~`graph.md` + `graph.py`. Inputs are clean (moderated) answers only.~~
- [x] ~~Every exception node has an `overrides` edge to its SOP rule~~ (enforced in code; SOP node created if missing)
- [x] ~~Every cue / rule / exception node cites at least one clip~~ (uncited nodes dropped)
- [x] ~~Keep `graph/current` and `graph_history/{version}`~~
- [x] ~~Use `PRO_MODEL` only if Flash quality is poor~~ (`GRAPH_MODEL=pro`; Flash produced the 3 exceptions with the right conditions in the dry run)
- [ ] Answer the batch probes with the expert
- [ ] **AC (Oct 15):** at least 3 exception nodes, each linked to an SOP section and a clip; the injection email is flagged (flagging needs the Model Armor template from A0)

### A6. Exam and evaluation (SPEC §5, §9)
- [x] ~~`scenarios.md` + `scenarios.py`:~~
  - [x] ~~8 generated cases, with all 3 trap types and at least one case per exception~~ (one retry if a trap is missing)
  - [x] ~~Plus 2 held-out cases~~ (copied from the session's Sheet snapshot when there is one)
  - [x] ~~No labels in the generated cases~~ (stripped in code)
- [ ] Expert labels all 10 cases (through the exam page, or `scripts/local.py label`)
- [x] ~~`arm_sop.md`, `arm_graph.md`, `arms.py`:~~
  - [x] ~~Model Armor on inputs and outputs; blocked runs recorded~~ (flagged inputs get the same warning in both arms; flagged outputs count as blocked)
  - [x] ~~3 runs per arm~~
  - [x] ~~Concurrency 6~~
- [x] ~~`judge.md` + `judge.py`:~~
  - [x] ~~Blind to the arm~~ (no arm, no graph citations, opaque run id)
  - [x] ~~Rubric weights 0.5 / 0.25 / 0.25~~
  - [x] ~~`decision_match` computed in code~~
- [x] ~~`report.py` → ExamReport:~~
  - [x] ~~Majority decision, stability, judge means, traps handled~~
  - [x] ~~Every graph-arm miss creates a `Probe(source="exam_miss")`~~ (describes the case, never the answer; not re-asked)
- [x] ~~`scripts/run_exam.py --ws live --runs 3` → stored report + `eval/pilot_chart.png`~~ (works with `LOCAL_DB` before Firestore)
- [ ] Hand-check 3 cases (1 trap, 1 agree, 1 disagree); if any differs by more than 1 point, tighten the rubric and re-run
- [ ] Write up the results and the hand-check in `eval/`
- [ ] **AC (Oct 16):** ExamReport stored. Targets: graph arm at least 80% agreement and at least 30 points above SOP-only, or documented actuals. (Machinery verified end to end on real Gemini with placeholder labels: not reportable numbers.)

### A7. Tests (AGENTS.md)
- [x] ~~Contract round-trip, fixture validation~~
- [x] ~~`test_no_label_leakage`: graph builder, probe generator and arms never receive `expert_label`~~ (also no trap hints; judge blind to the arm)
- [x] ~~Dedup unit test (deviations)~~
- [x] ~~Mocked Model Armor client test~~
- [x] ~~Live smoke test behind `RUN_LIVE_TESTS=1`~~ (structured call + ephemeral token → Live session; passing)
- [x] ~~A `pytest -k demo` test that `/api/demo/bundle` returns data~~

### A8. Demo seed and wrap-up
- [x] ~~`scripts/export_demo.py --from live` → `fixtures/demo_seed.json` (SPEC §8)~~ (round-trip tested)
- [x] ~~`scripts/seed_demo.py` / `make seed-demo` into workspace `demo`~~ (running it needs A0)
- [ ] README (setup, architecture, eval results); bug fixes only after Oct 17, 18:00. Setup, architecture, laptop pipeline, local UI and container sections done; eval results pending the real run.

---

## Person B: UI, deploy, deck, video

### B0. Setup (Oct 13)
- [x] ~~Repo, AGENTS.md / CLAUDE.md, docs~~
- [x] ~~Vite + React + TS skeleton, FastAPI skeleton~~
- [x] ~~Install pnpm globally (`npm i -g pnpm`) so `make setup` / `make dev` work~~
- [ ] Firebase project + Google sign-in; set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` at build time
- [ ] Demo Google account; OAuth consent screen (External, Testing, test user = demo account); OAuth client ID → `VITE_GOOGLE_CLIENT_ID` (Connect Sheet)
- [ ] Bucket `apprentice-recordings-aibc2026` in `asia-south1` + CORS (PUT/GET from the service URL and `localhost:5173`) [`docs/Cloud_Setup.md` 9, 15]
- [ ] Synthetic Sheet "AP Queue – Oct" (4 tabs: import `data/synthetic/invoices.csv`, `vendor_master.csv`, `pos.csv`, `consignment_statement.csv`) + the 14 emails in `data/synthetic/emails.json` sent from a second test account. No cloud needed; blocks the first real recording.
- [ ] **AC:** deployed hello page; sign-in works; the expert can do one dry-run session

### B1. Frontend
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
- [x] ~~UI rebuilt on shadcn/ui (Oct 16), replacing the earlier hand-written Google/Material CSS:~~
  - [x] ~~Tailwind v4 + shadcn (`radix-nova` preset, `components.json`), components in `src/components/ui/`, lucide icons, Geist font~~
  - [x] ~~Theme tokens in `src/index.css`: charcoal dark by default, light mode toggle (remembered), teal brand, blue/orange chart colours~~
  - [x] ~~Collapsible sidebar shell with a top bar; demo banner moved into the top bar~~
  - [x] ~~New Overview dashboard (exam result + per-case chart, questions answered, graph and trap stats, question-type donut, top patterns, recent sessions, activity)~~
  - [x] ~~Every view moved to Card / Table / Badge / Tabs / Select / Dialog / Alert / Empty~~
  - [x] ~~Checked by screenshots at desktop, 1000 px and phone width, in dark and light~~
- [x] ~~Render test per view + parser and graph-layout checks (`pnpm test`; 12 tests incl. Overview and the exam comparison)~~
- [ ] Switch off fixtures and run each view against A's live endpoints as they land. Possible before A0: local backend with `LOCAL_DB` + `DEV_USER_EMAIL`, frontend with `VITE_DEV_AUTH=1` (README).
- [ ] Manual Chrome checklist: PiP opens; recording indicator; Stop uploads within 30 s for a 4-minute session; live probe appears within 15 s
- [ ] Test Connect Sheet with the real demo Sheet (drop it if it doesn't work by Oct 15, 18:00)
- [x] ~~Polish empty and error states with real backend errors~~ (backend messages shown as-is; 403 → "this account can't open the live workspace" screen via `/api/me`; exam poller stops on API errors other than 404 and retries network blips; no bucket → 503 with the reason)
- [x] ~~Exam: labelled cases survive a reload (`GET /api/exam/cases`); "Compare reasoning" shows both agents' runs side by side (`GET /api/exam/runs`), also in the demo (bundle + `fixtures/exam_cases.json`, `agent_runs.json`); runs blocked by Model Armor are never shown as reasoning~~
- [ ] Keep AGENTS.md in step with the UI: its stack line still lists `react-cytoscapejs` (removed; plain `cytoscape` is used) and says "no UI-kit churn" (shadcn/ui is now the UI kit). Shared file: agree the wording, then edit.

### B2. Deploy (Cloud Run)
- [x] ~~`Dockerfile` and `scripts/deploy.sh` written~~
- [x] ~~**Fix the Dockerfile:** the web stage must `COPY fixtures fixtures`.~~ Also: `.dockerignore` / `.gcloudignore` (no `.env`, no host `node_modules`), pnpm 9 + uv 0.9.26 pinned to the lockfiles, non-root user. Built and smoke-tested locally (`/api/health`, `/`, `/demo/` → 200).
- [x] ~~Pass the `VITE_*` values into the web build stage~~ (`scripts/deploy.sh` writes the git-ignored `frontend/.env.production`; it now also requires `EXPERT_EMAIL` and `ADMIN_UIDS`)
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

The four API gaps are settled. All were additive response shapes, so `contract.py` didn't change and no `make types` run was needed.
- [x] ~~`GET /api/probes` should include each probe's `answer` (ProbeAnswer). The UI reads an optional `answer` field.~~ Done in A2 (response shape only, no contract change).
- [x] ~~Add `GET /api/exam/cases` so labelled cases survive a page reload.~~ Backend in A2, Exam page uses it.
- [x] ~~`GET /api/demo/bundle` should also return `segments` and `deviations` keyed by session id, so demo session pages aren't empty.~~ Done in A2.
- [x] ~~Expose agent runs so the exam page can show both agents' reasoning side by side (PRD §13 beat 2:00–2:25).~~ `GET /api/exam/runs?case_id=&report_id=`; "Compare reasoning" on the exam page.
- [ ] Contract freeze v1: the gaps are settled and `contract.py` hasn't changed since; confirm the freeze between A and B.
- [x] ~~Project id~~: `aibuildercup-india-2026`.

## Cut order if behind (SPEC §11)
Live → Connect Sheet → probe depth (1 per deviation) → scenario count (8 → 6, keep all traps).
Never cut: decision graph, SOP-only baseline, Model Armor on the injection email, demo mode.
