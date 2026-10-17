# 07. Sample run per workflow (text steps on real Gemini)

Spec: `docs/Judge_Sandbox.md`

Blocked by: `01-pattern-rule-twice`, `02-session-summary`, `03-observed-workflow`, `06-quick-plan-and-download-packs`

**Do**
- `scripts/sample_run.py --scenario X [--into demo]`: from the quick plan, write segments as the expert would act
  (canned, like the dry run), then real deviations → questions → canned expert answers per rule → patterns + observed
  workflow → graph → 6 generated exam cases with canned labels → exam (1 run per agent). Sessions have no recording.
- UI: hide clip buttons when a session has no `gcs_uri`.
- Run it for all three workflows into their demo workspaces (needs GCP credentials; document the command).

**Done when**
- Each workflow's `/demo` shows a full run; the dry run passes the spec check (questions, ≥1 pattern per rule, graph,
  exam report).
