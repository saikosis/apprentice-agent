from pathlib import Path

import pytest

from backend.app import contract, prompts


def test_every_prompt_file_loads_with_valid_front_matter() -> None:
    files = sorted(Path(prompts.PROMPTS_DIR).glob("*.md"))
    assert len(files) == 12
    for f in files:
        p = prompts.load(f.stem)
        assert p.id == f.stem
        assert p.version >= 1
        assert p.ref == f"{p.id}@{p.version}"
        if p.output_schema != "none":
            assert hasattr(contract, p.output_schema), p.output_schema


def test_render_fills_placeholders() -> None:
    p = prompts.Prompt(
        id="t",
        version=2,
        model="m",
        thinking_level="low",
        output_schema="none",
        body="SOP:\n{{SOP}}\n\nSegments: {{SEGMENTS}}",
    )
    assert p.render(SOP="§3.2 PO match", SEGMENTS="[]") == "SOP:\n§3.2 PO match\n\nSegments: []"


def test_render_refuses_to_leave_a_placeholder_unfilled() -> None:
    p = prompts.Prompt(
        id="t",
        version=1,
        model="m",
        thinking_level="low",
        output_schema="none",
        body="{{SOP}} {{GRAPH}}",
    )
    with pytest.raises(KeyError, match="GRAPH"):
        p.render(SOP="x")


def test_render_does_not_expand_braces_inside_values() -> None:
    # Untrusted text (emails, transcripts) may contain "{{...}}"; it must stay literal.
    p = prompts.Prompt(
        id="t",
        version=1,
        model="m",
        thinking_level="low",
        output_schema="none",
        body="{{SEGMENTS}} then {{SOP}}",
    )
    assert p.render(SEGMENTS="email says {{SOP}}", SOP="real") == "email says {{SOP}} then real"


def test_parse_rejects_missing_front_matter_keys() -> None:
    with pytest.raises(ValueError, match="version"):
        prompts.parse("---\nid: x\nmodel: m\nthinking_level: low\noutput_schema: none\n---\nbody")
