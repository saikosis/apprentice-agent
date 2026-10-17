# 09. Sandbox exam: 6 generated cases

Status: done

Spec: `docs/Judge_Sandbox.md`

Blocked by: `04-sandbox-workspace-and-code`

**Do**
- In a sandbox, `POST /exam/generate` ignores held-out ids and asks for 6 generated cases covering each rule and each
  trap (existing trap retry applies). Frontend hides the held-out picker in sandboxes and explains "Apprentice writes 6
  practice cases from your graph; label them as you would decide."

**Done when**
- Test: sandbox generate sends no held-out sessions and N=6; live unchanged.
