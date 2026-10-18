# 04. Judge code and private sandbox workspace

Status: done

Spec: `docs/Judge_Sandbox.md`

Blocked by: nothing

Tracer bullet for the sandbox: a non-expert Google account enters the judge code and gets its own empty workspace that
every existing screen works in.

**Do**
- `Ws` gains `"sandbox"`; `Session.workspace` too (contract + `make types`).
- `Store(ws="sandbox", uid=..., scenario=...)` → root `workspaces/sandbox-<uid>[-<scenario>]`; recordings use
  `store.root_name`.
- Auth: `role` = expert | judge | none (`sandboxes/{uid}` exists → judge). Replace `LiveStore` with a writer store
  resolved from the account: expert → live, judge → sandbox, none → 403. Reads: `?ws=sandbox` only for the caller's own
  sandbox.
- `POST /api/sandbox/join {code}` (compare with `SANDBOX_CODE` in constant time; unset or `SANDBOX_ENABLED=0` → 403),
  `GET /api/sandbox`. `/api/me` returns `role`.
- Live token works for sandbox sessions.
- Frontend: role `none` → "Enter the judge code" screen; role `judge` → app with ws=sandbox and a "Judge sandbox"
  header badge; expert unchanged.

**Done when**
- Tests: wrong/missing code refused; judge A can't read or write judge B's or the live workspace; expert unchanged;
  sandbox session uploads to `sandbox-<uid>/…`; frontend code screen test.
