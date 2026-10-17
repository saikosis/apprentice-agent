"""Scenario packs: everything that differs between workflows (AP invoices, essay marking, volunteer sign-ups).

Each folder holds `domain.md` (filled into every prompt's {{DOMAIN}}; the part after the `<!-- exam-only` line names
the exam traps and goes only to the case writer and the judge), `config.json` (ScenarioInfo, for the UI) and
`reference.json` (the lookup table exam cases are built against; written by scripts/make_synthetic.py).
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, get_args

from backend.app.contract import Scenario, ScenarioInfo

DOMAINS_DIR = Path(__file__).resolve().parent
EXAM_ONLY = "<!-- exam-only"


@dataclass(frozen=True)
class Domain:
    info: ScenarioInfo
    prompt: str  # for every prompt
    exam: str  # trap definitions and grading notes: scenarios + judge only (they would hint at answers)
    reference: list[dict[str, Any]]


@lru_cache
def load(name: str) -> Domain:
    if name not in get_args(Scenario):
        raise ValueError(f"unknown scenario {name!r}")
    d = DOMAINS_DIR / name
    text = (d / "domain.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    prompt, _, exam = text.partition(EXAM_ONLY)
    return Domain(
        info=ScenarioInfo.model_validate_json((d / "config.json").read_text(encoding="utf-8")),
        prompt=prompt.strip() + "\n",
        exam=exam.partition("-->")[2].strip() + "\n",
        reference=json.loads((d / "reference.json").read_text(encoding="utf-8")),
    )


def values(name: str, *, exam: bool = False, **more: str) -> dict[str, str]:
    """Prompt placeholder values: {{DOMAIN}} for this scenario plus the caller's own.
    `exam=True` (case writer, judge) adds the trap definitions."""
    d = load(name)
    return {"DOMAIN": d.prompt + ("\n" + d.exam if exam else ""), **more}
