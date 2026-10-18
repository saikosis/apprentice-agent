# Cloud setup: Console click-paths

The 16 steps from [Cloud_Setup.md](Cloud_Setup.md) done in the browser. Cloud Console: https://console.cloud.google.com
(select project **aibuildercup-india-2026** in the top bar first). Firebase console: https://console.firebase.google.com.
Each step ends with a **Check**.

## 1. Values you'll need

Write these down somewhere private (not in the repo):

| Name | Value |
|---|---|
| Project | `aibuildercup-india-2026` |
| Region | `asia-south1` (Mumbai) |
| Billing account | "Personal" (`0174D5-2E20A5-C98327`) |
| Bucket | `apprentice-recordings-aibc2026` |
| Service account | `apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com` |
| Expert email | the expert's Google account (`EXPERT_EMAIL`) |
| Demo account email | the account that owns the "AP Queue – Oct" Sheet (`DEMO_ACCOUNT_EMAIL`) |

**Check:** the top bar shows `aibuildercup-india-2026`.

## 2. Link billing

**Billing → Account management → My projects** → row `aibuildercup-india-2026` → ⋮ **Change billing** → "Personal" → Set account.

**Check:** **Billing → Overview** for the project shows the "Personal" account.

## 3. Budget

**Billing → Budgets & alerts → Create budget**:
- Name `apprentice monthly`; **Scope → Projects:** `aibuildercup-india-2026`.
- **Amount:** Specified amount, **₹5,000**.
- **Actions → Threshold rules:** 50%, 90%, 100% of actual spend. Keep "Email alerts to billing admins and users" on.

**Check:** the budget appears in the list with ₹5,000.

## 4. Enable the APIs

**APIs & Services → Library**, search and **Enable** each:
Cloud Run Admin, Cloud Build, Artifact Registry, Cloud Firestore, Cloud Storage, Secret Manager, Identity and Access Management
(IAM), IAM Service Account Credentials, Model Armor, Google Sheets, API Keys, Generative Language API, Firebase Management,
Identity Toolkit, Cloud Resource Manager, Cloud Billing Budget.

**Check:** **APIs & Services → Enabled APIs & services** lists all of them.

## 5. Firestore

**Firestore → Create database** → **Native mode** → Database ID `(default)` → Location **asia-south1 (Mumbai)** (a single
region, not a multi-region) → security rules **Production mode** (deny all) → Create.

If you can see rules (Firebase console → Firestore Database → **Rules**), make sure they are:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

The app only reaches Firestore server-side, so clients are always denied (SPEC §2).

**Check:** the database shows location `asia-south1`, mode Native.

## 6. Gemini API key → Secret Manager

1. https://aistudio.google.com/apikey → **Create API key** → **Create API key in existing project** →
   `aibuildercup-india-2026`. Copy it (don't save it into the repo). Or: Cloud Console **APIs & Services → Credentials →
   Create credentials → API key**, then **Edit → API restrictions → Restrict key → Generative Language API**.
2. **Security → Secret Manager → Create secret** → name `gemini-api-key` → paste the key as the secret value → Replication:
   automatic → Create.

**Check:** the secret has one **Enabled** version.

## 7. Runtime service account and roles

1. **IAM & Admin → Service accounts → Create service account** → ID `apprentice-run`, name "Apprentice Cloud Run runtime" →
   Create and continue → grant **Cloud Datastore User** and **Model Armor User** → Done.
2. **Secret Manager → `gemini-api-key` → Permissions → Grant access** → principal
   `apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com` → role **Secret Manager Secret Accessor**.
3. **Service accounts → `apprentice-run` → Permissions (Principals with access) → Grant access** → principal: the same
   service account → role **Service Account Token Creator** (lets it sign upload URLs on Cloud Run).

The bucket role is added in step 9.

**Check:** **IAM** lists the service account with Cloud Datastore User and Model Armor User.

## 8. Model Armor template

**Security → Model Armor → Templates → Create template**:
- Template ID `apprentice-default`; **Region `asia-south1`**. If `asia-south1` isn't offered, choose `us-central1` and note it:
  the deploy then needs `MA_LOCATION=us-central1`.
- **Prompt injection and jailbreak detection:** on, confidence **Low and above**.
- **Sensitive Data Protection:** on, **Basic**.
- **Malicious URL detection:** off (not available in `asia-south1`; the app doesn't need it).
- **Responsible AI:** all four categories (hate speech, harassment, dangerous, sexually explicit) at **Medium and above**.
- Create.

**Check:** the template appears in the chosen region. After step 12, test whether bank-account numbers are caught; if not, edit
the template to **Advanced** Sensitive Data Protection with an inspect template that includes FINANCIAL_ACCOUNT_NUMBER and
IBAN_CODE.

## 9. Recordings bucket + CORS

1. **Cloud Storage → Buckets → Create** → name `apprentice-recordings-aibc2026` → Location type **Region**, `asia-south1` →
   Storage class Standard → **Enforce public access prevention: on**, Access control **Uniform** → Create. If the name is
   taken, add another suffix and use that name in step 14.
2. Bucket → **Permissions → Grant access** → principal `apprentice-run@aibuildercup-india-2026.iam.gserviceaccount.com` → role
   **Storage Object Admin**.
3. CORS has no console editor. Open **Cloud Shell** (top bar, `>_`) and run:

   ```bash
   cat > cors.json <<'EOF'
   [{"origin": ["http://localhost:5173"], "method": ["PUT", "GET"],
     "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]
   EOF
   gcloud storage buckets update gs://apprentice-recordings-aibc2026 --cors-file=cors.json
   ```

4. Judges' sandbox recordings are deleted after 14 days. Bucket → **Lifecycle → Add a rule** → action **Delete object**
   → conditions **Age: 14 days** and **Object name matches prefix**: `sandbox-`, `essays-sandbox-`, `volunteers-sandbox-`
   → Create. (Or in Cloud Shell: save `{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 14, "matchesPrefix": ["sandbox-", "essays-sandbox-", "volunteers-sandbox-"]}}]}` as `lifecycle.json` and run
   `gcloud storage buckets update gs://apprentice-recordings-aibc2026 --lifecycle-file=lifecycle.json`.)

**Check:** bucket **Configuration** shows Region `asia-south1` and public access prevention on; **Lifecycle** shows the
14-day delete rule.

## 10. Firebase + Google sign-in

1. Firebase console → **Add project** → **pick the existing Google Cloud project** `aibuildercup-india-2026` → confirm the
   Firebase billing plan (Blaze, it uses the linked billing account) → Google Analytics: off.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → support email → Save.
3. **Project settings (gear) → General → Your apps → Web `</>`** → nickname `apprentice-web` → don't set up Hosting →
   Register. Copy `apiKey`, `authDomain`, `projectId`: these become `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID` (public web config, not secrets).
4. If you skipped the Firestore rules in step 5, set them now.

**Check:** Sign-in method shows **Google — Enabled**.

## 11. OAuth consent screen + client ID (Connect Sheet)

Cloud Console → **Google Auth Platform** (APIs & Services → OAuth consent screen):

1. **Branding:** App name `Apprentice`, user support email and developer contact = your account.
2. **Audience:** **External**, keep **Testing**; **Test users → Add users** → the demo account email.
3. **Data access → Add or remove scopes** → `.../auth/spreadsheets.readonly` → Update → Save.
4. **Clients → Create client** → Application type **Web application** → name `apprentice-web` → **Authorised JavaScript
   origins:** `http://localhost:5173` → Create. Copy the **Client ID**: this becomes `VITE_GOOGLE_CLIENT_ID`.

**Check:** Audience lists the demo account as a test user; the client is listed under Clients.

## 12. Local credentials

No console path: on your laptop run `gcloud auth application-default login` and
`gcloud auth application-default set-quota-project aibuildercup-india-2026` (see the CLI file, step 12).

**Check:** see Cloud_Setup_CLI.md step 12.

## 13. Store the SOP

No console path: from the repo, `GCP_PROJECT=aibuildercup-india-2026 uv run python -m scripts.make_synthetic --upload-sop`.

**Check:** Firestore → Data → `workspaces` → `live` → `sop` → `AP-SOP-07` exists.

## 14. First deploy

From the repo in a bash shell, with the values from steps 1, 8, 10 and 11 (`ADMIN_UIDS=none` for now):

```bash
PROJECT=aibuildercup-india-2026 BUCKET=apprentice-recordings-aibc2026 MA_LOCATION=asia-south1 \
  EXPERT_EMAIL="you@example.com" ADMIN_UIDS=none SANDBOX_CODE="<judge code, e.g. from openssl rand -hex 6>" \
  VITE_FIREBASE_API_KEY="..." VITE_FIREBASE_AUTH_DOMAIN="aibuildercup-india-2026.firebaseapp.com" \
  VITE_FIREBASE_PROJECT_ID="aibuildercup-india-2026" VITE_GOOGLE_CLIENT_ID="..." \
  bash scripts/deploy.sh
```

Then **Cloud Run → `apprentice`** shows the service URL at the top. If the build failed with a permission error, **IAM → Grant
access** → principal `<project-number>-compute@developer.gserviceaccount.com` → role **Cloud Run Builder**, and deploy again.

**Check:** `<service URL>/api/health` returns `{"ok":true,...}` and `<service URL>/demo/` loads.

## 15. After the first deploy

The service has **two** URLs; use both below. One is shown at the top of **Cloud Run → `apprentice`**
(`https://apprentice-xxxxx-el.a.run.app`); the other is `https://apprentice-<project number>.asia-south1.run.app` (project
number on the Cloud Console home page).

1. Firebase → **Authentication → Settings → Authorised domains → Add domain** → each URL's host (no `https://`).
2. Google Auth Platform → **Clients → `apprentice-web`** → add both URLs to Authorised JavaScript origins → Save.
3. Bucket CORS with both URLs (Cloud Shell). A missing URL makes uploads fail with "Failed to fetch":

   ```bash
   cat > cors.json <<'EOF'
   [{"origin": ["http://localhost:5173", "https://URL-ONE", "https://URL-TWO"], "method": ["PUT", "GET"],
     "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]
   EOF
   gcloud storage buckets update gs://apprentice-recordings-aibc2026 --cors-file=cors.json
   ```

4. Open the service URL, sign in as the expert. Firebase → **Authentication → Users** → copy the **User UID** → deploy again
   (step 14) with `ADMIN_UIDS=<that uid>`.

**Check:** the expert reaches the live workspace; another account sees "This account can't open the live workspace"; a short
test recording appears under **Cloud Storage → the bucket → `live/`**.

## 16. Seed the demo workspace

After the real run, from the repo:
`GCP_PROJECT=aibuildercup-india-2026 uv run python -m scripts.export_demo --from live --out fixtures/demo_seed.json`, then
`GCP_PROJECT=aibuildercup-india-2026 uv run python scripts/seed_demo.py fixtures/demo_seed.json`.

**Check:** `<service URL>/demo/` in an incognito window shows the real run (not the synthetic fixtures).
