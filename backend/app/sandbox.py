"""Judge sandbox membership (docs/Judge_Sandbox.md): a judge code, redeemed once per Google account."""

import hmac
import os
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Literal, get_args

from fastapi import HTTPException

from backend.app import store
from backend.app.contract import SandboxInfo, Scenario

Kind = Literal["recordings", "graph_builds", "exam_runs", "case_generations"]
LIMIT_EACH = 5  # per judge, per kind, for the life of the sandbox
GLOBAL_LIMIT = 100  # sandbox actions per IST day, all judges together
MAX_RECORDING_S = 330  # 5:00 plus grace; the browser stops at 5:00
MAX_RECORDING_BYTES = 200 * 1024**2  # a 5-minute tab recording is well under this
LIVE_WINDOW_S = 360  # Live tokens only within 6 minutes of a sandbox session's start
MAX_CODE_TRIES = 10  # wrong judge codes per account, then locked out
RETENTION = timedelta(
    days=14
)  # sandboxes (and, by bucket lifecycle rule, their videos) are deleted after this
_swept_on: date | None = None
IST = timezone(timedelta(hours=5, minutes=30))
_WHAT = {
    "recordings": "recordings",
    "graph_builds": "graph builds",
    "exam_runs": "exam runs",
    "case_generations": "exam case generations",
}


def enabled() -> bool:
    """Off unless SANDBOX_CODE is set; SANDBOX_ENABLED=0 closes it without forgetting the code."""
    return bool(os.getenv("SANDBOX_CODE")) and os.getenv("SANDBOX_ENABLED", "1") != "0"


def _doc(uid: str) -> object:
    return store.default_db().document(f"sandboxes/{uid}")


def _today_doc() -> object:
    return store.default_db().document(f"sandbox_usage/{datetime.now(IST).date().isoformat()}")


async def _today() -> int:
    snap = await _today_doc().get()  # type: ignore[attr-defined]
    return int((snap.to_dict() or {}).get("count", 0)) if snap.exists else 0


async def get(uid: str) -> SandboxInfo | None:
    snap = await _doc(uid).get()  # type: ignore[attr-defined]
    if not snap.exists:
        return None
    info = SandboxInfo.model_validate(snap.to_dict())
    return info.model_copy(
        update={
            "limit_each": LIMIT_EACH,
            "global_today": await _today(),
            "global_limit": GLOBAL_LIMIT,
        }
    )


async def all_sandboxes() -> list[SandboxInfo]:
    today = await _today()
    out = []
    async for snap in store.default_db().collection("sandboxes").stream():
        info = SandboxInfo.model_validate(snap.to_dict())
        out.append(info.model_copy(update={"global_today": today, "global_limit": GLOBAL_LIMIT}))
    return sorted(out, key=lambda s: s.created_at)


async def sweep() -> list[str]:
    """Delete every sandbox older than RETENTION. Returns the uids removed."""
    cutoff = datetime.now(UTC) - RETENTION
    gone = [s.uid for s in await all_sandboxes() if s.created_at < cutoff]
    for uid in gone:
        await delete(uid)
    return gone


async def maybe_sweep() -> list[str]:
    """At most once per IST day per instance: the first request of the day (and after a restart)."""
    global _swept_on
    today = datetime.now(IST).date()
    if _swept_on == today:
        return []
    _swept_on = today
    return await sweep()


def check_open() -> None:
    if not enabled():
        raise HTTPException(403, "The judge sandbox is closed.")


async def charge(ws_store: store.Store, kind: Kind) -> None:
    """Count one sandbox action before it starts; refuse past the judge's or the day's limit.
    No-op outside a sandbox (the expert is never limited)."""
    if ws_store.ws != "sandbox":
        return
    check_open()
    uid = ws_store.uid or ""
    info = await get(uid)
    if info is None:
        raise HTTPException(403, "Enter the judge code to use Apprentice.")
    used = getattr(info.usage, kind)
    if used >= LIMIT_EACH:
        raise HTTPException(
            429, f"You've used {used} of {LIMIT_EACH} {_WHAT[kind]} in this sandbox."
        )
    today = await _today()
    if today >= GLOBAL_LIMIT:
        raise HTTPException(429, "The judge sandbox has reached today's limit. Try again tomorrow.")
    # ponytail: read-modify-write, so two simultaneous requests can both pass one under a limit;
    # use Firestore transactions if exact counts ever matter.
    usage = info.usage.model_copy(update={kind: used + 1})
    await _doc(uid).set(  # type: ignore[attr-defined]
        info.model_copy(update={"usage": usage}).model_dump(
            mode="json", exclude={"global_today", "global_limit", "limit_each"}
        ),
        merge=True,
    )
    await _today_doc().set({"count": today + 1})  # type: ignore[attr-defined]


async def join(uid: str, email: str, code: str) -> SandboxInfo:
    if not enabled():
        raise HTTPException(403, "The judge sandbox is closed.")
    tries = store.default_db().document(f"sandbox_code_tries/{uid}")
    snap = await tries.get()
    failed = int((snap.to_dict() or {}).get("failed", 0)) if snap.exists else 0
    if failed >= MAX_CODE_TRIES:
        raise HTTPException(429, "Too many wrong judge codes from this account.")
    expected = os.environ["SANDBOX_CODE"].encode()
    if not hmac.compare_digest(code.strip().encode(), expected):
        await tries.set({"failed": failed + 1})
        raise HTTPException(403, "That judge code isn't right.")
    if existing := await get(uid):
        return existing
    info = SandboxInfo(uid=uid, email=email, created_at=datetime.now(UTC))
    await _doc(uid).set(info.model_dump(mode="json"))  # type: ignore[attr-defined]
    await fill(uid, sample=True)
    return info


def _stores(uid: str) -> list[store.Store]:
    return [store.Store("sandbox", uid=uid, scenario=sc) for sc in get_args(Scenario)]


async def fill(uid: str, *, sample: bool) -> None:
    """Each workflow's sandbox gets a copy of that workflow's sample run (its demo workspace), or
    starts empty; either way with the workflow's SOP, so the judge can record straight away."""
    from backend.app.routers.demo import export_seed, load_seed

    if sample:
        for target in _stores(uid):
            seed = await export_seed(store.Store("demo", scenario=target.scenario))
            if seed.sessions or seed.graph:
                await load_seed(target, seed)
    await copy_sops(uid)


async def wipe(uid: str) -> None:
    """Delete every workflow's sandbox data and recordings. Usage counters live elsewhere and stay."""
    from backend.app import storage

    for target in _stores(uid):
        await target.wipe()
        await storage.delete_prefix(f"{target.root_name}/")


async def reset(uid: str, mode: Literal["sample", "empty"]) -> None:
    check_open()
    await wipe(uid)
    await fill(uid, sample=mode == "sample")


async def delete(uid: str) -> None:
    await wipe(uid)
    await _doc(uid).delete()  # type: ignore[attr-defined]


async def copy_sops(uid: str) -> None:
    """Every workflow's sandbox starts with that workflow's SOP (the live one, else the demo's)."""
    for scenario in get_args(Scenario):
        target = store.Store("sandbox", uid=uid, scenario=scenario)
        if await target.sop.list():
            continue  # the sample brought its own
        for source in ("live", "demo"):
            sops = await store.Store(source, scenario=scenario).sop.list()  # type: ignore[arg-type]
            if sops:
                await target.sop.put(max(sops, key=lambda s: s.version))
                break
