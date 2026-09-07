#!/usr/bin/env python3
"""Regenerate web/src/lib/prompt-templates/*.ts from prompts/*.md.

For every prompt file in prompts/, takes everything below the ✂ CUT HERE line
and emits it as a bundled template (JSON-escaped, ASCII-safe) under
web/src/lib/prompt-templates/<id>.ts — the offline fallback used by the
"Agent prompts" webapp page.

It also turns two canonical rule files into TS constants:

- prompts/_global-content-rules.md (the owner's absolute image ban: no living
  beings, no faces, no body parts) → GLOBAL_CONTENT_RULES
- prompts/_global-distinctiveness-rules.md (the anti-similarity doctrine:
  every image clearly differentiated from the platform's existing content AND
  from the rest of the batch — never the default depiction, saturation checked
  before committing, distinctiveness verified before saving) →
  GLOBAL_DISTINCTIVENESS_RULES

And it REFUSES to bundle any prompt that does not embed BOTH rule sets — the
markers "NO LIVING BEINGS" and "CLEARLY DIFFERENTIATED" must appear below the
cut line. This is what guarantees that every prompt, present and future, carries
the owner's global content rules AND the global distinctiveness rules (the
fix for Adobe Stock's similar-content rejection). (The webapp adds a second
safety net: it appends the canonical blocks to any rendered prompt that lost
them.)

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
RULES_SRC = SRC_DIR / "_global-content-rules.md"
RULES_MARKER = "NO LIVING BEINGS"
DISTINCT_SRC = SRC_DIR / "_global-distinctiveness-rules.md"
DISTINCT_MARKER = "CLEARLY DIFFERENTIATED"

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

RULES_HEADER = """/**
 * The owner's GLOBAL CONTENT RULES — GENERATED from
 * prompts/_global-content-rules.md by scripts/gen-prompt-template.py
 * (repo root). Single source of truth for the owner's absolute image ban
 * (no living beings, no faces, no body parts — even on objects).
 *
 * Every prompt template embeds this block (the script refuses to bundle a
 * prompt without it), and renderTemplate() appends it as a safety net to
 * any rendered prompt whose template somehow lost it. Regenerate after
 * editing the .md source:
 *
 *     python3 scripts/gen-prompt-template.py
 */
"""

DISTINCT_HEADER = """/**
 * The GLOBAL DISTINCTIVENESS RULES — GENERATED from
 * prompts/_global-distinctiveness-rules.md by scripts/gen-prompt-template.py
 * (repo root). Single source of truth for the anti-similarity doctrine that
 * fixes stock platforms' similar-content rejection (Adobe Stock refuses
 * content that "closely resembles content already available"): every image
 * clearly differentiated from the platform's existing content AND from the
 * rest of the batch — never the default depiction, saturation checked before
 * committing to a subject, distinctiveness verified before saving.
 *
 * Every prompt template embeds this block (the script refuses to bundle a
 * prompt without it), and renderTemplate() appends it as a safety net to
 * any rendered prompt whose template somehow lost it. Regenerate after
 * editing the .md source:
 *
 *     python3 scripts/gen-prompt-template.py
 */
"""


def write_ts(dst: Path, header: str, const_name: str, text: str) -> int:
    payload = json.dumps(text)  # ensure_ascii=True → \u2014 style escapes
    dst.write_text(
        header + f"\nexport const {const_name}: string = {payload};\n",
        encoding="utf-8",
    )
    return len(text)


def main() -> None:
    DST_DIR.mkdir(parents=True, exist_ok=True)

    # 1. the owner's global content rules → TS constant (safety-net source)
    if not RULES_SRC.is_file():
        raise SystemExit(f"fatal: {RULES_SRC.name} is missing — it holds the owner's global content rules")
    rules_text = RULES_SRC.read_text(encoding="utf-8").strip() + "\n"
    if RULES_MARKER not in rules_text:
        raise SystemExit(f"fatal: {RULES_SRC.name} lost its '{RULES_MARKER}' marker")
    size = write_ts(DST_DIR / "global-content-rules.ts", RULES_HEADER, "GLOBAL_CONTENT_RULES", rules_text)
    print(f"OK — {RULES_SRC.name}: {size} chars → web/src/lib/prompt-templates/global-content-rules.ts")

    # 1b. the global distinctiveness rules → TS constant (safety-net source)
    if not DISTINCT_SRC.is_file():
        raise SystemExit(
            f"fatal: {DISTINCT_SRC.name} is missing — it holds the anti-similarity doctrine "
            f"that fixes Adobe Stock's similar-content rejection"
        )
    distinct_text = DISTINCT_SRC.read_text(encoding="utf-8").strip() + "\n"
    if DISTINCT_MARKER not in distinct_text:
        raise SystemExit(f"fatal: {DISTINCT_SRC.name} lost its '{DISTINCT_MARKER}' marker")
    size = write_ts(
        DST_DIR / "global-distinctiveness-rules.ts",
        DISTINCT_HEADER,
        "GLOBAL_DISTINCTIVENESS_RULES",
        distinct_text,
    )
    print(f"OK — {DISTINCT_SRC.name}: {size} chars → web/src/lib/prompt-templates/global-distinctiveness-rules.ts")

    # 2. every prompt → bundled template, with the rules-validation gate
    written = []
    for src in sorted(SRC_DIR.glob("*.md")):
        if src.name.startswith("_"):
            continue  # partial files (_global-content-rules.md), not prompts
        md = src.read_text(encoding="utf-8")
        lines = md.split("\n")
        cut = next((i for i, line in enumerate(lines) if CUT_MARKER in line), None)
        if cut is None:
            raise SystemExit(f"fatal: {src.name} has no CUT HERE line")

        template = "\n".join(lines[cut + 1 :]).strip() + "\n"
        if len(template) <= 200:
            raise SystemExit(f"fatal: {src.name}: template below the cut line is suspiciously short")
        if RULES_MARKER not in template:
            raise SystemExit(
                f"fatal: {src.name}: the owner's GLOBAL CONTENT RULES are missing below the "
                f"cut line — paste the block from prompts/_global-content-rules.md "
                f"(marker '{RULES_MARKER}' not found). The owner's ban applies to EVERY "
                f"prompt, present and future."
            )
        if DISTINCT_MARKER not in template:
            raise SystemExit(
                f"fatal: {src.name}: the GLOBAL DISTINCTIVENESS RULES are missing below the "
                f"cut line — paste the block from prompts/_global-distinctiveness-rules.md "
                f"(marker '{DISTINCT_MARKER}' not found). Every image must be clearly "
                f"differentiated from the platform's existing content and from the rest of "
                f"the batch — similar-content rejection is a hard refusal on Adobe Stock and "
                f"every stock marketplace; the rules apply to EVERY prompt, present and future."
            )

        title = lines[0].lstrip("# ").strip() if lines else src.stem
        size = write_ts(
            DST_DIR / f"{src.stem}.ts",
            HEADER.format(title=title, src=src.name),
            f"BUNDLED_TEMPLATE_{src.stem.replace('-', '_').upper()}",
            template,
        )
        written.append((src.name, size))

    if not written:
        raise SystemExit("fatal: no prompts/*.md files found")

    for name, size in written:
        print(f"OK — {name}: {size} chars")


if __name__ == "__main__":
    main()
