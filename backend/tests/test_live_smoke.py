"""Real Gemini calls. Opt in: RUN_LIVE_TESTS=1 uv run --env-file .env pytest -q backend/tests/test_live_smoke.py"""

import asyncio
import os
from datetime import UTC, datetime

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_LIVE_TESTS") != "1", reason="set RUN_LIVE_TESTS=1 (uses the Gemini key)"
)


def test_structured_flash_call() -> None:
    from backend.app import domains, gemini
    from backend.app.contract import AgentOutput
    from scripts.make_synthetic import build_sop

    case = {
        "item": {
            "invoice_id": "INV-9001",
            "vendor_name": "Sahyadri Office Supplies",
            "amount_inr": "12000",
            "po_number": "PO-9001",
            "grn_number": "GRN-9001",
        },
        "reference_row": {"type": "standard"},
    }
    out = asyncio.run(
        gemini.structured(
            gemini.FLASH_MODEL,
            "arm_sop",
            [gemini.data("Case", case)],
            AgentOutput,
            values=domains.values("ap", SOP=build_sop().full_text),
        )
    )
    assert (
        out.output.decision in ("approve", "reject", "hold", "escalate")
        and out.prompt_ref == "arm_sop@2"
    )


def test_ephemeral_token_opens_a_live_session() -> None:
    from google import genai

    from backend.app import gemini
    from backend.app.routers import live
    from scripts.make_synthetic import build_sop

    async def go() -> int:
        token = await live._client().aio.auth_tokens.create(
            config=live.token_config(build_sop(), None, datetime.now(UTC))
        )
        browser = genai.Client(api_key=token.name, http_options={"api_version": "v1alpha"})
        got = 0
        async with browser.aio.live.connect(model=gemini.LIVE_MODEL) as session:
            await session.send_client_content(
                turns={"role": "user", "parts": [{"text": "Say: ready."}]}
            )
            async for msg in session.receive():
                got += 1
                if msg.server_content and msg.server_content.turn_complete:
                    break
        return got

    assert asyncio.run(asyncio.wait_for(go(), 60)) > 0
