from pathlib import Path
from typing import get_args

from backend.app import domains, prompts
from backend.app.contract import Decision, Scenario


def test_every_scenario_has_a_domain_pack() -> None:
    for name in get_args(Scenario):
        d = domains.load(name)
        assert d.info.id == name
        assert d.prompt.strip()
        assert set(d.info.decision_labels) == set(get_args(Decision))
        assert d.info.traps and d.info.sheet_tab and d.info.id_column
        assert isinstance(d.reference, list)


def test_every_prompt_mentions_the_domain_and_renders_for_every_scenario() -> None:
    for f in sorted(Path(prompts.PROMPTS_DIR).glob("*.md")):
        p = prompts.load(f.stem)
        assert "{{DOMAIN}}" in p.body, f.stem
        for name in get_args(Scenario):
            text = p.render(**domains.values(name, SOP="§1 sop", GRAPH="{}", N="3"))
            assert domains.load(name).prompt.strip() in text


def test_ap_wording_lives_in_the_ap_pack_not_in_the_prompts() -> None:
    for f in sorted(Path(prompts.PROMPTS_DIR).glob("*.md")):
        body = prompts.load(f.stem).body.lower()
        assert "accounts-payable" not in body and "accounts payable" not in body, f.stem
    assert "accounts payable" in domains.load("ap").prompt.lower()


def test_trap_names_reach_only_the_case_writer_and_the_judge() -> None:
    for name in get_args(Scenario):
        d = domains.load(name)
        for trap in d.info.traps:
            assert trap not in d.prompt, (name, trap)  # graph builder and agents see only d.prompt
            assert trap in d.exam, (name, trap)
            assert trap not in domains.values(name)["DOMAIN"]
            assert trap in domains.values(name, exam=True)["DOMAIN"]
