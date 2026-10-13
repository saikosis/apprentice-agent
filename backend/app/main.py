from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.app import gemini
from backend.app.routers import auth, demo, exam, graph, live, probes, sessions, sheets, uploads

VERSION = "0.1.0"

app = FastAPI(title="Apprentice", version=VERSION)

for r in (auth, live, uploads, sessions, probes, graph, exam, sheets, demo):
    app.include_router(r.router, prefix="/api")


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
