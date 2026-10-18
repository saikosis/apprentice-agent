"""Connect Sheet: before/after snapshots of the scenario's work tab, and the diff between them.

The browser reads the Sheet with the expert's read-only OAuth token and posts the rows here.
Nothing is ever written back to Sheets.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from backend.app import domains
from backend.app.contract import CellChange, SheetDiff, SheetSnapshot
from backend.app.routers.sessions import get_or_404
from backend.app.workspace import LiveStore

router = APIRouter(tags=["sheets"])


class SnapshotReq(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    phase: Literal["before", "after"]
    rows: list[dict[str, str]] = Field(max_length=1000)


def _keyed(rows: list[dict[str, str]], id_column: str) -> dict[str, dict[str, str]]:
    """By the id column, with "#2", "#3"... for repeats so duplicate rows aren't merged away."""
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        base = r.get(id_column) or "(no id)"
        key, n = base, 1
        while key in out:
            n += 1
            key = f"{base}#{n}"
        out[key] = r
    return out


def diff_rows(
    session_id: str,
    before: list[dict[str, str]],
    after: list[dict[str, str]],
    id_column: str = "invoice_id",
) -> SheetDiff:
    old, new = _keyed(before, id_column), _keyed(after, id_column)
    changes: list[CellChange] = []
    for inv in sorted(old.keys() | new.keys()):
        if inv not in old:
            changes.append(CellChange(invoice_id=inv, column="row", before=None, after="added"))
        elif inv not in new:
            changes.append(CellChange(invoice_id=inv, column="row", before="present", after=None))
        else:
            for col in sorted(old[inv].keys() | new[inv].keys()):
                was, now = old[inv].get(col), new[inv].get(col)
                if was != now:
                    changes.append(
                        CellChange(
                            invoice_id=inv,
                            column=col,
                            before=None if was is None else str(was),
                            after=None if now is None else str(now),
                        )
                    )
    return SheetDiff(session_id=session_id, changes=changes)


@router.post("/sheets/snapshot")
async def snapshot(body: SnapshotReq, store: LiveStore) -> SheetSnapshot:
    s = await get_or_404(store, body.session_id)
    snap = SheetSnapshot(
        id=f"{body.session_id}-{body.phase}",
        session_id=body.session_id,
        phase=body.phase,
        taken_at=datetime.now(UTC),
        rows=body.rows,
    )
    await store.sheet_snapshots(body.session_id).put(snap)
    await store.sessions.put(s.model_copy(update={f"sheet_snapshot_{body.phase}_id": snap.id}))
    # recompute whenever both exist, so a re-taken or late snapshot never leaves a stale diff
    snaps = store.sheet_snapshots(body.session_id)
    before = await snaps.get(f"{body.session_id}-before")
    after = await snaps.get(f"{body.session_id}-after")
    if before and after:
        id_column = domains.load(store.scenario).info.id_column
        await store.put_sheet_diff(diff_rows(body.session_id, before.rows, after.rows, id_column))
    return snap
