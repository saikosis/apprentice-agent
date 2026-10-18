# Judge guide: letting judges use Apprentice hands-on

Judges sign in with any Google account, enter the **judge code**, and get a private sandbox for all three workflows
(invoices, essays, volunteer sign-ups). It starts with a sample run already in it. They can record a few minutes of work,
answer Apprentice's questions, and watch the patterns, the graph and the exam change. Design: `docs/Judge_Sandbox.md`.

Part 1 is for you (the organiser). Part 2 is the text to put in the submission notes.

## Part 1: setup (once)

Run everything in **Git Bash on your laptop, in the repo folder** (`cd ~/projects/aibuildercup/apprentice-agent`),
after `git pull`. Steps 2 and 3 need your Google Cloud sign-in (Cloud_Setup step 12).

**1. Make the judge code.** Long and random, so it can't be guessed. Keep it somewhere private; reuse the same code on
every deploy.

```bash
export SANDBOX_CODE=$(openssl rand -hex 6)
echo "$SANDBOX_CODE"
```

**2. Update the bucket** (once). Sandbox uploads send one extra header, which the bucket's browser rules (CORS) must
allow, and sandbox recordings are deleted after 14 days:

```bash
cat > ~/apprentice-cors.json <<'EOF'
[{"origin": ["http://localhost:5173", "https://apprentice-410061958227.asia-south1.run.app", "https://apprentice-lo5r2wopvq-el.a.run.app"],
  "method": ["PUT", "GET"], "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]
EOF
gcloud storage buckets update gs://apprentice-recordings-aibc2026 --cors-file="$HOME/apprentice-cors.json"

cat > ~/apprentice-lifecycle.json <<'EOF'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 14, "matchesPrefix": ["sandbox-", "essays-sandbox-", "volunteers-sandbox-"]}}]}
EOF
gcloud storage buckets update gs://apprentice-recordings-aibc2026 --lifecycle-file="$HOME/apprentice-lifecycle.json"
```

Check: `gcloud storage buckets describe gs://apprentice-recordings-aibc2026 --format='value(cors_config,lifecycle_config)'`
shows both.

**3. Build the sample run for each workflow** (what every new sandbox starts with). Each one runs the real pipeline on
Gemini from the workflow's quick plan, and takes several minutes:

```bash
GCP_PROJECT=aibuildercup-india-2026 uv run --env-file .env python -m scripts.sample_run --scenario ap
GCP_PROJECT=aibuildercup-india-2026 uv run --env-file .env python -m scripts.sample_run --scenario essays
GCP_PROJECT=aibuildercup-india-2026 uv run --env-file .env python -m scripts.sample_run --scenario volunteers
```

Each one replaces whatever that workflow's demo held, and ends with a line like
`exam: SOP only 50%, SOP + graph 83% (6 cases)`. The sample sessions have no video;
their clip buttons say so. If you later seed a real recorded run into a workflow's demo (`docs/Scenarios.md`), new
sandboxes copy that instead.

> `/demo` then shows these sample runs instead of the built-in invoice fixtures.

**4. Redeploy with the code** (same values as Cloud_Setup step 14, plus `SANDBOX_CODE`):

```bash
EXPERT_EMAIL="<expert's gmail>" ADMIN_UIDS="<your uid>" SANDBOX_CODE="$SANDBOX_CODE" \
  VITE_FIREBASE_API_KEY="<apiKey>" \
  VITE_FIREBASE_AUTH_DOMAIN="aibuildercup-india-2026.firebaseapp.com" \
  VITE_FIREBASE_PROJECT_ID="aibuildercup-india-2026" \
  VITE_GOOGLE_CLIENT_ID="<apprentice-web client ID>" \
  bash scripts/deploy.sh
```

**5. Check with a second Google account.** Open the app in an incognito window, sign in with an account that isn't the
expert's, and enter the code. You land on **My sandbox** with the sample run loaded. Record 1 minute (it stops on its own
at 5:00), check that questions appear, rebuild the graph and run the exam. Then, signed in as yourself, open **Judge
sandboxes** in the sidebar: that sandbox is listed, and **View** opens it read-only.

**Controls**
- **Close the sandbox:** redeploy with `SANDBOX_ENABLED=0`. Judges can still read their sandbox but can't change it.
- **Change the code:** redeploy with a new `SANDBOX_CODE`. Judges who already joined keep their sandbox.
- **Limits:**
  - per judge: 5 recordings, 20 graph builds (including pattern runs), 20 exam runs and 20 exam case sets
  - across all judges: 300 actions a day
- **Deletion:** sandboxes are deleted after 14 days. Judges can also reset or delete their own.

## Part 2: text for the submission notes

> **Try it yourself (about 10 minutes).** Open https://apprentice-410061958227.asia-south1.run.app, sign in with any
> Google account and enter the judge code **`<code>`**. You get a private sandbox with a sample run already in it.
>
> 1. **My sandbox:** pick a workflow at the top of the sidebar (invoices, essay marking or volunteer sign-ups). Download
>    its files, upload them to Google Drive and open them with Google Sheets or Docs.
> 2. **Record a session:** share that tab and work through the 6 listed items for 3–5 minutes (2–3 items is fine).
>    Apprentice asks a question out loud when you step outside the SOP. Recording stops at 5:00.
> 3. **Questions:** answer in your own words. You are the expert here; your reasons shape the graph.
> 4. **Patterns** and **Decision graph:** see what Apprentice learned from your session.
> 5. **Successor exam:** generate 6 practice cases, label them as you would decide, and run the exam. It compares an AI
>    successor that has only the SOP with one that also has your decision graph.
>
> Your sandbox is visible only to you and the organisers, and is deleted after 14 days. A read-only demo with no sign-in
> is at /demo/.
