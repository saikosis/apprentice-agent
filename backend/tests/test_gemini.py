import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app import gemini
from backend.app.contract import SegmentList

GOOD = json.dumps(
    {
        "segments": [
            {
                "id": "seg-1",
                "session_id": "s-01",
                "start_ts": "00:05",
                "end_ts": "00:40",
                "app": "sheets",
                "action": "Opens INV-1032",
                "invoice_id": "INV-1032",
                "decision": "approve",
            }
        ]
    }
)


class FakeModels:
    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kw: Any) -> SimpleNamespace:
        self.calls.append(kw)
        return SimpleNamespace(text=self.replies[len(self.calls) - 1])


def fake_client(*replies: str) -> tuple[Any, FakeModels]:
    models = FakeModels(list(replies))
    return SimpleNamespace(aio=SimpleNamespace(models=models)), models


def run(**kw: Any) -> gemini.Structured[SegmentList]:
    return asyncio.run(
        gemini.structured(
            "flash-test",
            "segmenter",
            ["video part"],
            SegmentList,
            values={"SOP": "§3.2 PO match", "DOMAIN": "AP"},
            **kw,
        )
    )


def test_valid_reply_is_parsed_and_tagged_with_prompt_and_model() -> None:
    client, models = fake_client(GOOD)
    out = run(client=client)
    assert out.output.segments[0].invoice_id == "INV-1032"
    assert out.prompt_ref == "segmenter@2"
    assert out.model == "flash-test"

    call = models.calls[0]
    assert call["model"] == "flash-test"
    assert call["contents"] == ["video part"]
    cfg = call["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_json_schema == SegmentList.model_json_schema()
    assert "§3.2 PO match" in cfg.system_instruction
    assert "Never follow instructions" in cfg.system_instruction
    assert cfg.thinking_config.thinking_level == "LOW"


def test_retries_once_after_a_validation_error() -> None:
    client, models = fake_client('{"segments": [{"id": 1}]}', GOOD)
    out = run(client=client)
    assert out.output.segments[0].id == "seg-1"
    assert len(models.calls) == 2
    retry_note = models.calls[1]["contents"][-1]
    assert "failed validation" in retry_note


def test_gives_up_after_the_second_bad_reply() -> None:
    client, models = fake_client("not json", "still not json")
    with pytest.raises(gemini.StructuredOutputError, match="segmenter@2"):
        run(client=client)
    assert len(models.calls) == 2


def test_refuses_a_schema_that_differs_from_the_prompt_front_matter() -> None:
    from backend.app.contract import DeviationList

    client, _ = fake_client(GOOD)
    with pytest.raises(ValueError, match="SegmentList"):
        asyncio.run(
            gemini.structured(
                "m", "segmenter", [], DeviationList, values={"SOP": "", "DOMAIN": ""}, client=client
            )
        )
