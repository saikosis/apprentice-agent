"""Gemini client, model IDs, and `structured(model, prompt_id, parts, schema)` (AGENTS.md)."""

import os

LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
FLASH_MODEL = os.getenv("FLASH_MODEL", "gemini-3.8-flash")
PRO_MODEL = os.getenv("PRO_MODEL", "gemini-3.1-pro-preview")
