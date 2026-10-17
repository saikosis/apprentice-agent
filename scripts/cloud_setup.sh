#!/usr/bin/env bash
# Google Cloud + Firebase setup for Apprentice: the 16 steps in docs/Cloud_Setup.md, as one script.
#
#   EXPERT_EMAIL=you@example.com DEMO_ACCOUNT_EMAIL=demo@example.com bash scripts/cloud_setup.sh
#
# Safe to re-run: every step checks before it creates. It pauses at the console-only steps (Firestore rules,
# Firebase, OAuth) and asks you to press Enter when done. Run from the repo root in bash (Git Bash or Cloud Shell).
# It never prints the Gemini key. Start from a step: START=9 bash scripts/cloud_setup.sh
set -euo pipefail

PROJECT=${PROJECT:-aibuildercup-india-2026}
REGION=${REGION:-asia-south1}
BILLING_ACCOUNT=${BILLING_ACCOUNT:-0174D5-2E20A5-C98327}   # "Personal"
BUCKET=${BUCKET:-apprentice-recordings-aibc2026}
MA_LOCATION=${MA_LOCATION:-asia-south1}
BUDGET=${BUDGET:-5000INR}
START=${START:-1}
SA="apprentice-run@${PROJECT}.iam.gserviceaccount.com"
: "${EXPERT_EMAIL:?set EXPERT_EMAIL (Google account of the expert)}"
: "${DEMO_ACCOUNT_EMAIL:?set DEMO_ACCOUNT_EMAIL (owner of the AP Queue Sheet; OAuth test user)}"

step() { echo; echo "=== Step $1: $2"; }
run_from() { [ "$1" -ge "$START" ]; }
pause() { echo; echo ">>> In the console: $1"; read -r -p ">>> Press Enter when done... " _; }
cors() {
  local f; f=$(mktemp)
  printf '[{"origin": [%s], "method": ["PUT", "GET"], "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]\n' "$1" > "$f"
  gcloud storage buckets update "gs://$BUCKET" --cors-file="$f" --quiet
  rm -f "$f"
}

if run_from 1; then
  step 1 "variables"
  gcloud config set project "$PROJECT" --quiet
  echo "project=$PROJECT region=$REGION bucket=$BUCKET model-armor=$MA_LOCATION"
fi

if run_from 2; then
  step 2 "link billing"
  if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)')" != "True" ]; then
    gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT"
  fi
  echo "billing enabled"
fi

if run_from 3; then
  step 3 "budget $BUDGET / month, alerts 50/90/100%"
  gcloud services enable billingbudgets.googleapis.com
  if ! gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' | grep -qx "apprentice monthly"; then
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name="apprentice monthly" \
      --budget-amount="$BUDGET" --filter-projects="projects/$PROJECT" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  fi
fi

if run_from 4; then
  step 4 "enable APIs"
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
    iamcredentials.googleapis.com modelarmor.googleapis.com sheets.googleapis.com apikeys.googleapis.com \
    generativelanguage.googleapis.com firebase.googleapis.com identitytoolkit.googleapis.com \
    cloudresourcemanager.googleapis.com
fi

if run_from 5; then
  step 5 "Firestore (Native, $REGION)"
  if ! gcloud firestore databases describe --format='value(name)' >/dev/null 2>&1; then
    gcloud firestore databases create --location="$REGION" --type=firestore-native
  fi
  gcloud firestore databases describe --format='value(locationId,type)'
  pause "Firebase console > Firestore Database > Rules: 'allow read, write: if false;' for everything (docs/Cloud_Setup_CLI.md step 5). If Firebase isn't added yet, do it at step 10."
fi

if run_from 6; then
  step 6 "Gemini API key -> Secret Manager gemini-api-key"
  if ! gcloud secrets describe gemini-api-key >/dev/null 2>&1; then
    KEY_NAME=$(gcloud services api-keys list --filter='displayName="apprentice gemini"' --format='value(name)' | head -1)
    if [ -z "$KEY_NAME" ]; then
      gcloud services api-keys create --display-name="apprentice gemini" \
        --api-target=service=generativelanguage.googleapis.com
      KEY_NAME=$(gcloud services api-keys list --filter='displayName="apprentice gemini"' --format='value(name)' | head -1)
    fi
    gcloud services api-keys get-key-string "$KEY_NAME" --format='value(keyString)' | tr -d '\n' \
      | gcloud secrets create gemini-api-key --replication-policy=automatic --data-file=-
  fi
  echo "secret gemini-api-key: $(gcloud secrets versions list gemini-api-key --format='value(state)' | head -1)"
fi

if run_from 7; then
  step 7 "service account $SA"
  if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
    gcloud iam service-accounts create apprentice-run --display-name="Apprentice Cloud Run runtime"
  fi
  gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  # A new SA takes a few seconds to reach project IAM ("does not exist"), so retry each grant.
  for role in roles/datastore.user roles/modelarmor.user; do
    for i in 1 2 3 4 5 6; do
      gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" \
        --condition=None --quiet >/dev/null && break
      [ "$i" = 6 ] && exit 1
      echo "service account not visible yet, retrying in 10s..."; sleep 10
    done
  done
  gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" \
    --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null
  echo "roles granted (bucket role in step 9)"
fi

if run_from 8; then
  step 8 "Model Armor template apprentice-default ($MA_LOCATION)"
  gcloud config set api_endpoint_overrides/modelarmor "https://modelarmor.${MA_LOCATION}.rep.googleapis.com/" --quiet
  if ! gcloud model-armor templates describe apprentice-default --location="$MA_LOCATION" >/dev/null 2>&1; then
    gcloud model-armor templates create apprentice-default --location="$MA_LOCATION" \
      --pi-and-jailbreak-filter-settings-enforcement=enabled \
      --pi-and-jailbreak-filter-settings-confidence-level=low-and-above \
      --basic-config-filter-enforcement=enabled \
      --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"HARASSMENT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"DANGEROUS","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"MEDIUM_AND_ABOVE"}]' \
      || { echo "!! Template creation failed in $MA_LOCATION. Re-run with MA_LOCATION=us-central1 START=8."; exit 1; }
  fi
  echo "template ready in $MA_LOCATION (use MA_LOCATION=$MA_LOCATION when deploying)"
fi

if run_from 9; then
  step 9 "bucket gs://$BUCKET + CORS"
  if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
      --uniform-bucket-level-access --public-access-prevention \
      || { echo "!! Bucket name taken? Re-run with BUCKET=apprentice-recordings-<other> START=9."; exit 1; }
  fi
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
    --role=roles/storage.objectAdmin --quiet >/dev/null
  cors '"http://localhost:5173"'
  # judges' sandbox recordings: deleted 14 days after upload (all three workflows' sandbox prefixes)
  lc=$(mktemp)
  echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 14, "matchesPrefix": ["sandbox-", "essays-sandbox-", "volunteers-sandbox-"]}}]}' > "$lc"
  gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$lc" --quiet
  rm -f "$lc"
fi

if run_from 10; then
  step 10 "Firebase + Google sign-in (console only)"
  pause "console.firebase.google.com > Add project > pick existing '$PROJECT'. Then Authentication > Sign-in method > Google > Enable. Then Project settings > Your apps > Web > register 'apprentice-web' and copy apiKey/authDomain/projectId. Publish the Firestore rules if you skipped them."
fi

if run_from 11; then
  step 11 "OAuth consent screen + client ID (console only)"
  pause "Cloud Console > Google Auth Platform: Branding 'Apprentice'; Audience External/Testing with test user $DEMO_ACCOUNT_EMAIL; scope spreadsheets.readonly; Clients > Web application 'apprentice-web', origin http://localhost:5173. Copy the client ID."
fi

if run_from 12; then
  step 12 "local credentials (Application Default Credentials)"
  if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    gcloud auth application-default login
  fi
  gcloud auth application-default set-quota-project "$PROJECT"
fi

if run_from 13; then
  step 13 "store the SOP in workspaces/live/sop/"
  GCP_PROJECT="$PROJECT" uv run python -m scripts.make_synthetic --upload-sop
fi

if run_from 14; then
  step 14 "first deploy"
  : "${VITE_FIREBASE_API_KEY:?set VITE_FIREBASE_API_KEY (step 10), then START=14}"
  PROJECT="$PROJECT" BUCKET="$BUCKET" MA_LOCATION="$MA_LOCATION" EXPERT_EMAIL="$EXPERT_EMAIL" \
    ADMIN_UIDS="${ADMIN_UIDS:-none}" VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
    VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-$PROJECT.firebaseapp.com}" \
    VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-$PROJECT}" VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-}" \
    bash scripts/deploy.sh
fi

if run_from 15; then
  step 15 "after the first deploy"
  # The service answers on two URLs (hash-style and project-number-style); register both.
  URL=$(gcloud run services describe apprentice --region="$REGION" --format='value(status.url)')
  URL2="https://apprentice-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)').$REGION.run.app"
  [ -n "$URL" ] || { echo "!! No service URL; deploy (step 14) first."; exit 1; }
  echo "service URLs: $URL $URL2"
  cors "\"http://localhost:5173\", \"$URL\", \"$URL2\""
  curl -fsS "$URL/api/health" && echo
  pause "Firebase > Authentication > Settings > Authorised domains: add ${URL#https://} and ${URL2#https://}. Google Auth Platform > Clients > apprentice-web: add origins $URL and $URL2."
  echo "Next: sign in at $URL as $EXPERT_EMAIL, copy your User UID from Firebase > Authentication > Users,"
  echo "then: ADMIN_UIDS=<uid> START=14 ... bash scripts/cloud_setup.sh   (redeploys with the admin uid)"
fi

if run_from 16; then
  step 16 "seed the demo workspace"
  if [ -f fixtures/demo_seed.json ]; then
    GCP_PROJECT="$PROJECT" uv run python scripts/seed_demo.py fixtures/demo_seed.json
  else
    echo "No fixtures/demo_seed.json yet. After the real run:"
    echo "  GCP_PROJECT=$PROJECT uv run python -m scripts.export_demo --from live --out fixtures/demo_seed.json"
    echo "  then: START=16 bash scripts/cloud_setup.sh"
  fi
fi

echo; echo "Done (from step $START)."
