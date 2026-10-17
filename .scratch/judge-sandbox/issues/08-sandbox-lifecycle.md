# 08. Sample copy on join, reset, delete

Spec: `docs/Judge_Sandbox.md`

Blocked by: `04-sandbox-workspace-and-code`, `07-sample-run-script`

**Do**
- On first `join`: copy each workflow's demo workspace into the judge's sandbox (reuse `export_demo.export` +
  `load_seed`).
- `POST /api/sandbox/reset {mode}`: delete all of the judge's sandbox docs and objects, then copy the sample
  (`sample`) or leave empty (`empty`). Usage counters are NOT reset.
- `DELETE /api/sandbox`: delete docs, objects and the redemption.
- Frontend: sandbox start page (usage, quick plan, downloads from ticket 06 via `GET /api/sandbox/files/...`, Reset
  to sample / Start empty / Delete my sandbox with confirm).

**Done when**
- Tests: join copies sample for all workflows; reset modes; delete removes everything; files endpoint judge-only.
