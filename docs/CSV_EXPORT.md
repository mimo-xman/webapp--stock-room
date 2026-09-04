# Adobe Stock CSV export (webapp)

The webapp builds the **contributor metadata CSV** that Adobe Stock accepts to
fill titles, keywords and categories for a whole upload batch in one operation.
This document explains the feature and the exact format it produces.

## How Adobe Stock's CSV upload works

1. You upload a batch of images (files) to the Adobe Stock contributor portal.
2. You then upload **one CSV file** whose rows describe those images. Adobe
   matches each row to an uploaded file by its **Filename** column and applies
   the metadata automatically.

Column contract (names must match exactly, in English):

| Column | Content | Our source |
|---|---|---|
| `Filename` | Full name of the uploaded asset incl. extension | basename of the asset URL (`.../<image-name>.<ext>`, query string stripped) |
| `Title` | Short description (≤ 200 chars) | `image.title` (already validated ≤ 200 by the API) |
| `Keywords` | Comma-separated, max **49**, relevance-ordered | `image.keywords` (truncated to 49 with a visible warning if needed) |
| `Category` | **Numeric code** 1–21 (Adobe's list) | index of `image.category` in the 21-category list + 1 |

Adobe's limits: CSV ≤ 20 000 rows. All values are optional for Adobe — except
`Filename`. We do not emit a `Releases` column (the pipeline generates no
living beings, so no model/property releases exist).

### The 21 categories and their numeric codes

| # | Category | # | Category | # | Category |
|---|---|---|---|---|---|
| 1 | Animals | 8 | Graphic Resources | 15 | Culture and Religion |
| 2 | Buildings and Architecture | 9 | Hobbies and Leisure | 16 | Science |
| 3 | Business | 10 | Industry | 17 | Social Issues |
| 4 | Drinks | 11 | Landscapes | 18 | Sports |
| 5 | The Environment | 12 | Lifestyle | 19 | Technology |
| 6 | States of Mind | 13 | People | 20 | Transport |
| 7 | Food | 14 | Plants and Flowers | 21 | Travel |

The order is identical to the API's `ADOBE_CATEGORIES` constant
(`api/src/constants.js`) and the webapp's `CATEGORIES` (`web/src/lib/constants.ts`)
— keep the three lists in sync if Adobe ever changes its taxonomy.

## Using the feature (webapp)

On `/images` and `/sessions/:id`:

1. **Select assets** — hover an image card and click the checkbox (top-left)
   to select the **original**. Open the image dialog to also select any of its
   **upscaled variants** (each upscale row has a `CSV` toggle, and the footer
   has one for the original). You can freely mix originals and upscales.
2. **Pagination-proof selection** — changing pages, filters or sorting does
   **not** clear the selection: a floating bar at the bottom shows
   `N selected for Adobe Stock CSV` at all times.
3. **Download CSV** — the button on the floating bar generates the file
   (client-side, no API call) and downloads it as
   `adobe-stock-upload-YYYY-MM-DD.csv`. A toast confirms the row count and
   surfaces any warnings.
4. **Upload to Adobe Stock** — upload the selected image files to the
   contributor portal (each variant downloads with a proper filename from the
   detail dialog), then upload the CSV. Metadata is applied automatically.

### Safeguards built into the CSV builder

- **Duplicate filenames** are impossible in one CSV — Adobe matches rows by
  filename, so a collision (two assets whose URLs share a basename) is renamed
  `<name>-2.<ext>` and reported in the toast.
- **Keywords > 49** are truncated to 49 (Adobe's cap) with a warning.
- **Unknown category** (only possible for legacy rows — the API validates the
  enum) leaves the number empty and warns: fix the CSV before upload.
- CSV quoting follows RFC 4180 (fields containing commas/quotes/newlines are
  quoted and inner quotes doubled); line endings are `\r\n`.

## Implementation map

| File | Role |
|---|---|
| `web/src/lib/csv.ts` | Pure builder: category map, filename extraction, CSV escaping, warnings, download |
| `web/src/hooks/use-csv-selection.ts` | Selection state (`imageId:variantId` keys) living in the page component — survives pagination |
| `web/src/components/app/SelectionBar.tsx` | Floating bottom bar (count / Clear / Download CSV) |
| `web/src/components/app/ImageCard.tsx` | Original-variant checkbox on each card |
| `web/src/components/app/ImageDetailDialog.tsx` | `CSV` toggle per upscale row + original toggle in the footer |
| `web/src/app/images/page.tsx`, `web/src/app/sessions/[id]/page.tsx` | Wiring + download handler |

The CSV is built **client-side** from the selected documents' snapshot — no
new API endpoint is needed, and downloads work offline from the list cache.
