# Stock Room — Agent prompts

**Stock Room is platform-agnostic**: an AI agent turns a mission brief (Adobe Stock batch,
Etsy coloring book, Instagram event visuals, video scenes, ad creatives, anything) into
generated images and registers them as **Session → Images** in the Stock Room database.

Each mission type has its own ready-to-send prompt in [`prompts/`](prompts/):

| Prompt file | Mission | Specific variables |
|---|---|---|
| [`prompts/main.md`](prompts/main.md) | **Any mission** — the universal prompt. Explains how to use the two APIs (Stock Room + Zazo Image Studio) and the Session → Images data structure; embeds the GLOBAL CONTENT RULES; you fill in `[MISSION BRIEF]` with whatever you want produced (a brief asking for living beings is overridden by the rules). | `[MISSION BRIEF]` |
| [`prompts/adobe-stock.md`](prompts/adobe-stock.md) | **Adobe Stock batch** — demand research, hard rules (no living beings, no faces/body parts), upload-ready metadata. | `[NUMBER OF PROMPTS TO CREATE]` |
| [`prompts/coloring-book-etsy.md`](prompts/coloring-book-etsy.md) | **Etsy coloring book** — children's line-art coloring pages + cover, Etsy rules researched live, print-ready. The agent researches current Etsy demand and **picks a NON-LIVING theme itself** (the owner's global content rules ban animals, people and characters; it picks vehicles, machines, buildings, toys, plants, patterns… and justifies with sources). | `[NUMBER OF COLORING PAGES]` |

All three share the same six connection variables (the two API links + keys + backup repo
links) and the same file layout: a variables table, a ✂ **CUT HERE** line, and the prompt
below it.

## The owner's global content rules — every prompt, present and future

The owner has **personal life rules for image generation**, and they apply to every mission,
every platform, every image — with no exception:

- **NO living beings** — no humans, no animals (real, fictional, cartoon, silhouette,
  toy, statue…). Plants, flowers and trees are allowed; food, objects, vehicles, buildings,
  textures and patterns are the go-to subjects.
- **NO faces** — nothing may have or evoke a face (eyes, ears, mouth, nose…), including on
  objects: anthropomorphic designs, jack-o'-lanterns, statues, dolls, masks, pareidolia.
- **NO body parts** — nothing may have or evoke hands, feet, arms, legs, fingers…, not
  even isolated or on objects.

The canonical text lives in [`prompts/_global-content-rules.md`](prompts/_global-content-rules.md)
(single source of truth). It is embedded verbatim in **every** prompt — the agent must apply
it during its internet research (a living-beings theme is disqualified, however well it
sells), in every generation prompt (mandatory negatives), and at the visual check (a
violating image is rejected, never saved).

Two mechanisms keep it that way for **future** prompts:

1. `scripts/gen-prompt-template.py` **refuses** to bundle a prompt whose template does not
   contain the rules marker (`NO LIVING BEINGS`) — the build fails loudly.
2. The webapp's `renderTemplate()` appends the canonical block to any rendered prompt whose
   template somehow lost it — the rules always reach the agent.

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
2. **Paste the GLOBAL CONTENT RULES block from `prompts/_global-content-rules.md`
   verbatim into the template** (below the cut line, before the HARD RULES) — the owner's
   image ban applies to every prompt, and the build enforces it (see the section above).
3. Reuse the existing `[BRACKETED]` tokens where possible (shared values auto-fill).
4. Run `python3 scripts/gen-prompt-template.py` and commit both files, then register the
   prompt in `web/src/lib/prompts.ts` — it appears in the webapp switcher automatically.
