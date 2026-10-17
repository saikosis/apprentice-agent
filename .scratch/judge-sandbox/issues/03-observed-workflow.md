# 03. Observed workflow on the Patterns page

Spec: `docs/Judge_Sandbox.md`

Blocked by: `01-pattern-rule-twice`

On every pattern refresh, write the expert's actual procedure as numbered steps, each "matches SOP §x" or "not in the
SOP". Display only.

**Do**
- Contract: `ObservedWorkflow {steps: [{n, text, sop_rule, in_sop, session_ids}], built_at, prompt_version}`.
- `prompts/observed_workflow.md` (input: all training sessions' segments); built in `variants.discover`, stored at
  `observed_workflow/current`. Runs even when no variant qualifies.
- `GET /api/observed-workflow`; demo bundle carries it.
- UI: Patterns (Discovery) page shows it always; main content when there are no patterns.
- Leakage test: graph builder, scenarios and arms inputs never contain the observed workflow.

**Done when**
- Tests above green; one-session dry run shows a sensible procedure.
