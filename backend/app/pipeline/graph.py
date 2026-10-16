"""Decision graph builder; clean inputs only, never expert_label (prompts/graph.md)."""

from backend.app.store import Store


async def build(store: Store) -> None:
    """Build the next graph version from clean (unflagged) inputs and store it."""
    raise NotImplementedError("The graph builder isn't built yet (A5).")
