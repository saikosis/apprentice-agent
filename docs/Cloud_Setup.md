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

| # | Step | Who | Console only? |
|---|---|---|---|
| 1 | Set the variables (project, region, bucket, your emails) | A | |
| 2 | Link billing to the project | A | |
| 3 | Monthly budget with alerts | A | |
| 4 | Enable the APIs | A | |
| 5 | Firestore (Native, `asia-south1`); rules deny all client access | A | rules: yes |
| 6 | Gemini API key in this project → Secret Manager `gemini-api-key` | A | |
| 7 | Runtime service account and its roles | A | |
| 8 | Model Armor template `apprentice-default` | A | |
| 9 | Recordings bucket + CORS | B | |
| 10 | Add Firebase to the project; enable Google sign-in; register the web app | B | yes |
| 11 | OAuth consent screen, test user, OAuth client ID (Connect Sheet) | B | yes |
| 12 | Local credentials (Application Default Credentials) | A | |
| 13 | Store the SOP in Firestore | A | |
| 14 | First deploy (`scripts/deploy.sh`) | B | |
| 15 | After the first deploy: authorised domain, OAuth origin, bucket CORS, `ADMIN_UIDS`, redeploy | B | partly |
| 16 | Seed the demo workspace (after the real run) | A | |

"Who" follows the A/B split in `docs/TASKS.md`; one person can do all of it.

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
