"""Load /prompts/*.md (front-matter + body) and fill {{PLACEHOLDER}}s."""

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_KEYS = ("id", "version", "model", "thinking_level", "output_schema")
_PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


@dataclass(frozen=True)
class Prompt:
    id: str
    version: int
    model: str
    thinking_level: str  # low | medium | high | none
    output_schema: str  # contract class name, or "none"
    body: str

    @property
    def ref(self) -> str:
        """Recorded on every output as `prompt_id@version`."""
        return f"{self.id}@{self.version}"

    def render(self, **values: str) -> str:
        """Fill every {{KEY}} in one pass, so braces inside values stay literal."""
        missing = sorted(set(_PLACEHOLDER.findall(self.body)) - values.keys())
        if missing:
            raise KeyError(f"{self.ref}: unfilled placeholders {missing}")
        return _PLACEHOLDER.sub(lambda m: values[m.group(1)], self.body)


def parse(text: str) -> Prompt:
    head, sep, body = text.removeprefix("---\n").partition("\n---\n")
    if not text.startswith("---\n") or not sep:
        raise ValueError("prompt file needs a --- front-matter block")
    meta = {
        k.strip(): v.strip() for k, _, v in (line.partition(":") for line in head.splitlines()) if k
    }
    missing = [k for k in _KEYS if k not in meta]
    if missing:
        raise ValueError(f"front-matter missing {missing}")
    return Prompt(
        id=meta["id"],
        version=int(meta["version"]),
        model=meta["model"],
        thinking_level=meta["thinking_level"],
        output_schema=meta["output_schema"],
        body=body.strip() + "\n",
    )


@lru_cache
def load(prompt_id: str) -> Prompt:
    p = parse((PROMPTS_DIR / f"{prompt_id}.md").read_text(encoding="utf-8").replace("\r\n", "\n"))
    if p.id != prompt_id:
        raise ValueError(f"{prompt_id}.md declares id {p.id!r}")
    return p
