from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles

from backend.app import errors, gemini
from backend.app.routers import (
    auth,
    demo,
    exam,
    graph,
    live,
    probes,
    sandbox,
    sessions,
    sheets,
    uploads,
)

VERSION = "0.1.0"

app = FastAPI(title="Apprentice", version=VERSION)
errors.install(app)

# Public: /api/health (below) and the demo router (bundle, demo playback; seed checks admin).
# /api/me and /api/sandbox/*: any signed-in user (explain a refusal; redeem the judge code).
# Everything else: the expert (live workspace) or a judge (their own sandbox); see workspace.py.
app.include_router(auth.router, prefix="/api", dependencies=[Depends(auth.require_user)])
app.include_router(sandbox.router, prefix="/api", dependencies=[Depends(auth.require_user)])
for r in (live, uploads, sessions, probes, graph, exam, sheets):
    app.include_router(r.router, prefix="/api", dependencies=[Depends(auth.require_member)])
app.include_router(demo.router, prefix="/api")


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "version": VERSION,
        "models": {"live": gemini.LIVE_MODEL, "flash": gemini.FLASH_MODEL, "pro": gemini.PRO_MODEL},
    }


_static = Path(__file__).parent / "static"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
