"""In-memory stand-in for the slice of firestore.AsyncClient that store.py uses."""

import copy
from collections.abc import AsyncIterator
from typing import Any


class Snap:
    def __init__(self, id: str, data: dict[str, Any] | None) -> None:
        self.id, self._data = id, data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._data)


class DocRef:
    def __init__(self, db: "FakeDb", path: str) -> None:
        self._db, self.path, self.id = db, path, path.rsplit("/", 1)[-1]

    async def get(self) -> Snap:
        return Snap(self.id, self._db.docs.get(self.path))

    async def set(self, data: dict[str, Any], merge: bool = False) -> None:
        base = self._db.docs.get(self.path, {}) if merge else {}
        self._db.docs[self.path] = {**copy.deepcopy(base), **copy.deepcopy(data)}

    async def delete(self) -> None:
        self._db.docs.pop(self.path, None)


class CollRef:
    def __init__(self, db: "FakeDb", path: str) -> None:
        self._db, self.path = db, path

    def document(self, id: str) -> DocRef:
        return DocRef(self._db, f"{self.path}/{id}")

    async def stream(self) -> AsyncIterator[Snap]:
        prefix = self.path + "/"
        for p in sorted(self._db.docs):
            if p.startswith(prefix) and "/" not in p[len(prefix) :]:
                yield Snap(p[len(prefix) :], copy.deepcopy(self._db.docs[p]))


class Batch:
    def __init__(self) -> None:
        self.ops: list[tuple[str, DocRef, dict[str, Any] | None]] = []

    def set(self, ref: DocRef, data: dict[str, Any]) -> None:
        self.ops.append(("set", ref, data))

    def delete(self, ref: DocRef) -> None:
        self.ops.append(("delete", ref, None))

    async def commit(self) -> None:
        for op, ref, data in self.ops:
            await (ref.set(data) if op == "set" and data is not None else ref.delete())


class FakeDb:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, Any]] = {}

    def document(self, path: str) -> DocRef:
        return DocRef(self, path)

    def collection(self, path: str) -> CollRef:
        return CollRef(self, path)

    def batch(self) -> Batch:
        return Batch()
