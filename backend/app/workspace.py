"""Which workspace a request reads and writes (docs/Judge_Sandbox.md).

Writes always go to the caller's own workspace: the expert's live workspace, or a judge's private sandbox. Reads take
?ws= but a judge only ever reads their own sandbox (or the demo). Both take ?scenario= (default ap)."""

from typing import Annotated

from fastapi import Depends, HTTPException

from backend.app.contract import Scenario
from backend.app.routers.auth import CurrentRole, CurrentUser
from backend.app.store import Store, Ws


def _own(user_uid: str, role: str, scenario: Scenario) -> Store:
    if role == "expert":
        return Store("live", scenario=scenario)
    if role == "judge":
        return Store("sandbox", uid=user_uid, scenario=scenario)
    raise HTTPException(403, "Enter the judge code to use Apprentice.")


def _read_store(
    user: CurrentUser, role: CurrentRole, ws: Ws = "live", scenario: Scenario = "ap"
) -> Store:
    if ws == "demo":
        return Store("demo", scenario=scenario)
    if ws == "sandbox" and role == "expert":
        raise HTTPException(403, "The expert has no sandbox.")
    return _own(user.uid, role, scenario)


def _writer_store(user: CurrentUser, role: CurrentRole, scenario: Scenario = "ap") -> Store:
    return _own(user.uid, role, scenario)


ReadStore = Annotated[Store, Depends(_read_store)]
LiveStore = Annotated[Store, Depends(_writer_store)]  # the caller's own workspace
