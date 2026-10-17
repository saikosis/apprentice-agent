# 10. Consent line, 14-day deletion

Spec: `docs/Judge_Sandbox.md`

Blocked by: `04-sandbox-workspace-and-code`, `08-sandbox-lifecycle`

**Do**
- Record page in a sandbox: consent text from the spec (exact wording) next to the checkbox.
- Sweep: on startup and on the first request of each IST day, delete sandboxes with `created_at` older than 14 days
  (reuse ticket 08's delete).
- Cloud_Setup: new step with the bucket lifecycle rule (`age: 14`, `matchesPrefix: ["sandbox-"]`) in Console, CLI and
  `cloud_setup.sh`.

- Bucket CORS `responseHeader` must also list `x-goog-content-length-range` (sandbox uploads send it; the
  signed URL enforces the 200 MB cap). Update Cloud_Setup steps 9 and 15 (Console, CLI, `cloud_setup.sh`).

**Done when**
- Tests: sweep deletes only expired sandboxes and runs once per day; consent text rendered.
