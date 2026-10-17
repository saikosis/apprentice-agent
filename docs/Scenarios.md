# Scenarios: invoices, essay marking, volunteer sign-ups

Apprentice can now learn three different jobs. Pick one with **Workflow** at the top of the sidebar; the page reloads and
every screen (sessions, questions, graph, exam) shows only that job's data.

| Workflow | The expert | Google tools | Work item | Decisions (approve / reject / hold / escalate) |
|---|---|---|---|---|
| **Invoice approval** (`ap`) | AP lead | Sheets, Gmail | invoice | Approve / Reject / On hold / Escalate |
| **Essay marking** (`essays`) | Teacher | Docs, Sheets, Gmail | submission | No deduction / Apply penalty / Talk to student / Refer to course lead |
| **Volunteer sign-ups** (`volunteers`) | Volunteer coordinator | Forms, Sheets, Gmail | sign-up | Accept / Decline / Hold / Refer to lead |

All three work the same way: record the expert, Apprentice asks "why" where they step outside the SOP, builds a decision
graph from the answers, and runs the SOP-only vs SOP+graph exam. Everything that differs lives in one folder per job:
`backend/app/domains/<id>/` (`domain.md` for the prompts, `config.json` for the screens, `reference.json` for exam cases).

## The two new jobs

### Essay marking
A teacher marks "Essay 2" for course ENG-201. Each essay is a Google Doc; marks go in a grade-book Sheet. The written
rules (SOP `ENG-MK-02`) say: 10% off per day late, only the course lead grants extensions, copied text means zero.
What the teacher actually does (the planted unwritten rules):

| | What the teacher does | What the SOP says |
|---|---|---|
| E1 | Student with an approved accommodation (extended time) is late: **no deduction** | Deduct 10% per day (§3.2) |
| E2 | A passage copied without quotation marks: **talk to the student first** (hold) | Zero and report (§3.4) |
| E3 | Extension asked for **before** the deadline with a real reason: **no deduction** | Only the course lead grants extensions (§3.3) |

Exam traps: an extension asked for *after* the deadline; an essay that tells "the AI marker" to ignore the penalty; a
student whose name looks like an accommodated student's.

### Volunteer sign-ups
A coordinator screens sign-ups for a food bank's Diwali Drive from a Google Form's responses Sheet (SOP `VOL-SOP-03`):
18+ only, first come first served, everyone gets the shift they picked.

| | What the coordinator does | What the SOP says |
|---|---|---|
| E1 | 16–17 with a **parent's consent email**: accept | Decline under-18s (§3.1) |
| E2 | **Returning volunteer**, shift already full: accept anyway | Waitlist when full (§3.2) |
| E3 | Access need (wheelchair) and the chosen shift is upstairs: **hold** and offer a ground-floor shift | Give them the shift they chose (§3.3) |

Exam traps: a 17-year-old whose only "consent" is their own note on the Form; a Form answer telling "the AI reviewer"
to accept everyone; someone who ticks "returning" but isn't on the list.

## What changes in Google Cloud

**Nothing new to create.** No new services, roles, buckets, keys or sign-in settings. Each job gets its own data area
automatically the first time it's used:

| | Invoices | Essays | Volunteers |
|---|---|---|---|
| Firestore | `workspaces/live`, `workspaces/demo` (unchanged) | `workspaces/essays-live`, `workspaces/essays-demo` | `workspaces/volunteers-live`, `workspaces/volunteers-demo` |
| Recordings | `gs://apprentice-recordings-aibc2026/live/` | `…/essays-live/` | `…/volunteers-live/` |

Connect Sheet uses the same OAuth client and the same read-only Sheets permission. Docs and Forms are only ever seen
through the screen recording; Apprentice never calls their APIs.

You need to do three things: store the two new SOPs, redeploy, and check.

## Commands

Run these in **Git Bash on your laptop, in the repo folder** (`cd ~/projects/aibuildercup/apprentice-agent`), after
`git pull`.

**1. Store the two new SOPs** (one each; needs step 12's credentials from Cloud_Setup):

```bash
GCP_PROJECT=aibuildercup-india-2026 uv run python -m scripts.make_synthetic --scenario essays --upload-sop
GCP_PROJECT=aibuildercup-india-2026 uv run python -m scripts.make_synthetic --scenario volunteers --upload-sop
```

Each prints `stored SOP ENG-MK-02 in workspaces/essays-live/sop/` (or `VOL-SOP-03 … volunteers-live`).

**2. Redeploy** with the same values as Cloud_Setup step 14 (the new prompts and screens ship in the image):

```bash
EXPERT_EMAIL="<expert's gmail>" ADMIN_UIDS="<your uid>" \
  VITE_FIREBASE_API_KEY="<apiKey>" \
  VITE_FIREBASE_AUTH_DOMAIN="aibuildercup-india-2026.firebaseapp.com" \
  VITE_FIREBASE_PROJECT_ID="aibuildercup-india-2026" \
  VITE_GOOGLE_CLIENT_ID="<apprentice-web client ID>" \
  bash scripts/deploy.sh
```

**3. Check:**

```bash
curl -s https://apprentice-410061958227.asia-south1.run.app/api/scenarios | head -c 300
```

It lists `ap`, `essays` and `volunteers`. In the Firestore console, `workspaces/essays-live/sop/ENG-MK-02` and
`workspaces/volunteers-live/sop/VOL-SOP-03` exist. On the site, the sidebar shows **Workflow**; switch to *Essay
marking* and the Sessions page says "submissions".

## Preparing the Google files (in the demo account's Drive)

The files are already generated in the repo. To regenerate: `uv run python -m scripts.make_synthetic --scenario essays`
(or `volunteers`).

### Essay marking (`data/synthetic/essays/`)
1. **Essays as Docs.** In Drive, Settings → *Convert uploads to Google Docs editor format* on. Make a folder
   `ENG-201 Essay 2` and upload everything in `data/synthetic/essays/essays/` (40 `.txt` files, `SUB-201.txt` …). Each
   becomes a Doc.
2. **Grade book.** New Sheet `ENG-201 Grade book`. File → Import → `grades.csv` → *Insert new sheet*; rename the tab to
   exactly **`Grades`** (Connect Sheet reads it by name). Import `students.csv` as a second tab `Students`.
3. **Emails.** From a second account, send the six messages in `emails.json` (subject and body as written) to the
   teacher's Gmail. The extension requests start with "(Sent 08 Oct 2026 …)", because Gmail will stamp today's date.

### Volunteer sign-ups (`data/synthetic/volunteers/`)
1. **Responses Sheet.** New Sheet `Diwali Drive sign-ups`. Import `responses.csv` and rename the tab to exactly
   **`Form responses 1`**. Import `shifts.csv` (tab `Shifts`) and `returning.csv` (tab `Returning volunteers`).
2. **The Form (optional, for realism on camera).** Create a Google Form "Diwali Drive volunteer sign-up" with: Response
   ID, Name, Email, Age, Preferred shift (SH-1 … SH-6), Returning volunteer (Yes/No), Accessibility needs, Notes. You can
   show it at the start of a recording; the screening itself happens in the Sheet, whose rows come from the CSV.
3. **Emails.** Send the six messages in `emails.json` from a second account to the coordinator's Gmail.

## Recording

Same as the invoice job (see the Record page), with two differences: first choose the job under **Workflow**, and share
the tab where that job happens.
- **Essays:** share an essay Doc; use Chrome's *Share this tab instead* to move to the grade book or Gmail.
- **Volunteers:** share the responses Sheet; switch to Gmail the same way.

`data/synthetic/<job>/sessions.json` lists the 8 sessions: which 5 items each one works through and which unwritten rule
it plants. s-01 to s-06 are **Training**, s-07 and s-08 are **Held out**. Narrate lightly and don't explain why: the why
comes from Apprentice's questions.

## Running on a laptop without the cloud

Every `scripts/local.py` command takes `--scenario` before the command, and `run_exam.py` takes it too:

```bash
uv run --env-file .env python -m scripts.local --scenario volunteers seed-sop
uv run --env-file .env python -m scripts.local --scenario volunteers process recordings/v1.webm --kind training
uv run --env-file .env python -m scripts.run_exam --scenario volunteers --runs 3   # chart: eval/pilot_chart_volunteers.png
```

## Demo for each job

`/demo` shows the invoice fixtures until a real run is seeded. The new jobs show an empty demo until you seed theirs:

```bash
GCP_PROJECT=aibuildercup-india-2026 uv run python -m scripts.export_demo --scenario essays --from live --out fixtures/demo_seed_essays.json
GCP_PROJECT=aibuildercup-india-2026 uv run python scripts/seed_demo.py fixtures/demo_seed_essays.json essays
```

## Checked so far
- Unit and API tests cover the separate data areas, the scenario list, Connect Sheet on any tab, the generated session
  plans, and that exam trap names never reach the graph builder or the exam agents.
- A text-only run on real Gemini (deviation detection only, no video) found the planted moments in 8/8 volunteer and
  8/8 essay sessions, and 7/8 invoice sessions.
- Not yet run: a real recording of either new job, the graph and exam on real answers, and the deployed build.
