# 02. Session summary on every session

Spec: `docs/Judge_Sandbox.md`

Blocked by: nothing

After processing, each session gets a 3–5 sentence summary plus the ordered steps per work item.

**Do**
- Contract: `SessionSummary {session_id, summary, items: [{invoice_id, steps}], prompt_version, moderation_id}`;
  `make types`.
- `prompts/summary.md` ({{DOMAIN}}, {{SOP}}; input = the session's segments), via `gemini.structured`.
- `pipeline/segment.process_session`: after deviations, build + store `sessions/{id}/summary/current`; screen the text
  with `armor` (flagged → stored with moderation, shown with the "kept out" tag). A failure here must not fail the
  session.
- `GET /api/sessions/{id}/summary` (404 when none); demo bundle carries summaries.
- UI: summary card at the top of `SessionDetail`.
- `test_prompts.py` file count 10 → 11 (12 after ticket 03).

**Done when**
- Tests: process_session stores a summary (FakeLLM); armor-flagged summary is marked; endpoint shape; view renders it.
