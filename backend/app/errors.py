"""Every API error is `{error: {code, message}}` (docs/SPEC.md §3)."""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)

CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "invalid_request",
    429: "rate_limited",
    500: "internal",
    503: "unavailable",
}


def _body(status: int, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": CODES.get(status, "error"), "message": message}}


def conflict(message: str) -> HTTPException:
    """A state violation, e.g. processing a session before its upload finished."""
    return HTTPException(409, message)


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(_body(exc.status_code, str(exc.detail)), exc.status_code, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        msg = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        return JSONResponse(_body(422, msg), 422)

    @app.exception_handler(Exception)
    async def crashed(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(_body(500, "Something went wrong on the server."), 500)
