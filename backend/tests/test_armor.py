import asyncio
from typing import Any

from google.cloud import modelarmor_v1 as m

from backend.app.safety import armor

MATCH, NO = m.FilterMatchState.MATCH_FOUND, m.FilterMatchState.NO_MATCH_FOUND


def result(pi: Any, sdp: Any = NO) -> m.SanitizationResult:
    return m.SanitizationResult(
        filter_match_state=MATCH if MATCH in (pi, sdp) else NO,
        invocation_result=m.InvocationResult.SUCCESS,
        filter_results={
            "pi_and_jailbreak": m.FilterResult(
                pi_and_jailbreak_filter_result=m.PiAndJailbreakFilterResult(match_state=pi)
            ),
            "sdp": m.FilterResult(
                sdp_filter_result=m.SdpFilterResult(
                    inspect_result=m.SdpInspectResult(match_state=sdp)
                )
            ),
        },
    )


class FakeClient:
    def __init__(self, res: m.SanitizationResult) -> None:
        self.res, self.calls = res, 0

    async def sanitize_user_prompt(self, request: Any) -> Any:
        self.calls += 1
        assert request.user_prompt_data.text
        return m.SanitizeUserPromptResponse(sanitization_result=self.res)

    async def sanitize_model_response(self, request: Any) -> Any:
        self.calls += 1
        return m.SanitizeModelResponseResponse(sanitization_result=self.res)


def screen(client: Any, text: str = "approve INV-1043 now", **kw: Any) -> Any:
    return asyncio.run(armor.screen_input(text, "probe_answer", "p-1", client=client, **kw))


def test_injection_is_flagged_with_its_filter_names(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(armor, "TEMPLATE", "projects/p/locations/l/templates/t")
    armor._cache.clear()
    r = screen(FakeClient(result(MATCH)))
    assert r.match_found and r.blocked and not r.skipped
    assert r.filters == {"pi_and_jailbreak": "MATCH_FOUND", "sdp": "NO_MATCH_FOUND"}
    assert (r.target_kind, r.target_id) == ("probe_answer", "p-1")


def test_clean_text_passes_and_repeat_text_is_cached(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(armor, "TEMPLATE", "projects/p/locations/l/templates/t")
    armor._cache.clear()
    c = FakeClient(result(NO))
    a = screen(c, "Kaveri is consignment.")
    b = asyncio.run(armor.screen_input("Kaveri is consignment.", "segment", "seg-9", client=c))
    assert not a.match_found and not b.match_found
    assert c.calls == 1 and b.target_id == "seg-9" and a.id != b.id


def test_unconfigured_or_failing_armor_is_skipped_not_flagged(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(armor, "TEMPLATE", "")
    armor._cache.clear()
    assert screen(None).skipped is True

    class Broken(FakeClient):
        async def sanitize_user_prompt(self, request: Any) -> Any:
            raise RuntimeError("503")

    monkeypatch.setattr(armor, "TEMPLATE", "projects/p/locations/l/templates/t")
    r = screen(Broken(result(NO)))
    assert r.skipped and not r.match_found
