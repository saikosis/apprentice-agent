#!/usr/bin/env bash
set -euo pipefail
: "${BUCKET:?set BUCKET=apprentice-recordings-<suffix>}"

gcloud run deploy apprentice --source . --region asia-south1 \
  --allow-unauthenticated --min-instances 1 --no-cpu-throttling --timeout 900 --memory 1Gi \
  --service-account apprentice-run@apprentice-aibc.iam.gserviceaccount.com \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars "GCP_PROJECT=apprentice-aibc,BUCKET=${BUCKET},MA_LOCATION=asia-south1,MA_TEMPLATE=apprentice-default"
