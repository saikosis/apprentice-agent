# 12. Docs, deploy settings, judge guide

Spec: `docs/Judge_Sandbox.md`

Blocked by: `05-limits-and-off-switch`, `08-sandbox-lifecycle`, `10-retention-and-consent`, `11-admin-page`

**Do**
- `scripts/deploy.sh`: pass `SANDBOX_CODE` (required) and `SANDBOX_ENABLED` (default 1).
- `docs/Judge_Guide.md`: what judges do in 10 minutes (sign in, code, quick plan, record, answer, patterns, graph,
  exam). Text for the submission notes.
- AGENTS.md / SPEC / TASKS pointers; Cloud_Setup step from ticket 10 referenced.

**Done when**
- Deployed check from the spec's Verification section passes with a second Google account.
