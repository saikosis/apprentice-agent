# Cloud setup: `gcloud` commands

The 16 steps from [Cloud_Setup.md](Cloud_Setup.md) as commands. Paste them into a **bash** shell (Git Bash on Windows, or
Cloud Shell) from the repo root. Each step ends with a **Check**; don't move on until it passes. Steps 10 and 11 have no CLI
and point to the console.

## 1. Variables

Fill in the two emails. Nothing here is committed; keep it in this shell session.

```bash
export PROJECT=aibuildercup-india-2026
export REGION=asia-south1
export BILLING_ACCOUNT=0174D5-2E20A5-C98327          # "Personal"
export BUCKET=apprentice-recordings-aibc2026
export SA=apprentice-run@${PROJECT}.iam.gserviceaccount.com
export MA_LOCATION=asia-south1                        # step 8 may change this to us-central1
export EXPERT_EMAIL="you@example.com"                 # the expert's Google account: the only one allowed into the live workspace
export DEMO_ACCOUNT_EMAIL="demo@example.com"          # the demo Google account that owns the "AP Queue – Oct" Sheet
gcloud config set project "$PROJECT"
```

**Check:** `gcloud config get-value project` prints `aibuildercup-india-2026`.

## 2. Link billing

```bash
gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT"
```

**Check:** `gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)'` prints `True`.

## 3. Budget (₹5,000 / month; alerts at 50%, 90%, 100%)

The budget API has to be on first; alerts go to the billing account admins by default.

```bash
gcloud services enable billingbudgets.googleapis.com
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="apprentice monthly" --budget-amount=5000INR \
  --filter-projects="projects/$PROJECT" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

**Check:** `gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName,amount.specifiedAmount.units)'`
shows `apprentice monthly  5000`.

## 4. Enable the APIs

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com modelarmor.googleapis.com sheets.googleapis.com apikeys.googleapis.com \
  generativelanguage.googleapis.com firebase.googleapis.com identitytoolkit.googleapis.com \
  cloudresourcemanager.googleapis.com
```

**Check:** `gcloud services list --enabled --format='value(config.name)' | grep -cE 'run|firestore|secretmanager|modelarmor|generativelanguage'` prints `5`.

## 5. Firestore (Native, `asia-south1`)

```bash
gcloud firestore databases create --location="$REGION" --type=firestore-native
```

Then lock client access (all access is server-side through the Admin SDK, SPEC §2). There is no `gcloud` command for rules:
Firebase console → Firestore Database → **Rules**, set and publish:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

(Firebase may not be added yet; if the Rules tab isn't there, come back after step 10.)

**Check:** `gcloud firestore databases describe --format='value(locationId,type)'` prints `asia-south1  FIRESTORE_NATIVE`.

## 6. Gemini API key → Secret Manager

Creates a key in this project, restricted to the Gemini API, and stores it without printing it.

```bash
gcloud services api-keys create --display-name="apprentice gemini" \
  --api-target=service=generativelanguage.googleapis.com
KEY_NAME=$(gcloud services api-keys list --filter='displayName="apprentice gemini"' --format='value(name)' | head -1)
gcloud services api-keys get-key-string "$KEY_NAME" --format='value(keyString)' \
  | tr -d '\n' | gcloud secrets create gemini-api-key --replication-policy=automatic --data-file=-
```

(Prefer AI Studio? Create the key there with "Create API key in existing project" → `aibuildercup-india-2026`, then pipe it
into the same `gcloud secrets create` command. Don't paste it into a file in the repo.)

**Check:** `gcloud secrets versions list gemini-api-key --format='value(state)'` prints `enabled`.

## 7. Runtime service account and roles

```bash
gcloud iam service-accounts create apprentice-run --display-name="Apprentice Cloud Run runtime"
gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/modelarmor.user
# V4 signed URLs on Cloud Run: the SA signs through IAM with its own token
gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountTokenCreator
```

The bucket role (`roles/storage.objectAdmin`) is granted in step 9.

**Check:** `gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:$SA" --format='value(bindings.role)'`
lists `roles/datastore.user` and `roles/modelarmor.user`.

## 8. Model Armor template `apprentice-default`

Regional endpoint first, then the template (SPEC §6): prompt injection at LOW_AND_ABOVE, Sensitive Data Protection basic,
malicious URLs, RAI at MEDIUM_AND_ABOVE.

```bash
gcloud config set api_endpoint_overrides/modelarmor "https://modelarmor.${MA_LOCATION}.rep.googleapis.com/"
gcloud model-armor templates create apprentice-default --location="$MA_LOCATION" \
  --pi-and-jailbreak-filter-settings-enforcement=enabled \
  --pi-and-jailbreak-filter-settings-confidence-level=low-and-above \
  --basic-config-filter-enforcement=enabled \
  --malicious-uri-filter-settings-enforcement=enabled \
  --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"HARASSMENT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"DANGEROUS","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"MEDIUM_AND_ABOVE"}]'
```

If `asia-south1` is refused (location not supported), use the fallback and remember it for step 14:

```bash
export MA_LOCATION=us-central1    # then re-run the two commands above
```

**Check:** `gcloud model-armor templates describe apprentice-default --location="$MA_LOCATION" --format='value(name)'` prints the
template's full name. Later (after step 12), test that bank-account numbers are caught; if not, switch Sensitive Data Protection
to advanced with an inspect template including FINANCIAL_ACCOUNT_NUMBER and IBAN_CODE.

## 9. Recordings bucket + CORS

```bash
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectAdmin
cat > /tmp/apprentice-cors.json <<'EOF'
[{"origin": ["http://localhost:5173"], "method": ["PUT", "GET"],
  "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
EOF
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/apprentice-cors.json
```

If the name is taken ("already exists" and you don't own it), pick another suffix, update `BUCKET`, and use the same name in
step 14. The Cloud Run URL is added to CORS in step 15.

**Check:** `gcloud storage buckets describe "gs://$BUCKET" --format='value(location,cors_config)'` shows `ASIA-SOUTH1` and the
localhost origin.

## 10. Firebase + Google sign-in (console only)

1. https://console.firebase.google.com → **Add project** → choose the existing Google Cloud project `aibuildercup-india-2026`
   (don't create a new one). Analytics: off.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**; support email = your account.
3. **Project settings → General → Your apps → Web (`</>`)** → nickname `apprentice-web` → Register (no Hosting). Copy
   `apiKey`, `authDomain`, `projectId` from the config shown.
4. Now publish the Firestore rules from step 5 if you skipped them.

```bash
export VITE_FIREBASE_API_KEY="..."          # from step 10.3 (public web config, not a secret)
export VITE_FIREBASE_AUTH_DOMAIN="aibuildercup-india-2026.firebaseapp.com"
export VITE_FIREBASE_PROJECT_ID="aibuildercup-india-2026"
```

**Check:** Authentication → Sign-in method lists **Google: Enabled**.

## 11. OAuth consent screen + client ID for Connect Sheet (console only)

Cloud Console → **Google Auth Platform** (APIs & Services → OAuth consent screen):

1. **Branding:** app name `Apprentice`, support email = your account.
2. **Audience:** User type **External**, publishing status **Testing**; **Test users → Add** `$DEMO_ACCOUNT_EMAIL`.
3. **Data access → Add scopes:** `https://www.googleapis.com/auth/spreadsheets.readonly` (read-only; the app never writes).
4. **Clients → Create client → Web application**, name `apprentice-web`; **Authorised JavaScript origins:**
   `http://localhost:5173` (the Cloud Run URL is added in step 15). No redirect URIs needed (token client). Copy the client ID.

```bash
export VITE_GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
```

**Check:** the client appears under Clients, and Audience shows your demo account as a test user.

## 12. Local credentials

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT"
```

**Check:** `GCP_PROJECT=$PROJECT uv run python -c "from google.cloud import firestore; print(firestore.Client(project='$PROJECT').project)"`
prints the project id.

## 13. Store the SOP

```bash
GCP_PROJECT=$PROJECT uv run python -m scripts.make_synthetic --upload-sop
```

**Check:** Firebase console → Firestore → `workspaces/live/sop/AP-SOP-07` exists.

## 14. First deploy

`ADMIN_UIDS` isn't known until you sign in once (step 15); use a placeholder for now.

```bash
export ADMIN_UIDS=none
PROJECT=$PROJECT BUCKET=$BUCKET MA_LOCATION=$MA_LOCATION EXPERT_EMAIL=$EXPERT_EMAIL ADMIN_UIDS=$ADMIN_UIDS \
  VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
  VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
  bash scripts/deploy.sh
export URL=$(gcloud run services describe apprentice --region="$REGION" --format='value(status.url)')
echo "$URL"
```

If the build fails with a permission error on the build service account, grant it the builder role and re-run:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/run.builder
```

**Check:** `curl -s "$URL/api/health"` returns `{"ok":true,...}`, and `$URL/demo/` loads in a browser.

## 15. After the first deploy

1. **Firebase authorised domain:** Authentication → Settings → Authorised domains → **Add** the host of `$URL`
   (e.g. `apprentice-xxxxx-el.a.run.app`). Console only.
2. **OAuth origin:** Google Auth Platform → Clients → `apprentice-web` → add `$URL` to Authorised JavaScript origins. Console only.
3. **Bucket CORS** with the service URL:

   ```bash
   cat > /tmp/apprentice-cors.json <<EOF
   [{"origin": ["http://localhost:5173", "$URL"], "method": ["PUT", "GET"],
     "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
   EOF
   gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/apprentice-cors.json
   ```

4. **`ADMIN_UIDS`:** open `$URL`, sign in as `$EXPERT_EMAIL`; Firebase console → Authentication → Users → copy the **User UID**.
   `export ADMIN_UIDS=<uid>` and run the step 14 deploy command again.

**Check:** signing in as `$EXPERT_EMAIL` opens the live workspace; any other account sees "This account can't open the live
workspace"; a short test recording uploads; `gcloud storage ls "gs://$BUCKET/live/"` lists it.

## 16. Seed the demo workspace

After the real run (sessions recorded, questions answered, exam labelled and run):

```bash
GCP_PROJECT=$PROJECT uv run python -m scripts.export_demo --from live --out fixtures/demo_seed.json
GCP_PROJECT=$PROJECT uv run python scripts/seed_demo.py fixtures/demo_seed.json
```

**Check:** `curl -s "$URL/api/demo/bundle" | head -c 200` shows sessions, and `/demo/` in an incognito window shows the real run.
