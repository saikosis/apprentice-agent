"""Recordings in Cloud Storage: gs://{BUCKET}/{ws}/{session_id}.webm, reached via V4 signed URLs."""

import os
from datetime import timedelta
from functools import lru_cache
from typing import Any

import google.auth
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from google.auth.transport.requests import Request
from google.cloud import storage  # type: ignore[attr-defined]


def object_uri(ws: str, session_id: str) -> str:
    bucket = os.getenv("BUCKET")
    if not bucket:  # e.g. a laptop run before the bucket exists
        raise HTTPException(503, "Recording upload needs the storage bucket; BUCKET isn't set.")
    return f"gs://{bucket}/{ws}/{session_id}.webm"


@lru_cache
def _client() -> storage.Client:
    return storage.Client(project=os.getenv("GCP_PROJECT"))


def _blob(gcs_uri: str) -> Any:
    bucket, _, name = gcs_uri.removeprefix("gs://").partition("/")
    return _client().bucket(bucket).blob(name)


def _sign(
    gcs_uri: str, method: str, minutes: int, content_type: str | None, max_bytes: int | None
) -> str:
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
            # Cloud Storage itself refuses a bigger upload, whatever size the browser declared
            headers=length_header(max_bytes),
            service_account_email=getattr(creds, "service_account_email", None),
            access_token=creds.token,
        )
    )


def length_header(max_bytes: int | None) -> dict[str, str] | None:
    return {"x-goog-content-length-range": f"0,{max_bytes}"} if max_bytes else None


async def signed_url(
    gcs_uri: str,
    method: str,
    minutes: int,
    content_type: str | None = None,
    max_bytes: int | None = None,
) -> str:
    return await run_in_threadpool(_sign, gcs_uri, method, minutes, content_type, max_bytes)


async def exists(gcs_uri: str) -> bool:
    return bool(await run_in_threadpool(_blob(gcs_uri).exists))


async def download(gcs_uri: str, path: str) -> None:
    await run_in_threadpool(_blob(gcs_uri).download_to_filename, path)
