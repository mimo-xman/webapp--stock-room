#!/usr/bin/env python3
"""Regenerate web/src/lib/prompt-templates/*.ts from prompts/*.md.

For every prompt file in prompts/, takes everything below the ✂ CUT HERE line
and emits it as a bundled template (JSON-escaped, ASCII-safe) under
web/src/lib/prompt-templates/<id>.ts — the offline fallback used by the
"Agent prompts" webapp page.

Run it from anywhere (paths are resolved from this script's location) after
every prompts/ edit, then commit BOTH sides so the bundled fallbacks stay in
sync:

    python3 scripts/gen-prompt-template.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "prompts"
DST_DIR = ROOT / "web" / "src" / "lib" / "prompt-templates"
CUT_MARKER = "CUT HERE"

HEADER = """/**
 * BUNDLED FALLBACK of the "{title}" prompt template — GENERATED from
 * prompts/{src} (everything below the ✂ CUT HERE line) by
 * scripts/gen-prompt-template.py (repo root).
 *
 * The "Agent prompts" page prefers the LIVE file on GitHub
 * (raw.githubusercontent…) and only falls back to this copy when GitHub is
 * unreachable. If the live fetch works, this copy is never used. Regenerate
 * it after editing prompts/{src} so the fallback stays in sync:
 *
 *     python3 scripts/gen-prompt-template.py
 */
"""


def main() -> None:
    DST_DIR.mkdir(parents=True, exist_ok=True)
    written = []

    for src in sorted(SRC_DIR.glob("*.md")):
        md = src.read_text(encoding="utf-8")
        lines = md.split("\n")
        cut = next((i for i, line in enumerate(lines) if CUT_MARKER in line), None)
        if cut is None:
            raise SystemExit(f"fatal: {src.name} has no CUT HERE line")

        template = "\n".join(lines[cut + 1 :]).strip() + "\n"
        if len(template) <= 200:
            raise SystemExit(f"fatal: {src.name}: template below the cut line is suspiciously short")

        title = lines[0].lstrip("# ").strip() if lines else src.stem
        payload = json.dumps(template)  # ensure_ascii=True → \u2014 style escapes
        dst = DST_DIR / f"{src.stem}.ts"
        dst.write_text(
            HEADER.format(title=title, src=src.name)
            + f"\nexport const BUNDLED_TEMPLATE_{src.stem.replace('-', '_').upper()}: string = {payload};\n",
            encoding="utf-8",
        )
        written.append((src.name, len(template), dst.relative_to(ROOT)))

    if not written:
        raise SystemExit("fatal: no prompts/*.md files found")

    for name, size, dst in written:
        print(f"OK — {name}: {size} chars → {dst}")


if __name__ == "__main__":
    main()
