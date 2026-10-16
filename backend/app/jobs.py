"""Fire-and-forget background work for 202 endpoints (Cloud Run runs with --no-cpu-throttling)."""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

log = logging.getLogger(__name__)
_running: set[asyncio.Task[None]] = set()  # strong refs: the loop only keeps weak ones
_locks: dict[str, asyncio.Lock] = {}


def lock(key: str) -> asyncio.Lock:
    """Serialise check-then-write on one key. ponytail: per process; with more than one Cloud Run
    instance this needs Firestore transactions instead."""
    return _locks.setdefault(key, asyncio.Lock())


def spawn(
    name: str,
    work: Coroutine[Any, Any, Any],
    on_error: Callable[[Exception], Awaitable[None]] | None = None,
) -> None:
    async def run() -> None:
        try:
            await work
        except Exception as e:  # a job must never die silently
            log.exception("job %s failed", name)
            if on_error:
                await on_error(e)

    task = asyncio.create_task(run(), name=name)
    _running.add(task)
    task.add_done_callback(_running.discard)


async def drain() -> None:
    """Wait for every running job. Tests use it; so could a graceful shutdown."""
    while _running:
        await asyncio.gather(*list(_running))
