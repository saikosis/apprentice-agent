"""Variant discovery across sessions, one call (prompts/variants.md)."""

from backend.app.store import Store


async def discover(store: Store) -> None:
    """One call over all processed sessions; replaces workspaces/{ws}/variants."""
    raise NotImplementedError("Variant discovery isn't built yet (A4).")
