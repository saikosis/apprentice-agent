#!/usr/bin/env bash
# Deploy to Cloud Run (one service: API + web). Run from the repo root:
#   BUCKET=apprentice-recordings-xyz EXPERT_EMAIL=expert@... ADMIN_UIDS=uid1 \
#   VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=... VITE_FIREBASE_PROJECT_ID=... \
#   VITE_GOOGLE_CLIENT_ID=... scripts/deploy.sh
set -euo pipefail
: "${BUCKET:?set BUCKET=apprentice-recordings-<suffix>}"
: "${EXPERT_EMAIL:?set EXPERT_EMAIL (the only account allowed into the live workspace)}"
: "${ADMIN_UIDS:?set ADMIN_UIDS (Firebase uids allowed to seed the demo)}"
: "${VITE_FIREBASE_API_KEY:?}" "${VITE_FIREBASE_AUTH_DOMAIN:?}" "${VITE_FIREBASE_PROJECT_ID:?}"

# Public web config, baked into the frontend build (--source can't take build args). Git-ignored.
cat > frontend/.env.production <<EOF
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}
EOF

# "^|^" makes | the env-var separator: emails contain @ and ADMIN_UIDS may contain commas.
gcloud run deploy apprentice --source . --region asia-south1 \
  --allow-unauthenticated --min-instances 1 --no-cpu-throttling --timeout 900 --memory 1Gi \
  --service-account apprentice-run@apprentice-aibc.iam.gserviceaccount.com \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars "^|^GCP_PROJECT=apprentice-aibc|BUCKET=${BUCKET}|MA_LOCATION=asia-south1|MA_TEMPLATE=apprentice-default|EXPERT_EMAIL=${EXPERT_EMAIL}|ADMIN_UIDS=${ADMIN_UIDS}"
