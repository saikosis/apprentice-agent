"""Recordings in Cloud Storage: gs://{BUCKET}/{ws}/{session_id}.webm, reached via V4 signed URLs."""

import os
from datetime import timedelta
from functools import lru_cache
from typing import Any

import google.auth
from fastapi.concurrency import run_in_threadpool
from google.auth.transport.requests import Request
from google.cloud import storage  # type: ignore[attr-defined]


def object_uri(ws: str, session_id: str) -> str:
    return f"gs://{os.environ['BUCKET']}/{ws}/{session_id}.webm"


@lru_cache
def _client() -> storage.Client:
    return storage.Client(project=os.getenv("GCP_PROJECT"))


def _blob(gcs_uri: str) -> Any:
    bucket, _, name = gcs_uri.removeprefix("gs://").partition("/")
    return _client().bucket(bucket).blob(name)


def _sign(gcs_uri: str, method: str, minutes: int, content_type: str | None) -> str:
    # On Cloud Run there is no private key: sign through IAM with the runtime SA's token
    # (needs roles/iam.serviceAccountTokenCreator on itself).
    creds, _ = google.auth.default()
    creds.refresh(Request())
    return str(
        _blob(gcs_uri).generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=minutes),
            method=method,
            content_type=content_type,
            service_account_email=getattr(creds, "service_account_email", None),
            access_token=creds.token,
        )
    )


async def signed_url(
    gcs_uri: str, method: str, minutes: int, content_type: str | None = None
) -> str:
    return await run_in_threadpool(_sign, gcs_uri, method, minutes, content_type)


async def exists(gcs_uri: str) -> bool:
    return bool(await run_in_threadpool(_blob(gcs_uri).exists))


async def download(gcs_uri: str, path: str) -> None:
    await run_in_threadpool(_blob(gcs_uri).download_to_filename, path)
