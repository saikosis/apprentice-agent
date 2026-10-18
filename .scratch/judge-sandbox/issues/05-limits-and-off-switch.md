# 05. Per-judge and global limits, off switch, 5:00 cap

Status: done

Spec: `docs/Judge_Sandbox.md`

Blocked by: `04-sandbox-workspace-and-code`

**Do**
- Counters in `sandboxes/{uid}` (recordings, graph_builds, exam_runs, case_generations; limit 5 each) and
  `sandbox_usage/{IST date}` (global, limit 100). Increment atomically before the work starts; refuse with
  `429 {code: "limit"}` and a plain message.
- Count at: session create, `POST /graph/build`, `POST /exam/run`, `POST /exam/generate` (sandbox only).
- `finalize`: reject sandbox `duration_s > 330`.
- `SANDBOX_ENABLED=0` → every sandbox write 403 "The judge sandbox is closed."
- Frontend: recorder auto-stops at 5:00 in sandbox; start page shows usage; limit errors shown verbatim.

**Done when**
- Tests: 6th recording refused; 101st global action refused; expert never limited; off switch; auto-stop test.
