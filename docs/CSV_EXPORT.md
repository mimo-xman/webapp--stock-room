# Multi-platform CSV export (webapp)

The webapp builds the **contributor metadata CSV** that each stock marketplace accepts to
fill titles, descriptions, categories and keywords for a whole upload batch in one
operation. You select assets → click **Download CSV** → a **platform picker dialog**
appears → clicking a platform downloads that platform's CSV in its own documented
format. Platforms without a public bulk-CSV format show **"coming soon"** (their
metadata is already stored — the export will appear as soon as the format is added).

## The platforms and their CSV formats

All formats are researched from each platform's official contributor documentation
(sources noted below). Rows are matched to uploaded files by filename — the builder
uses the basename of the asset URL (query string stripped), and renames duplicates
deterministically (`-2`, `-3`…) with a warning.

| Platform | CSV columns | Notes / limits |
|---|---|---|
| **Adobe Stock** | `Filename,Title,Keywords,Category` | Category = **numeric code 1–21**; Title ≤ 200; keywords ≤ 49; CSV ≤ 20 000 rows. Imported from the Contributor portal. Source: helpx.adobe.com "CSV requirements". |
| **Shutterstock** | `Filename,Description,Keywords,Categories` | Description ≤ 200; keywords 7–50; **1–2 categories** from the 26-category list (joined with a comma). Optional `Illustration` / `Mature Content` / `Editorial` columns are omitted (No/No/No defaults). Uploaded via the **Submit page CSV button** — never with the files. Source: submit.shutterstock.com help center. |
| **Dreamstime** | `Filename,Title,Description,Keywords` | Title 5–250; keywords 7–50. Imported on the unfinished-uploads screen. Source: dreamstime.com "Create and upload CSV files". |
| **123RF** | `"oldfilename","123rf_filename","description","keywords","country"` | **Every field double-quoted**; description ≤ 180; keywords ≥ 7; country = 2-letter code (left blank). File ≤ 2 MB. Source: 123RF contributor docs + tested guide. |
| **Pond5** | `originalfilename,title,description,keywords,price` | Title ≤ 80 **plain ASCII, no quotes/special characters** anywhere in the row; keywords ≥ 5; price in USD. Source: Pond5 contributor portal CSV template. |
| **iStock / Getty** | — | No public bulk-CSV format → **coming soon**. |
| **Wirestock** | — | No public bulk-CSV format → **coming soon**. |
| **Depositphotos** | — | No public bulk-CSV format → **coming soon**. |

Quoting rules: Adobe / Shutterstock / Dreamstime follow RFC 4180 (fields containing
commas/quotes/newlines are quoted, inner quotes doubled); 123RF quotes every field;
Pond5 strips everything non-ASCII and all quote characters. Line endings are `\r\n`.

### The 21 Adobe categories and their numeric codes

| # | Category | # | Category | # | Category |
|---|---|---|---|---|---|
| 1 | Animals | 8 | Graphic Resources | 15 | Culture and Religion |
| 2 | Buildings and Architecture | 9 | Hobbies and Leisure | 16 | Science |
| 3 | Business | 10 | Industry | 17 | Social Issues |
| 4 | Drinks | 11 | Landscapes | 18 | Sports |
| 5 | The Environment | 12 | Lifestyle | 19 | Technology |
| 6 | States of Mind | 13 | People | 20 | Transport |
| 7 | Food | 14 | Plants and Flowers | 21 | Travel |

### The 26 Shutterstock categories (exact values)

Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion,
Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and drink,
Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects,
Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology,
Transportation, Vintage.

Both lists are mirrored in `api/src/constants.js` (`STOCK_PLATFORMS`) and
`web/src/lib/constants.ts` — keep them in sync if a platform changes its taxonomy.

## Where the metadata comes from

Every sellable image stores its **per-platform upload metadata** in the database
(`metadata.<platform>`): Adobe title/category/keywords, Shutterstock
description/categories/keywords, iStock/Wirestock/Pond5/Dreamstime
title/description/keywords (+Pond5 price), Depositphotos/123RF description/keywords.
The CSV builder reads each platform's own block; when a block is missing (legacy
rows), it falls back to the Adobe block and warns. Edit per-platform metadata from the
image detail dialog (one collapsible card per platform) or the edit form (platform
tabs).

## Using the feature (webapp)

On `/images` and `/sessions/:id`:

1. **Select assets** — hover an image card and click the checkbox (top-left)
   to select the **original**. Open the image dialog to also select any of its
   **upscaled variants** (each upscale row has a `CSV` toggle, and the footer
   has one for the original). You can freely mix originals and upscales.
   The **Select all / Deselect all** bar above the grid applies whole
   categories (`origin images` / `upscale images (x2)` / `upscale images (x4)`,
   none checked by default) to the current page in one click — see
   README §7.
2. **Pagination-proof selection** — changing pages, filters or sorting does
   **not** clear the selection: a floating bar at the bottom shows
   `N selected` at all times, with **two** consumers: the CSV export below and
   the bulk **Mark N as used** stamp (`POST /api/images/bulk-used`).
3. **Download CSV** — the button on the floating bar opens the **platform picker
   dialog**: every marketplace is listed with its status (`CSV ready` /
   `coming soon`) and its AI-content policy badge. Clicking a ready platform builds
   the file (client-side, no API call) and downloads it as
   `<platform>-upload-YYYY-MM-DD.csv`. A toast confirms the row count and
   surfaces any warnings (keyword minimums, truncations, filename collisions).
4. **Upload to the platform** — upload the selected image files first (each
   variant downloads with a proper filename from the detail dialog), then import
   the CSV where the platform expects it (see the table above — e.g. the Submit
   page CSV button on Shutterstock, never with the files).

### Safeguards built into the CSV builders

- **Duplicate filenames** are impossible in one CSV — every platform matches rows by
  filename, so a collision (two assets whose URLs share a basename) is renamed
  `<name>-2.<ext>` and reported in the toast.
- **Keyword caps and minimums** — over-cap lists are truncated with a warning;
  below-minimum lists (Shutterstock 7, Dreamstime 7, 123RF 7, Depositphotos 8,
  Pond5 5, Wirestock 5) warn so you fix the metadata before upload.
- **Per-platform text rules** — Pond5 rows are plain ASCII with no quotes;
  123RF rows are fully quoted; 123RF descriptions are clipped to 180 chars.
- CSV quoting follows each platform's rule (see above); line endings are `\r\n`.

## Implementation map

| File | Role |
|---|---|
| `web/src/lib/csv.ts` | Pure builders: `buildAdobeStockCsv`, `buildShutterstockCsv`, `buildDreamstimeCsv`, `build123RfCsv`, `buildPond5Csv` + `buildPlatformCsv` dispatcher + download |
| `web/src/components/app/CsvPlatformDialog.tsx` | The platform picker dialog (status chips, AI-policy badges, coming-soon toast) |
| `web/src/hooks/use-csv-selection.ts` | Selection state (`imageId:variantId` keys) living in the page component — survives pagination; `bulkApply` powers the page-scoped Select all / Deselect all |
| `web/src/components/app/SelectionBar.tsx` | Floating bottom bar (count / Clear / Download CSV / Mark N as used) |
| `web/src/components/app/BulkSelectPanel.tsx` | Select all / Deselect all bar + category checkboxes (origin / ×2 / ×4, page-scoped) |
| `web/src/components/app/ImageCard.tsx` | Original-variant checkbox on each card |
| `web/src/components/app/ImageDetailDialog.tsx` | Per-platform metadata cards + `CSV` toggle per upscale row + original toggle in the footer |
| `web/src/app/images/page.tsx`, `web/src/app/sessions/[id]/page.tsx` | Wiring + dialog open handlers |

The CSV is built **client-side** from the selected documents' snapshot — no
new API endpoint is needed, and downloads work offline from the list cache.
