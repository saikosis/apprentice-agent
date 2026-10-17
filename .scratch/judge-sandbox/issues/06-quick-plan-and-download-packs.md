# 06. Quick-plan items and download packs

Spec: `docs/Judge_Sandbox.md`

Blocked by: nothing

**Do**
- Each generator adds 6 quick-plan items (2 per rule, new ids: `INV-2101..2106`, `SUB-301..306`, `R-401..406`) with
  matching emails/rows, and a `quick_plan` entry in `sessions.json` (`kind: "quick"`).
- `make_synthetic` also writes the download packs into `backend/app/domains/<id>/files/`: `<workflow>.xlsx` (tabs as
  in the spec), `essays.zip` of `.docx` (essays only), `starter_emails.docx`. Use `openpyxl` / `python-docx` (dev
  dependencies only if generation stays offline; files are committed).
- Tests: quick-plan items hold their rule (like the existing planted-exception tests); xlsx tab names match each
  scenario's `sheet_tab`.

**Done when**
- Packs regenerate deterministically and open in Google Sheets/Docs (manual check, one per workflow).
