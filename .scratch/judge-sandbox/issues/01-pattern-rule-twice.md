# 01. Patterns from repeats, not from 3 sessions

Spec: `docs/Judge_Sandbox.md`

Blocked by: nothing

Pattern discovery runs after any processed training session; a pattern is the same departure seen at least twice, in
any number of sessions. Applies to every workspace.

**Do**
- `backend/app/pipeline/variants.py`: drop `MIN_SESSIONS = 3`; run when ≥1 processed training session exists. Keep
  only variants whose `frequency >= 2` (enforced in code, not just the prompt).
- `prompts/variants.md`: "at least 2 times, in one or more sessions"; bump version.

**Done when**
- Test: one session with the same rule broken twice → one variant; one session with each rule broken once → none.
- Existing 8-session behaviour unchanged (tests green).
