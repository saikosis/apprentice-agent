#!/usr/bin/env bash
# Deploy to Cloud Run (one service: API + web). Run from the repo root:
#   EXPERT_EMAIL=expert@... ADMIN_UIDS=uid1 SANDBOX_CODE=<judge code> \
#   VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=... VITE_FIREBASE_PROJECT_ID=... \
#   VITE_GOOGLE_CLIENT_ID=... scripts/deploy.sh
# One-time setup first: docs/Cloud_Setup.md. PROJECT, BUCKET and MA_LOCATION default to the agreed values.
set -euo pipefail
PROJECT=${PROJECT:-aibuildercup-india-2026}
BUCKET=${BUCKET:-apprentice-recordings-aibc2026}
MA_LOCATION=${MA_LOCATION:-asia-south1}   # us-central1 if Model Armor was not available in asia-south1
: "${EXPERT_EMAIL:?set EXPERT_EMAIL (the only account allowed into the live workspace)}"
: "${ADMIN_UIDS:?set ADMIN_UIDS (Firebase uids allowed to seed the demo)}"
# The judge code for the sandbox (docs/Judge_Guide.md). Long and random; no "|". Keep the same one across deploys.
: "${SANDBOX_CODE:?set SANDBOX_CODE (the judge code; e.g. export SANDBOX_CODE=\$(openssl rand -hex 6))}"
[[ "$SANDBOX_CODE" == *"|"* ]] && { echo "SANDBOX_CODE can't contain |"; exit 1; }
: "${VITE_FIREBASE_API_KEY:?}" "${VITE_FIREBASE_AUTH_DOMAIN:?}" "${VITE_FIREBASE_PROJECT_ID:?}"

# Public web config, baked into the frontend build (--source can't take build args). Git-ignored.
cat > frontend/.env.production <<EOF
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}
EOF

# "^|^" makes | the env-var separator: emails contain @ and ADMIN_UIDS may contain commas.
gcloud run deploy apprentice --project "$PROJECT" --source . --region asia-south1 \
  --allow-unauthenticated --min-instances 1 --no-cpu-throttling --timeout 900 --memory 1Gi \
  --service-account "apprentice-run@${PROJECT}.iam.gserviceaccount.com" \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars "^|^GCP_PROJECT=${PROJECT}|BUCKET=${BUCKET}|MA_LOCATION=${MA_LOCATION}|MA_TEMPLATE=apprentice-default|EXPERT_EMAIL=${EXPERT_EMAIL}|ADMIN_UIDS=${ADMIN_UIDS}|SANDBOX_CODE=${SANDBOX_CODE}|SANDBOX_ENABLED=${SANDBOX_ENABLED:-1}"
