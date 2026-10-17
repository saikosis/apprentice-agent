# Cloud setup (Google Cloud + Firebase)

Everything Apprentice needs on Google Cloud, in the order it has to happen. The same 16 numbered steps
appear in three forms; pick one per step, they are interchangeable:

| File | Use it when |
|---|---|
| [Cloud_Setup_Console.md](Cloud_Setup_Console.md) | You'd rather click through the Cloud Console and Firebase console |
| [Cloud_Setup_CLI.md](Cloud_Setup_CLI.md) | You want to paste `gcloud` commands one step at a time, with a check after each |
| [`scripts/cloud_setup.sh`](../scripts/cloud_setup.sh) | You want one script. Safe to re-run; it pauses at the console-only steps |

## Decisions (agreed Oct 17)

| | |
|---|---|
| Project | `aibuildercup-india-2026` (already exists; Firebase is added to this same project) |
| Billing | Account "Personal" (`0174D5-2E20A5-C98327`, INR) |
| Budget | ₹5,000 / month, alerts at 50%, 90%, 100%, emailed to the billing account admins |
| Region | `asia-south1` for Cloud Run, Firestore, the bucket and Model Armor. Model Armor only falls back to `us-central1` if templates can't be created in `asia-south1` (step 8). |
| Gemini key | A new key created in this project, stored in Secret Manager as `gemini-api-key`. Your laptop keeps its own key in `.env`. |
| Bucket | `apprentice-recordings-aibc2026` |
| Service account | `apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com` |
| Personal values | Never committed. Fill them in at the top of whichever form you use: `EXPERT_EMAIL`, `DEMO_ACCOUNT_EMAIL`, and later `ADMIN_UIDS`. |
| Person B access | Not covered here yet. |

## The 16 steps

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Set the variables (project, region, bucket, your emails) | A | Cloud Shell |
| 2 | Link billing to the project | A | Cloud Shell |
| 3 | Monthly budget with alerts | A | Cloud Shell |
| 4 | Enable the APIs | A | Cloud Shell |
| 5 | Firestore (Native, `asia-south1`); rules deny all client access | A | Cloud Shell; rules in the browser |
| 6 | Gemini API key in this project → Secret Manager `gemini-api-key` | A | Cloud Shell |
| 7 | Runtime service account and its roles | A | Cloud Shell |
| 8 | Model Armor template `apprentice-default` | A | Cloud Shell |
| 9 | Recordings bucket + CORS | B | Cloud Shell |
| 10 | Add Firebase to the project; enable Google sign-in; register the web app | B | Browser |
| 11 | OAuth consent screen, test user, OAuth client ID (Connect Sheet) | B | Browser |
| 12 | Local credentials (Application Default Credentials) | A | Laptop (any terminal) |
| 13 | Store the SOP in Firestore | A | Git Bash, repo folder |
| 14 | First deploy (`scripts/deploy.sh`) | B | Git Bash, repo folder |
| 15 | After the first deploy: authorised domains, OAuth origins, bucket CORS, `ADMIN_UIDS`, redeploy | B | Git Bash, repo folder + browser |
| 16 | Seed the demo workspace (after the real run) | A | Git Bash, repo folder |

"Who" follows the A/B split in `docs/TASKS.md`; one person can do all of it.

## Where to run each step

| Where | Steps | Why |
|---|---|---|
| **Cloud Shell** (`>_` in the Cloud Console top bar) | 1–9 | Only creates cloud resources; gcloud is already signed in. Git Bash on the laptop works too. |
| **Browser** (Cloud Console / Firebase console) | 10, 11, rules in 5, items 1–2 of 15 | No command-line version. |
| **Laptop terminal** (any) | 12 | Signs in the code on your laptop. Type the project id: Command Prompt doesn't expand `$PROJECT`. |
| **Git Bash on the laptop, in the repo folder** | 13–16 | These run repo code (`uv run`, `scripts/deploy.sh`) and need step 12's credentials. Command Prompt can't run `VAR=value command` or bash scripts. |

Shell variables (`$PROJECT`, `$URL`, ...) live only in the shell that set them. When you switch from Cloud Shell to Git
Bash, re-run step 1 there, or type the values. An empty variable fails quietly: an empty `$URL` in step 15 wrote `""` into
the bucket CORS and broke uploads.

## Order constraints

- 2 before everything that bills (4 onwards). 4 before 5–11.
- 7 needs 6 (it grants access to the secret). The service account's bucket role is granted in 9, once the bucket exists.
- 14 needs 5–11; 15 needs the service URL from 14; `ADMIN_UIDS` needs one sign-in on the deployed app.
- 16 needs a real run (`scripts/export_demo.py`). Until then `/demo/` falls back to the fixtures.

## Cost notes

- Cloud Run runs with `--min-instances 1 --no-cpu-throttling --memory 1Gi`: one always-on instance, the main fixed cost. Set
  `--min-instances 0` in `scripts/deploy.sh` between demo days if the budget alerts fire.
- Gemini calls are billed to the project once billing is linked. A full exam (10 cases × 2 agents × 3 runs + judge) is ~120 Flash
  calls.
- Firestore, Secret Manager, Model Armor and the bucket are small at this scale.

## When it's done

`docs/TASKS.md` A0 and B0 cloud items can be ticked, and these work on the service URL: `/api/health`, `/`, `/demo/`, sign-in as
`EXPERT_EMAIL`, a recording upload, and Model Armor flagging the injection email in session s-03.
