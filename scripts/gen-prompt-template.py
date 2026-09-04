#!/usr/bin/env python3
"""Regenerate web/src/lib/agent-prompt-template.ts from AGENT_PROMPT.md.

Takes everything below the ✂ CUT HERE line of AGENT_PROMPT.md and emits it as
the BUNDLED_AGENT_PROMPT_TEMPLATE string (JSON-escaped, ASCII-safe — matches
the style of the original generated file).

Run it from anywhere (paths are resolved from this script's location) after
every AGENT_PROMPT.md edit, then commit BOTH files so the bundled fallback
stays in sync:

    python3 scripts/gen-prompt-template.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "AGENT_PROMPT.md"
DST = ROOT / "web" / "src" / "lib" / "agent-prompt-template.ts"
CUT_MARKER = "CUT HERE"

HEADER = """/**
 * BUNDLED FALLBACK of the agent prompt template — GENERATED from
 * AGENT_PROMPT.md (everything below the ✂ CUT HERE line) by
 * scripts/gen-prompt-template.py (repo root).
 *
 * The /prompt page prefers the LIVE file on GitHub (raw.githubusercontent…)
 * and only falls back to this copy when GitHub is unreachable. If the live
 * fetch works, this copy is never used. Regenerate it after editing
 * AGENT_PROMPT.md so the fallback stays in sync:
 *
 *     python3 scripts/gen-prompt-template.py
 */
"""


def main() -> None:
    md = SRC.read_text(encoding="utf-8")
    lines = md.split("\n")
    cut = next((i for i, line in enumerate(lines) if CUT_MARKER in line), None)
    if cut is None:
        raise SystemExit("fatal: AGENT_PROMPT.md has no CUT HERE line")

    template = "\n".join(lines[cut + 1 :]).strip() + "\n"
    if len(template) <= 200:
        raise SystemExit("fatal: template below the cut line is suspiciously short")

    payload = json.dumps(template)  # ensure_ascii=True → \u2014 style escapes
    DST.write_text(
        HEADER + f"\nexport const BUNDLED_AGENT_PROMPT_TEMPLATE: string = {payload};\n",
        encoding="utf-8",
    )
    print(f"OK — {len(template)} chars → {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
