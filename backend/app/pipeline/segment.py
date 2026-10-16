"""Segmenter: video -> SegmentList (prompts/segmenter.md)."""

from backend.app.store import Store


async def process_session(store: Store, session_id: str) -> None:
    """Whole batch run for one uploaded session: Files API → segment → armor → deviations → probes.

    Called in the background by POST /api/sessions/{id}/process; sets status processed/failed.
    """
    raise NotImplementedError("The batch pipeline isn't built yet (A4).")
