# 11. Admin page: sandboxes and read-only view

Status: done

Spec: `docs/Judge_Sandbox.md`

Blocked by: `04-sandbox-workspace-and-code`, `05-limits-and-off-switch`

**Do**
- `GET /api/admin/sandboxes` (`ADMIN_UIDS` only): judge email, created, usage, global today.
- Admin reads: every read route accepts `?ws=sandbox&uid=<uid>` for admins (read-only; writes still resolve from the
  caller).
- Frontend: `#/admin` (visible to admins), list + "View" that switches the app into read-only view of that sandbox.

**Done when**
- Tests: non-admin 403; admin can read a judge's sessions and graph but not write.
