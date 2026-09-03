# Stockroom API — asset database

Node.js + Express + Mongoose API that stores generation **Sessions** and **Images**
(with Adobe Stock upload metadata) for the *Adobe Stock — Images Generator by agents* pipeline.

## Run

```bash
npm install
cp .env.example .env          # then edit MONGODB_URI / API_KEY / APP_PASSWORD
npm start                     # production
npm run dev                   # dev with in-memory MongoDB (no Atlas needed)
npm test                      # 81-assertion E2E suite (in-memory MongoDB)
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
| GET | `/api/images` | list + filters: `session_id`, `category`, `used_in_adobe_stock`, `quality`, `has_upscales` ∈ true/false, `upscales_lt` = N (images with fewer than N upscales), same pagination/sort as above | ✔ |
| POST | `/api/images` | register an image (full metadata, validated) | ✔ |
| GET | `/api/images/:id` | one image (incl. its `upscales[]`) | ✔ |
| PATCH | `/api/images/:id` | edit any metadata field(s) (e.g. `used_in_adobe_stock`) | ✔ |
| DELETE | `/api/images/:id` | delete one image | ✔ |
| GET | `/api/images/:id/download` | download the image (server-side proxy, `Content-Disposition`) | ✔ |
| POST | `/api/images/:id/upscales` | register an upscaled variant (Real-ESRGAN job) — body `{ url, scale, model, public_id?, width?, height?, size_bytes?, source?, run_id?, max_upscales? }` → 409 `UPSCALE_LIMIT_REACHED` when the image already holds `max_upscales` entries | ✔ |
| PATCH | `/api/images/:id/upscales/:upscaleId` | mark a variant used/unused (`{ "used_in_adobe_stock": true }`) | ✔ |
| DELETE | `/api/images/:id/upscales/:upscaleId` | delete a variant (+ Cloudinary destroy when `CLOUDINARY_*` env vars are set — best-effort) | ✔ |
| GET | `/api/images/:id/upscales/:upscaleId/download` | download a variant (proxied) | ✔ |

Sessions are intentionally **not editable** — the product lets the owner modify images only.
Upscales are appended by the GitHub Actions Real-ESRGAN job (see `docs/UPSCALE.md`) and managed
from the webapp; the server enforces a hard cap (`MAX_UPSCALES_PER_IMAGE`, default 10).

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
