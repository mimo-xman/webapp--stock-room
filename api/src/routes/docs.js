/**
 * Landing / documentation page served at GET / (Render service root).
 * Static HTML, no build step — matches the web app's "stockroom" identity.
 */
const { CONFIG } = require('../config');
const {
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
  STOCK_PLATFORM_IDS,
  ETSY_PRODUCT_TYPES,
  ETSY_IMAGE_ROLES,
  PAGE_SIZES,
} = require('../constants');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const endpointRows = [
  ['GET', '/', 'This documentation page (HTML)', false],
  ['GET', '/health', 'Service health — version, DB state', false],
  ['GET', '/ready', 'Readiness probe — 200 when DB is up', false],
  ['POST', '/auth/verify', 'Password gate check for the web app — body { "password": "…" }', false],
  ['GET', '/api/sessions', 'List sessions — pagination, search, sort, date range (+ imagesCount / productsCount)', true],
  ['POST', '/api/sessions', 'Create a session — body { "title": "…" } (unique)', true],
  ['GET', '/api/sessions/:id', 'One session + imagesCount / usedCount / productsCount', true],
  ['DELETE', '/api/sessions/:id', 'Delete a session and ALL its images + Etsy products (cascade)', true],
  ['GET', '/api/images', 'List sellable images (images_to_bay) — pagination, search, filters, sort', true],
  ['GET', '/api/images/all', 'Every image in one call — agent dedup check before generating (lean fields; ?with_links=1 adds links + upscales)', true],
  ['POST', '/api/images', 'Register a generated image with per-platform metadata (see example below)', true],
  ['POST', '/api/images/claim', 'PARALLEL BATCH WORKER — atomically reserve the oldest eligible image (upscales < max, active, free). Body { max_upscales?, stale_minutes? } → { data: image|null, claimed }', true],
  ['POST', '/api/images/bulk-used', 'WEBAPP MULTI-SELECTION — stamp many images in one request, on the platforms chosen in the popup. Body { used: true|false, platforms?: [adobe_stock, shutterstock, …], image_ids: [] } → { data: { marked, images[], missing[] } }. Upscales follow their original image automatically (no per-variant targets).', true],
  ['POST', '/api/images/:id/release', 'Batch worker reports the attempt outcome — { status: ok|stopped|error, error_message? }. error → image paused (active:false) + error_message recorded', true],
  ['GET', '/api/images/:id', 'One image (per-platform metadata + upscales)', true],
  ['PATCH', '/api/images/:id', 'Edit image fields (metadata.<platform> blocks, used flags, active, error_message…)', true],
  ['DELETE', '/api/images/:id', 'Delete an image', true],
  ['GET', '/api/images/:id/download', 'Download the image file (server-side proxy)', true],
  ['POST', '/api/images/:id/upscales', 'Register an upscaled variant (Real-ESRGAN job) — 409 UPSCALE_LIMIT_REACHED when the image already holds max_upscales entries', true],
  ['DELETE', '/api/images/:id/upscales/:upscaleId', 'Delete an upscaled variant (+ Cloudinary destroy when configured). No PATCH route: an upscale has no "used" state of its own — it follows its original image', true],
  ['GET', '/api/images/:id/upscales/:upscaleId/download', 'Download an upscaled variant (proxy)', true],
  ['GET', '/api/etsy-products', 'List Etsy digital products — filters: session_id, product_type, used_in_etsy', true],
  ['POST', '/api/etsy-products', 'Create a product — images[] (cover / page / asset / preview / marketing) + one shared Etsy listing metadata block', true],
  ['POST', '/api/etsy-products/claim', 'PARALLEL BATCH WORKER (Etsy edition) — atomically reserve the oldest eligible PRODUCT IMAGE (upscales < max, active, free). Body { max_upscales?, stale_minutes? } → { data: { product_id, image_id, image, product } | null, claimed }', true],
  ['GET', '/api/etsy-products/:id', 'One product (all its images + metadata)', true],
  ['GET', '/api/etsy-products/:id/download-zip', 'WHOLE PRODUCT AS ONE ZIP (streamed) — query origin=1, x2=1, x4=1, metadata=1 (nothing default). Files keep the image order; unfetchable files land in _download-report.txt', true],
  ['PATCH', '/api/etsy-products/:id', 'Edit product fields (metadata merge, product_type, file_link, used_in_etsy — images are managed via the per-image endpoints)', true],
  ['POST', '/api/etsy-products/:id/images', 'Append ONE image to a product — a deliverable image (page…) or an ANNOUNCEMENT image (role: marketing)', true],
  ['PATCH', '/api/etsy-products/:id/images/:imageId', 'Edit ONE product image — caption/role/image_link, active (pause & reactivate), error_message (dismiss)', true],
  ['DELETE', '/api/etsy-products/:id/images/:imageId', 'Remove ONE image from a product (+ Cloudinary destroy of its upscales; 409 LAST_IMAGE on the last one)', true],
  ['POST', '/api/etsy-products/:id/images/:imageId/release', 'Batch worker reports the attempt outcome on that image — { status: ok|stopped|error, error_message? }', true],
  ['GET', '/api/etsy-products/:id/images/:imageId/download', 'Download ONE product image (server-side proxy)', true],
  ['POST', '/api/etsy-products/:id/images/:imageId/upscales', 'Register an upscaled variant on a product image (Real-ESRGAN job) — 409 UPSCALE_LIMIT_REACHED at max_upscales', true],
  ['DELETE', '/api/etsy-products/:id/images/:imageId/upscales/:upscaleId', 'Delete a product-image upscale (+ Cloudinary destroy when configured). No PATCH route: upscales follow their original image', true],
  ['GET', '/api/etsy-products/:id/images/:imageId/upscales/:upscaleId/download', 'Download a product-image upscale (proxy)', true],
  ['GET', '/api/claims', 'Currently claimed images (in_use: true) of BOTH collections — { data: { total, images[], etsy[] } }. Feeds the webapp "Réservées" badge', true],
  ['POST', '/api/claims/release', 'EMERGENCY UNLOCK — clear the reservations a force-stopped batch left behind (in_use / in_use_at only). Body { source?: images|etsy|all } → counts', true],
  ['DELETE', '/api/etsy-products/:id', 'Delete a product', true],
];

const rowsHtml = endpointRows
  .map(([m, p, d, auth]) => `
    <tr>
      <td><span class="mth ${m.toLowerCase()}">${m}</span></td>
      <td><code>${esc(p)}</code></td>
      <td>${esc(d)}</td>
      <td>${auth ? '<span class="chip">key</span>' : '<span class="chip dim">open</span>'}</td>
    </tr>`)
  .join('');

module.exports = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock Room API — AI image asset dispatch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Barlow:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --paper:#F3F2ED; --surface:#FFFFFF; --ink:#17181C; --muted:#6E7480;
    --line:#DAD8D0; --brand:#E8500A; --stamp:#226B45;
  }
  * { box-sizing:border-box; margin:0; padding:0 }
  body { background:var(--paper); color:var(--ink); font:16px/1.6 'Barlow',sans-serif }
  .wrap { max-width:960px; margin:0 auto; padding:40px 20px 80px }
  .tag { display:inline-block; background:var(--brand); color:#fff; font:700 13px 'Barlow Semi Condensed',sans-serif;
         text-transform:uppercase; letter-spacing:.08em; padding:6px 12px; transform:rotate(-2deg) }
  h1 { font:700 42px/1.05 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:-.01em; margin:18px 0 6px }
  .sub { color:var(--muted); max-width:640px }
  .panel { background:var(--surface); border:1px solid var(--ink); box-shadow:5px 5px 0 0 var(--ink); padding:26px 28px; margin:30px 0 }
  h2 { font:700 20px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:.04em; margin-bottom:12px }
  p + p { margin-top:10px }
  code, .mono { font-family:'IBM Plex Mono',monospace; font-size:13px }
  code { background:#ECEBE6; padding:2px 6px }
  pre { background:#ECEBE6; border-left:3px solid var(--brand); padding:14px 16px; overflow-x:auto; font-size:12.5px; line-height:1.55 }
  table { width:100%; border-collapse:collapse; font-size:14px }
  th { text-align:left; font:600 11px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:.1em;
       color:var(--muted); border-bottom:2px solid var(--ink); padding:8px 10px }
  td { border-bottom:1px solid var(--line); padding:9px 10px; vertical-align:top }
  .mth { display:inline-block; font:500 11px 'IBM Plex Mono',monospace; padding:2px 7px; border:1px solid var(--ink); min-width:52px; text-align:center }
  .mth.get { background:#E4EFE7; color:var(--stamp); border-color:var(--stamp) }
  .mth.post { background:#FDEBDD; color:var(--brand); border-color:var(--brand) }
  .mth.patch { background:#FDEBDD; color:var(--brand); border-color:var(--brand) }
  .mth.delete { background:#FBE9E9; color:#C03434; border-color:#C03434 }
  .chip { font:500 11px 'IBM Plex Mono',monospace; text-transform:uppercase; padding:2px 8px; background:var(--ink); color:#fff }
  .chip.dim { background:var(--line); color:var(--muted) }
  .stamp { font:700 15px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:.1em; color:var(--stamp);
           border:2px solid var(--stamp); outline:2px solid var(--stamp); outline-offset:3px; padding:5px 14px; display:inline-block; transform:rotate(-2deg) }
  ul { margin:8px 0 0 20px }
  li { margin:4px 0 }
  footer { margin-top:40px; color:var(--muted); font-size:13px }
  @media (max-width:640px){ h1{font-size:32px} .panel{padding:18px} }
</style>
</head>
<body>
<div class="wrap">
  <span class="tag">Asset database API</span>
  <h1>Stock Room API</h1>
  <p class="sub">Persistence layer for <strong>Stock Room</strong> — multi-platform asset
  dispatch for AI-generated images. Sellable images (<code>images_to_bay</code>)
  carry upload metadata for every stock marketplace (Adobe Stock, Shutterstock,
  Wirestock, iStock, Pond5, Depositphotos, 123RF, Dreamstime); Etsy digital
  products (<code>etsy_products</code>) bundle one or many images (cover, pages,
  announcement/marketing images…) behind one shared listing. AI agents register
  the data here; the Next.js web app reads and manages it behind a password
  gate.</p>

  <div class="panel">
    <h2>Authentication — dual credential</h2>
    <p>Every <code>/api/*</code> request needs exactly one of these headers (fail-closed):</p>
    <ul>
      <li><code>X-API-Key</code> — for the AI production agent (writes sessions + images)</li>
      <li><code>X-App-Password</code> — for the web app (the password you type at the gate)</li>
    </ul>
    <p>Wrong or missing credentials → <code>401 AUTH_REQUIRED</code>. Repeated failures
    are rate-limited and eventually blocked. The password gate itself is
    <code>POST /auth/verify</code> with body <code>{"password":"…"}</code>.</p>
  </div>

  <div class="panel">
    <h2>Endpoints</h2>
    <table>
      <thead><tr><th>Method</th><th>Path</th><th>Purpose</th><th>Auth</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Listing contract (server-enforced)</h2>
    <p>Applies to <code>GET /api/sessions</code>, <code>GET /api/images</code> and
    <code>GET /api/etsy-products</code>:</p>
    <pre>page      integer ≥ 1
limit     one of ${PAGE_SIZES.join(', ')}          (default 10)
search    case-insensitive, escaped
sort      whitelisted field per resource
order     asc | desc               (default desc)
from / to ISO dates on createdAt</pre>
    <p>Images also accept exact filters: <code>session_id</code>, <code>category</code>
    (Adobe category), <code>platform=&lt;id&gt;</code> (metadata present for that
    platform), <code>used=true|false</code> (used on ANY platform),
    <code>used_platform=&lt;id&gt;&amp;used_platform_value=true|false</code> (per-platform),
    <code>quality</code>, <code>ratio</code>,
    <code>active=true|false</code> (webapp Status filter — paused/failed images),
    <code>in_use=true|false</code> (claimed by a batch worker),
    plus upscale filters: <code>has_upscales=true|false</code> (webapp) or
    <code>upscales_lt=N</code> — images with fewer than N upscales (daily batch job).
    Etsy products accept <code>session_id</code>, <code>product_type</code>,
    <code>used_in_etsy=true|false</code>.
    Response envelope:</p>
    <pre>{"data":[ … ],"pagination":{"page":1,"limit":10,"total":42,"totalPages":5}}</pre>
  </div>

  <div class="panel">
    <h2>Register an image (agent) — per-platform metadata</h2>
    <p>Every sellable image stores its upload metadata for EACH marketplace:
    <span class="mono">${esc(STOCK_PLATFORM_IDS.join(', '))}</span>.
    Only <code>metadata.adobe_stock</code> is required — missing platforms are
    auto-derived from it (the generation agent writes the real values itself).</p>
    <pre>curl -X POST ${'${STOCK_ROOM_API}'}/api/images \\
  -H "X-API-Key: ${'${AGENT_KEY}'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "65f1…",
    "prompt": "…the exact generation prompt…",
    "ratio": "16:9",
    "quality": "1K",
    "image_link": "https://…/result.png",
    "metadata": {
      "adobe_stock":    { "title": "Minimal ceramic cups on linen, top view",
                          "category": "Food",
                          "keywords": ["ceramic cup","linen","minimalism", … ] },
      "shutterstock":   { "description": "…", "categories": ["Objects"], "keywords": [ … ] },
      "istock":         { "title": "…", "description": "…", "keywords": [ … ] },
      "wirestock":      { "title": "…", "description": "…", "keywords": [ … ] },
      "pond5":          { "title": "…", "description": "…", "keywords": [ … ], "price": 5 },
      "depositphotos":  { "description": "…", "keywords": [ … ] },
      "123rf":          { "description": "…", "keywords": [ … ] },
      "dreamstime":     { "title": "…", "description": "…", "keywords": [ … ] }
    },
    "used": { "adobe_stock": false, "shutterstock": false }
  }'</pre>
    <p>Adobe <code>category</code> must be exactly one of the ${ADOBE_CATEGORIES.length}
    official categories:
    <span class="mono">${esc(ADOBE_CATEGORIES.join(', '))}</span>.</p>
    <p>Shutterstock <code>categories</code>: 1–2 of
    <span class="mono">${esc(SHUTTERSTOCK_CATEGORIES.join(', '))}</span>.</p>
    <p>Legacy flat <code>title</code> / <code>category</code> / <code>keywords</code> /
    <code>used_in_adobe_stock</code> are still accepted and mapped onto
    <code>metadata.adobe_stock</code> / <code>used.adobe_stock</code>.</p>
  </div>

  <div class="panel">
    <h2>Create an Etsy digital product (agent)</h2>
    <pre>curl -X POST ${'${STOCK_ROOM_API}'}/api/etsy-products \\
  -H "X-API-Key: ${'${AGENT_KEY}'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "65f1…",
    "product_type": "coloring_book",
    "images": [
      { "image_link": "https://…/cover.png",  "role": "cover", "caption": "Book cover" },
      { "image_link": "https://…/page-01.png", "role": "page",  "caption": "Page 1 — castle" }
    ],
    "metadata": {
      "title": "Cozy Castle Coloring Book — 20 Printable Pages",
      "description": "…full Etsy listing description…",
      "tags": ["coloring book", "printable", "kids activity"],
      "category": "Toys & Games > Games > Coloring Books",
      "price": 4.99
    },
    "file_link": "https://…/book.pdf"
  }'</pre>
    <p><code>product_type</code> is one of
    <span class="mono">${esc(ETSY_PRODUCT_TYPES.join(', '))}</span>.
    Image <code>role</code> is one of
    <span class="mono">${esc(ETSY_IMAGE_ROLES.join(', '))}</span> —
    <code>marketing</code> is the ANNOUNCEMENT role: the listing photos that
    present the product to buyers (every product should carry at least 4).
    Etsy limits (validated): title ≤ 140 chars, max 13 tags of ≤ 20 chars each,
    price ≥ $0.20. Append more images later (pages or announcement images)
    with <code>POST /api/etsy-products/:id/images</code>.</p>
  </div>

  <div class="panel">
    <h2>Deployed as</h2>
    <p class="mono">v${esc(CONFIG.VERSION)} · status page: <code>/health</code> · uptime probe: <code>/ready</code></p>
    <p style="margin-top:8px"><span class="stamp">Stockroom · dispatch desk</span></p>
  </div>

  <footer>Source: github.com/mimo-xman/webapp--stock-room — API lives in <code>api/</code>, web app in <code>web/</code>, the reusable agent prompts in <code>prompts/</code> (indexed by AGENT_PROMPT.md).</footer>
</div>
</body>
</html>`;
