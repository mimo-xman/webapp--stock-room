# Stock Room — Agent prompts

**Stock Room is platform-agnostic**: an AI agent turns a mission brief (Adobe Stock batch,
Etsy coloring book, Instagram event visuals, video scenes, ad creatives, anything) into
generated images and registers them as **Session → Images** in the Stock Room database.

Each mission type has its own ready-to-send prompt in [`prompts/`](prompts/):

| Prompt file | Mission | Specific variables |
|---|---|---|
| [`prompts/main.md`](prompts/main.md) | **Any mission** — the universal prompt. Explains how to use the two APIs (Stock Room + Zazo Image Studio) and the Session → Images data structure; you fill in `[MISSION BRIEF]` with whatever you want produced. | `[MISSION BRIEF]` |
| [`prompts/adobe-stock.md`](prompts/adobe-stock.md) | **Adobe Stock batch** — demand research, hard rules (no living beings, no faces/body parts), upload-ready metadata. | `[NUMBER OF PROMPTS TO CREATE]` |
| [`prompts/coloring-book-etsy.md`](prompts/coloring-book-etsy.md) | **Etsy coloring book** — children's line-art coloring pages + cover, Etsy rules researched live, print-ready. | `[BOOK THEME]`, `[NUMBER OF COLORING PAGES]` |

All three share the same six connection variables (the two API links + keys + backup repo
links) and the same file layout: a variables table, a ✂ **CUT HERE** line, and the prompt
below it.

## How to use a prompt

1. Open the prompt file for your mission (or use the webapp's **Agent prompts** page — it
   fills, validates and exports them for you).
2. Copy everything below the ✂ CUT line.
3. Replace every `[BRACKETED VARIABLE]` — including the mission-specific one.
4. Send the result as a single message to your AI agent.

The webapp page keeps the shared connection values in your browser (localStorage), so after
the first fill you only ever type the mission-specific variable.

## Adding a new prompt (later)

1. Copy the closest prompt in `prompts/` to a new `.md` file (keep the layout: variables
   table → ✂ CUT HERE → prompt).
2. Reuse the existing `[BRACKETED]` tokens where possible (shared values auto-fill).
3. Run `python3 scripts/gen-prompt-template.py` and commit both files, then register the
   prompt in `web/src/lib/prompts.ts` — it appears in the webapp switcher automatically.
