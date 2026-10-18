# Apprentice — Product Requirements Document
Version 1.0 · Oct 13, 2026 · Google Cloud AI Builder Cup 2026 · Category: Future of Work & Enterprise Productivity
Team: Person A (ML/pipeline/Live backend), Person B (UI/deploy/deck/video)

## 1. Problem
When a senior operator leaves, the SOP stays but the judgment goes with them. SOPs say WHAT to do. Experts know WHEN the rule doesn't apply, and WHY. Current capture tools (Scribe/Tango step recorders, Glean/Gemini Enterprise search) record clicks and documents, not reasoning, and none of them checks whether knowledge actually transferred to a successor.

JAPAC urgency (directional; cite carefully in the deck):
- Japan: METI's DX Report (Sep 2018) warned of a "2025 digital cliff": up to ¥12 trillion a year in economic losses after 2025, and an IT personnel shortage growing from about 170,000 (2015) to about 430,000 by 2025. It names "loss of know-how due to the retirement of experts" as one cause. (This comes from a secondary summary; confirm it against the METI PDF before the deck.)
- India: Aon's 32nd Annual Salary Increase and Turnover Survey puts overall attrition at 16.2% in 2025 (17.7% in 2024). The IT majors report 12.8–15.1% trailing-twelve-month attrition (HCLTech 12.8%, TCS 13.8%, Infosys 14.4%, Wipro 15.1%; via Wisemonk, Sep 2026), so tacit process knowledge walks out every year.
- 42% of institutional knowledge is unique to the individual employee, so coworkers can't do 42% of that person's job (Panopto press release, 17 Jul 2018; YouGov survey of 1,001 US adults at organisations with 200+ employees). Label it "directional" and US-based.

## 2. Solution (one-liner)
An AI apprentice watches an expert work in Google apps (screen + voice) and asks the "why" behind each decision using Critical Decision Method (CDM) probes. It compiles the answers into a decision graph linked to SOP sections and video evidence, then PROVES the knowledge transferred with a successor exam: an agent with SOP + graph is compared against an SOP-only agent on held-out and trap cases.

## 3. Users and personas
| Persona | Goal | Primary surfaces |
|---|---|---|
| Expert (AP lead, 8 yrs) | Capture judgment without writing documentation; answer briefly while working | Recorder + PiP companion, probe answer screen |
| Successor (new AP analyst) | Learn exceptions and their reasons; see evidence clips | Graph view with clips (read-only) |
| Team lead / Ops manager | Know whether knowledge transferred before the expert leaves; see gaps | Exam report, pilot chart, new-probe queue |
| Judge (demo mode) | Understand the product in <3 minutes without login | Demo mode: pre-seeded sessions, graph, exam from a real run |

## 4. Job to be done
"When a critical expert is about to leave or rotate, help me capture the decisions they make that the SOP doesn't cover, and show me evidence that a successor (human or agent) can now make those decisions correctly."

## 5. Positioning vs the commodity layer
| Layer | Examples | Captures | Apprentice stance |
|---|---|---|---|
| Enterprise search / assistants | Gemini Enterprise, Glean | Documents, WHAT exists | Complement; graph can later feed them |
| Step recorders | Scribe, Tango | Clicks, WHAT was done | Not competing; we record video too, but the product is the WHY |
| Policy KB / RAG | Drive/Confluence + vector DB | Written rules | Commodity; roadmap only |
| **Apprentice** | — | **WHY + exceptions + verified transfer** | Differentiator: CDM probes + successor exam |

## 6. Form-factor decision: web app + Document Picture-in-Picture
| Criterion | Web app (chosen) | Desktop app | Chrome extension |
|---|---|---|---|
| Judge access | Open a deployed Cloud Run URL | Download/install; no clean deploy link | Install unpacked or wait for store review |
| 3-day feasibility | High | Packaging/signing overhead | Chrome Web Store review won't finish in 3 days |
| Capture in Sheets/Docs | getDisplayMedia video works on any app | Works | DOM capture is weak: Sheets/Docs render to canvas |
| Future apps (SAP, ServiceNow) | Any web app via screen capture | Any app | Per-site DOM adapters |
| Always-on-top companion | Document PiP (Chrome 116+) | Native | Side panel (tab-bound) |
| Deployment requirement (Cloud Run/Firebase) | Native fit | Backend only | Backend only |
Decision: web app. The companion window uses `documentPictureInPicture.requestWindow()`, which opens an always-on-top window that stays visible while the expert works in the Sheets/Gmail tab.  Chrome extension (Gmail DOM, side panel) is on the roadmap.

## 7. Goals and non-goals
Goals (hackathon):
G1. Record expert sessions (screen + mic) and process them into segments, SOP deviations and cross-session variants.
G2. Ask CDM probes live (voice + PiP text) and in batch; store answers.
G3. Build a decision graph: cue → goal → options → rule → exception-to-SOP-rule, each node citing a video timestamp.
G4. Run a successor exam: SOP-only arm vs SOP+graph arm on 10 cases, with an LLM judge; produce a pilot report.
G5. Screen all untrusted text with Model Armor; flag the planted injection email.
G6. Demo mode works without login.
Non-goals: human-successor arm; any writes to Sheets/Gmail; computer use / autonomous execution; Chrome extension; multi-language; RBAC; RAG/vector store/policy KB; embeddings/clustering; mobile.

## 8. User stories and acceptance criteria
US1 Expert records a session. AC: one click in the PiP window starts tab capture + mic; a red recording indicator is visible in PiP; Stop uploads to GCS through a signed URL; the session reaches `uploaded` within 30 s of Stop for a 4-min recording.
US2 Expert gets a live probe. AC: within 15 s of skipping PO-match on a consignment invoice, the PiP shows the question; Live speaks it (or the fallback triggers); the expert's voice answer is saved as a ProbeAnswer with `source=voice_live` and can be edited later.
US3 Expert answers batch probes. AC: ≤2 min after upload, batch probes appear in PiP/answer UI; each shows SOP §, clip timestamp and a jump-to-clip player.
US4 Team lead sees discovered variants. AC: once the same departure has been seen twice (in one session or several), the Discovery view lists variants with linked sessions, deviations and SOP §.
US5 Successor explores the graph. AC: graph renders ≥1 exception node per planted exception type; clicking a node plays the cited clip at its timestamp.
US6 Safety. AC: the injection email text is flagged `pi_and_jailbreak` MATCH_FOUND, shown with a red badge, and excluded from graph inputs; exam agent inputs/outputs are screened and logged.
US7 Exam. AC: 10 cases (2 held-out, 8 generated incl. ≥3 traps) are expert-labelled; both arms run 3× per case; judge scores stored; report shows a per-case table and a bar chart labelled "pilot"; every graph-arm miss creates a new Probe (`source=exam_miss`); no labels are written to the graph.
US8 Judge demo mode. AC: `/demo` loads without login in <3 s and shows seeded sessions, graph, exam report and replayable clips; no write endpoints are reachable.
US9 Connect Sheet (demo expert only). AC: incremental consent for `spreadsheets.readonly`; snapshots before/after each session; diff shown and fed to the deviation detector.

## 9. Functional requirements by module
Capture (B): getDisplayMedia (prefer browser tab, exclude self), mic via getUserMedia, MediaRecorder webm; frames sampled at 1 FPS → JPEG ≤768 px for Live; PiP companion with status, timer, current probe, Start/Stop.
Live Probe (A backend, B client): backend mints a constrained ephemeral token containing the full Live setup; browser connects directly; tool `log_deviation`; input/output transcription; ≤1 probe per 45 s, ≤3 per session.
Batch Discovery (A): Files API upload; segmenter; deviation detector (SOP + sheet diff + Live deviations for dedup); variant discovery over all sessions in ONE call.
Probe & Graph (A pipeline, B UI): CDM probe generator; answer capture; graph builder (structured output) citing clips; Cytoscape view.
Exam & Eval (A pipeline, B report): scenario generator with traps; expert labelling UI; two arms; judge; report + chart; miss → new probe.
Model Armor (A): screen segment text/transcripts and probe answers before graph build; screen agent inputs/outputs; persist ModerationResult.
Auth / Connect Sheet (B UI, A endpoint): Firebase Auth Google (openid/email/profile); GIS token client for the incremental Sheets scope; snapshot endpoint.
Demo mode (B, seeded by A): read-only workspace `demo` seeded from a real run.

## 10. Success metrics
| Metric | Target | Notes |
|---|---|---|
| Graph-arm decision agreement with expert labels | ≥80% (≥8/10 cases, majority of 3 runs) | Primary |
| Graph arm − SOP-only arm agreement | ≥30 points | Primary; finalize thresholds from Day-2 data |
| Trap handling (graph arm) | ≥2 of 3 traps correct | Shows no over-generalization |
| Planted-exception recall in batch deviations | 3/3 types detected across training sessions | Pipeline quality |
| Live probe latency | ≤15 s from deviation to PiP text | UX |
| Injection email flagged | 100% (1/1) | Safety beat |
| Judge leniency check | 3 hand-checked cases agree with judge within 1 point | Eval validity |
All results are labelled "pilot (n=10, synthetic data, one expert)".

## 11. Privacy and compliance
- Synthetic data only: fake vendors, fake GSTINs, `.test`/`example` domains; a dedicated demo Google account.
- Consent: a recording banner and explicit consent checkbox before first capture; the PiP always shows recording state; Stop is always one click.
- Japan APPI and India DPDP Act 2023 alignment (roadmap for production): purpose limitation (knowledge transfer only), notice and consent before recording, data minimization (tab capture, not full screen), access/erasure (delete session cascades to segments/probes/graph evidence), cross-border transfer notice (Gemini Developer API processing location not region-pinned; Vertex/Agent Platform with regional endpoints is the enterprise path).
- Redaction: Model Armor Sensitive Data Protection screens text before it enters the graph; bank details are masked in stored text.
- Retention: Gemini Files are auto-deleted after 48 h; GCS originals deleted after the competition unless the demo needs them.

## 12. Risks, fallbacks, kill switches
| Risk | Likelihood | Fallback / kill switch |
|---|---|---|
| Live doesn't call `log_deviation` reliably | Med | End of Day 1 (Oct 14, 22:00 IST): if <2/3 planted deviations trigger the tool across 3 trial runs → batch-only; video uses a recorded Live clip |
| Live won't speak the probe (proactive audio) | Med | Client `sendClientContent` nudge → PiP text + browser speechSynthesis |
| Ephemeral token/SDK version mismatch (v1alpha vs v1beta) | Med | Pin SDK versions; raw WebSocket fallback to `BidiGenerateContentConstrained?access_token=`  |
| Deviation detector misses planted exceptions | Low–Med | Sheet diff as ground truth; tighten prompt; hand-seed probes as last resort (disclosed) |
| Graph arm doesn't beat baseline | Low–Med | Inspect misses → new probes → re-answer → rebuild graph (allowed: exam labels never enter the graph) |
| Model Armor latency/region issue | Low | Fall back to us-central1 template; cache verdicts by content hash |
| Cloud Run processing timeout | Low | Background task + CPU always allocated; Cloud Run Job only if >15 min |
| Recording quality (Sheets text unreadable) | Low | Zoom Sheets to 125%; media_resolution high |
Cut order if behind: Live → Connect Sheet → probe depth → scenario count. Never cut: graph, baseline comparison.

## 13. Demo script (target 2:45, hard cap 2:59)
| Time | Beat | On screen |
|---|---|---|
| 0:00–0:15 | Hook | "42% of an employee's job knowledge is unique to them" (Panopto/YouGov 2018, n=1,001 US) + Japan/India context |
| 0:15–0:45 | Expert works | Sheets invoice queue + Gmail; approves consignment invoice without PO match |
| 0:45–1:05 | Live probe | PiP pins "Why did you skip the PO match for Kaveri?"; Live speaks; expert answers by voice; transcript appears |
| 1:05–1:25 | Discovery | Variants across 6 sessions; deviations linked to SOP §3.2/§3.3/§3.4 |
| 1:25–1:45 | Graph | New exception node "Consignment vendor → reconcile against monthly statement" linked to §3.2 and clip 02:14 |
| 1:45–2:00 | Safety | Injection email flagged by Model Armor; excluded from graph |
| 2:00–2:25 | Exam | Same case: SOP-only arm rejects/holds wrongly; graph arm correct, citing node + clip |
| 2:25–2:35 | Results | Pilot bar chart; a graph-arm miss → new probe to the expert |
| 2:35–2:45 | Close | "Apprentice captures the why — and proves it transferred." URL + repo |

## 14. Roadmap
1. Chrome extension: Gmail DOM context, side panel, per-site adapters.
2. Policy KB from Drive/Confluence (RAG) to auto-ground the SOP.
3. Multi-language Live interviews (Japanese, Hindi); Gemini 3.8 Live supports many languages;  Model Armor region choice needed for non-English screening.
4. Org-wide agent fleet: compiled SOP+graph agents deployed on Agent Runtime, governed through Agent Gateway with Model Armor inline. 
5. Enterprise path: Gemini Enterprise Agent Platform (formerly Vertex AI) with regional processing, CMEK, VPC-SC; publish graphs into Gemini Enterprise. 
6. Human-successor exam arm; spaced-repetition training for successors.

## 15. Judging-criteria mapping
| Criterion (weight) | Evidence in Apprentice |
|---|---|
| Technical Merit & GenAI (40%) | Gemini 3.8 Live with async tool calling + ephemeral tokens; long-video segmentation; one-call cross-session variant discovery; structured outputs everywhere; two-arm controlled eval with LLM judge + hand-check; Model Armor |
| Problem Alignment & Impact (25%) | JAPAC knowledge-loss story; AP approval is universal; measurable transfer |
| Innovation & Creativity (25%) | CDM probes from an AI apprentice; "prove it transferred" exam; misses become new probes |
| UX & Solution Design (10%) | Always-on-top PiP companion; voice answers; clip-linked graph; zero-login demo mode |