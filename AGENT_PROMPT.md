# Stock Room — Agent prompts

**Stock Room is multi-platform**: an AI agent turns a mission brief (stock batch for the
8 marketplaces, Etsy coloring book, Instagram event visuals, video scenes, ad creatives,
anything) into generated images and registers them in the Stock Room database —
**Session → Images (sold one by one, with per-platform upload metadata)** or
**Session → Etsy products (several images bundled behind one listing)**.

Each mission type has its own ready-to-send prompt in [`prompts/`](prompts/):

| Prompt file | Mission | Specific variables |
|---|---|---|
| [`prompts/main.md`](prompts/main.md) | **Any mission** — the universal prompt. Explains how to use the two APIs (Stock Room + Zazo Image Studio), the Images / Etsy products data structures and the per-platform metadata; embeds the GLOBAL CONTENT RULES; you fill in `[MISSION BRIEF]` with whatever you want produced (a brief asking for living beings is overridden by the rules). | `[MISSION BRIEF]` |
| [`prompts/stock-platforms.md`](prompts/stock-platforms.md) | **Stock batch — ALL marketplaces** (Adobe Stock, Shutterstock, Wirestock, iStock/Getty, Pond5, Depositphotos, 123RF, Dreamstime) — live rules + AI-policy research per platform, **saturation check on the marketplaces themselves**, per-image **differentiation profiles** (never the default depiction — the similar-content rejection killer), hard rules (no living beings, no faces/body parts), **per-platform upload metadata stored on every image** (title/description/categories/keywords in each platform's own format and caps). | `[NUMBER OF PROMPTS TO CREATE]` |
| [`prompts/coloring-book-etsy.md`](prompts/coloring-book-etsy.md) | **Etsy coloring book** — children's line-art coloring pages + cover + **its ANNOUNCEMENT images** (the Etsy listing photos that sell the book — a dedicated HARD RULE covers their quality; they are generated in **image-to-image mode from the REAL cover and pages as reference images**, so the listing shows exactly what the buyer receives), Etsy rules researched live, print-ready. Every image goes through the **STEP 4c visual quality check + regeneration loop** (design-defect checklist, corrected-prompt regeneration, max 3 attempts, then scene redesign — badly designed pages never reach the database silently). The agent researches current Etsy demand and **picks a NON-LIVING theme itself** (the owner's global content rules ban animals, people and characters; it picks vehicles, machines, buildings, toys, plants, patterns… and justifies with sources). Saves the book as ONE **Etsy product** (cover + pages + promo images with `role: "marketing"` + the full listing metadata: title ≤ 140, 13 tags, category, price). | `[NUMBER OF COLORING PAGES]` |

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

## The GLOBAL DISTINCTIVENESS RULES — every prompt, present and future

Adobe Stock hard-refuses content that "closely resembles content already available" and
same-series images without "noticeable differences in composition, color, expression, or
scenario" — the similar-content rejection. The definitive fix is a second canonical rule
set, applied with the exact same architecture as the content rules:

- **Every image clearly differentiated — twice over**: from what the platform already
  hosts AND from every other image of the same run (on at least two of the four axes
  moderators check: composition, color, mood, scenario).
- **Never the default depiction** — the generic, average look an image model produces by
  default is exactly what already floods the platform; every prompt must art-direct the
  subject away from it (named composition, named palette, deliberate lighting, concrete
  scenario).
- **Saturation checked before committing to a subject** — the agent searches the platform
  itself (stock.adobe.com / etsy.com) with the planned keywords and reads the result count
  + first page before spending quota.
- **Distinctiveness verified before saving** — a generic or lookalike image is rejected
  and regenerated, exactly like a content-rules violation.
- **Selective, not voluminous** — N images = N distinct concepts, never one concept
  rendered N times.

The canonical text lives in
[`prompts/_global-distinctiveness-rules.md`](prompts/_global-distinctiveness-rules.md)
(single source of truth). It is embedded verbatim in **every** prompt, the generator script
**refuses** to bundle a prompt without its marker (`CLEARLY DIFFERENTIATED`), and the
webapp's `renderTemplate()` appends the canonical block as a safety net — so future
prompts inherit the anti-similarity doctrine automatically.

## The multi-platform data model (what the agent writes)

- **`images_to_bay`** — one sellable image per record, sold individually on the 8
  marketplaces: `metadata.adobe_stock` (title, category, keywords) + `metadata.shutterstock`
  (description, categories, keywords) + `metadata.istock` / `metadata.wirestock` /
  `metadata.pond5` (title, description, keywords, price) / `metadata.depositphotos` /
  `metadata['123rf']` (description, keywords) / `metadata.dreamstime` (title, description,
  keywords), plus per-platform `used` flags. The API auto-derives the missing platforms
  from the Adobe block when a writer only provides it.
- **`etsy_products`** — one digital product per record (coloring book, invitations,
  wall-art set…): `images[]` (cover + pages + the ANNOUNCEMENT images with
  `role: "marketing"` — the listing photos that present the product to buyers; every
  product type gets them, each image with its own link, caption, role and generation
  prompt) + ONE shared `metadata` block in Etsy's listing format (title ≤ 140 chars,
  description, up to 13 tags ≤ 20 chars each, category path, price, optional `file_link`
  for the assembled PDF/ZIP) + `used_in_etsy` flag.

Legacy note: the API still accepts the old flat `title`/`category`/`keywords`/
`used_in_adobe_stock` fields (mapped onto `metadata.adobe_stock` / `used.adobe_stock`) so
older agent runs and forms keep working.

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
2. **Paste BOTH canonical rule blocks into the template** (below the cut line, before the
   HARD RULES): the GLOBAL CONTENT RULES from
   `prompts/_global-content-rules.md` (the owner's image ban) AND the GLOBAL
   DISTINCTIVENESS RULES from `prompts/_global-distinctiveness-rules.md` (the anti-similarity
   doctrine) — both apply to every prompt, and the build enforces both (see the sections
   above).
3. Reuse the existing `[BRACKETED]` tokens where possible (shared values auto-fill).
4. Run `python3 scripts/gen-prompt-template.py` and commit both files, then register the
   prompt in `web/src/lib/prompts.ts` — it appears in the webapp switcher automatically.
