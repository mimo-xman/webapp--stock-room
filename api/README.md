# Stock Room API — asset database

Node.js + Express + Mongoose API that stores generation **Sessions** and **Images**
(with upload metadata — Adobe Stock today, any platform tomorrow) for the *Stock Room*
pipeline. Stock Room is mission-agnostic: an AI agent creates one session per mission
(Adobe Stock batch, Etsy coloring book, Instagram event visuals…) and registers every
generated image inside it.

## Run

```bash
npm install
cp .env.example .env          # then edit MONGODB_URI / API_KEY / APP_PASSWORD
npm start                     # production
npm run dev                   # dev with in-memory MongoDB (no Atlas needed)
npm test                      # 90-assertion E2E suite (in-memory MongoDB)
node scripts/seed-demo.cjs    # demo data (2 sessions, 16 images)
```

Dev credentials when using `npm run dev`: `X-API-Key: dev-agent-key`,
`X-App-Password: dev-app-password`, API on `http://localhost:3333`.

## Auth (fail-closed, dual credential)

Every `/api/*` request needs exactly one of:

- `X-API-Key: <API_KEY>` — the AI production agent
- `X-App-Password: <APP_PASSWORD>` — the Next.js web app (password gate)

`POST /auth/verify` checks the web app password (strict rate limit). Repeated failed
authentications per IP are counted and blocked (brute-force guard).

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/` | HTML documentation page | — |
| GET | `/health` | version + DB state | — |
| GET | `/ready` | readiness probe (200 when DB up) | — |
| POST | `/auth/verify` | `{ "password": "…" }` → 200 / 401 | rate-limited |
| GET | `/api/sessions` | list — `page`, `limit` ∈ 5/10/20/50/100, `search`, `sort` ∈ createdAt/updatedAt/title/imagesCount, `order` ∈ asc/desc, `from`/`to` | ✔ |
| POST | `/api/sessions` | create `{ "title": "…" }` (unique, 3–120 chars) | ✔ |
| GET | `/api/sessions/:id` | one session + `imagesCount` / `usedCount` | ✔ |
| DELETE | `/api/sessions/:id` | delete session **and all its images** | ✔ |
| GET | `/api/images` | list + filters: `session_id`, `category`, `used_in_adobe_stock`, `quality`, `active` ∈ true/false (webapp Status filter), `in_use` ∈ true/false, `has_upscales` ∈ true/false, `upscales_lt` = N (images with fewer than N upscales), same pagination/sort as above | ✔ |
| GET | `/api/images/all` | **every image in one call** — agent dedup check before generating a new batch (lean fields; `?with_links=1` adds `image_link` + `upscales`; newest first, capped at 5000 with `truncated` flag) | ✔ |
| POST | `/api/images` | register an image (full metadata, validated) | ✔ |
| POST | `/api/images/claim` | **parallel batch worker** — atomically reserve the oldest eligible image (upscales < `max_upscales`, active, not in use — or claim older than `stale_minutes`, default 30). Body `{ max_upscales?, stale_minutes? }` → `{ data: image \| null, claimed }`; `data: null` = nothing left, the worker stops | ✔ |
| POST | `/api/images/bulk-used` | **webapp multi-selection** — stamp many images in ONE request, on the platforms chosen in the popup. Body `{ used: true\|false, platforms?: [adobe_stock, shutterstock, …], image_ids: [] }` (max 200 images, platforms max one of each) → `{ data: { marked, changed, images[], missing[] } }` — `changed` counts the images whose flags actually flipped (already-marked targets are skipped and stay marked); with `platforms` only those flags flip, without them `used: true` marks Adobe Stock and `used: false` clears every platform. Upscale variants follow their original image automatically (no per-variant targets — the API propagates `used.adobe_stock` onto every variant) | ✔ |
| POST | `/api/images/bulk-fetch` | **webapp multi-selection** — fresh-from-the-DB read of every selected image *before* acting on the selection (platform-picker stats, CSV build — the grid snapshot is never trusted for reads). Body `{ image_ids: [] }` (max 200) → `{ data: { images[] (request order), missing[] } }` | ✔ |
| POST | `/api/images/:id/release` | batch worker reports the attempt outcome — `{ status: ok \| stopped \| error, error_message? }`: `ok` clears the error, `stopped` only frees the claim, `error` pauses the image (`active: false`) + records `error_message` | ✔ |
| GET | `/api/images/:id` | one image (incl. its `upscales[]`) | ✔ |
| PATCH | `/api/images/:id` | edit any metadata field(s) (e.g. `used_in_adobe_stock`, `active`, `error_message`) | ✔ |
| DELETE | `/api/images/:id` | delete one image | ✔ |
| GET | `/api/images/:id/download` | download the image (server-side proxy, `Content-Disposition`) | ✔ |
| POST | `/api/images/:id/upscales` | register an upscaled variant (Real-ESRGAN job) — body `{ url, scale, model, public_id?, width?, height?, size_bytes?, source?, run_id?, max_upscales? }` → 409 `UPSCALE_LIMIT_REACHED` when the image already holds `max_upscales` entries | ✔ |
| DELETE | `/api/images/:id/upscales/:upscaleId` | delete a variant (+ Cloudinary destroy when `CLOUDINARY_*` env vars are set — best-effort). No PATCH route: a variant has no "used" state of its own — it follows its original image | ✔ |
| GET | `/api/images/:id/upscales/:upscaleId/download` | download a variant (proxied) | ✔ |

Sessions are intentionally **not editable** — the product lets the owner modify images only.
Upscales are appended by the GitHub Actions Real-ESRGAN job (see `docs/UPSCALE.md`) and managed
from the webapp; the server enforces a hard cap (`MAX_UPSCALES_PER_IMAGE`, default 10).

The Etsy product endpoints (products, nested images, per-image upscales, per-image downloads
and the whole-product `GET /api/etsy-products/:id/download-zip?origin=1&x2=1&x4=1&metadata=1`
streamed ZIP with `metadata.txt` + `_download-report.txt`) are listed on the API root page
(`GET /`) served by this service.

## Response envelope

```json
{ "data": [ … ], "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ { "path": "category", "message": "…" } ] } }
```

Error codes: `VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `NOT_FOUND` (404),
`SESSION_NOT_FOUND` (404), `UPSCALE_NOT_FOUND` (404), `CONFLICT` (409 — duplicate session title),
`UPSCALE_LIMIT_REACHED` (409 — image already holds the max number of upscales),
`RATE_LIMITED` (429), `BAD_GATEWAY` (502 — dead image link on download), `INTERNAL` (500).

## Deploy (Render)

`render.yaml` at the repo root is a ready blueprint (root dir `api`, health check `/health`).
Required env vars: `MONGODB_URI`, `API_KEY`, `APP_PASSWORD`, plus `CORS_ORIGINS` set to the
Netlify URL of the web app. Optional `MONGO_DB_NAME` selects the database separately from
the URI (default `adobe-stock`, or the db found in the URI path).
Upscale-related optional vars: `MAX_UPSCALES_PER_IMAGE` (default policy cap, hard ceiling 10)
and `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` (enable the
remote-asset destroy when a variant is deleted — see `docs/UPSCALE.md`).
