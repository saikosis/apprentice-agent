"""Exam case generator (prompts/scenarios.md)."""

from backend.app.contract import ExamCase
from backend.app.store import Store


async def generate(
    store: Store, heldout_session_ids: list[str], n_generated: int
) -> list[ExamCase]:
    """Write exam cases (labels empty) from the graph and held-out sessions, store and return them."""
    raise NotImplementedError("Exam case generation isn't built yet (A6).")
