/**
 * E2E test — runs the full API against a fresh in-memory MongoDB.
 *   cd api && npm test
 *
 * Covers: auth (401/403 flows, brute-force guard), validation, CRUD,
 * pagination/search/filter/sort (+ ASC/DESC switch), cascade delete,
 * unique titles (case-insensitive), rate limits, download proxy, CORS.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');

const API_KEY = 'test-agent-key';
const APP_PASSWORD = 'test-app-password';
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
  }
}

async function call(method, path, { key, password, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'X-API-Key': key } : {}),
      ...(password ? { 'X-App-Password': password } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* html or binary */ }
  return { status: res.status, json, text, headers: res.headers };
}

// A tiny local image server for the download-proxy test.
function startFakeImageServer() {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d99480000000049454e44ae426082',
    'hex'
  );
  const srv = http.createServer((req, res) => {
    if (req.url === '/img.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    } else {
      res.writeHead(404); res.end('nope');
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function main() {
  console.log('─ setting up in-memory MongoDB + API');
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'adobe_stock_test' } });
  const fakeImg = await startFakeImageServer();
  const fakeImgPort = fakeImg.address().port;

  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongod.getUri('adobe_stock_test');
  process.env.API_KEY = API_KEY;
  process.env.APP_PASSWORD = APP_PASSWORD;
  process.env.PORT = String(PORT);
  process.env.TRUST_PROXY = '0';
  process.env.RATE_LIMIT_AUTH_MAX = '3';
  process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_BAD_AUTH_MAX = '5';
  process.env.RATE_LIMIT_BAD_AUTH_BLOCK_MS = '400';
  process.env.RATE_LIMIT_GENERAL_MAX = '1000';

  const { main: startServer } = require('../src/server');
  const { server } = await startServer();

  try {
    // ── public routes ──────────────────────────────────────────────────────
    console.log('─ public routes');
    let r = await call('GET', '/health');
    ok('GET /health → 200 + version', r.status === 200 && r.json.version === '1.0.0' && r.json.db === 'up', r.json);

    r = await call('GET', '/ready');
    ok('GET /ready → 200', r.status === 200);

    r = await call('GET', '/');
    ok('GET / → HTML docs', r.status === 200 && /<html/i.test(r.text) && /Stock Room API/.test(r.text));

    r = await call('GET', '/nope');
    ok('unknown route → 404 JSON', r.status === 404 && r.json.error.code === 'NOT_FOUND');

    // ── auth gate ──────────────────────────────────────────────────────────
    console.log('─ auth');
    r = await call('GET', '/api/sessions');
    ok('no credentials → 401', r.status === 401 && r.json.error.code === 'AUTH_REQUIRED');

    r = await call('GET', '/api/sessions', { key: 'wrong-key' });
    ok('wrong key → 401', r.status === 401);

    r = await call('POST', '/auth/verify', { body: { password: 'wrong' } });
    ok('verify wrong password → 401', r.status === 401);

    r = await call('POST', '/auth/verify', { body: { password: APP_PASSWORD } });
    ok('verify correct password → 200 {ok,role}', r.status === 200 && r.json.ok === true && r.json.role === 'app');

    r = await call('POST', '/auth/verify', { body: {} });
    ok('verify missing body → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    // auth rate limit (max 3 per window) — already used 3 calls above
    r = await call('POST', '/auth/verify', { body: { password: 'x' } });
    ok('verify rate limit → 429', r.status === 429 && r.json.error.code === 'RATE_LIMITED');

    // brute-force guard: 5 wrong creds → blocked (429 even with right key)
    for (let i = 0; i < 5; i += 1) {
      await call('GET', '/api/sessions', { key: `bad-${i}` });
    }
    r = await call('GET', '/api/sessions', { key: API_KEY });
    ok('brute-force block → 429 despite valid key', r.status === 429);
    await new Promise((res) => setTimeout(res, 500)); // let the block expire (400ms)
    r = await call('GET', '/api/sessions', { key: API_KEY });
    ok('block expires → 200 again', r.status === 200);

    // ── sessions CRUD ──────────────────────────────────────────────────────
    console.log('─ sessions');
    r = await call('POST', '/api/sessions', { password: APP_PASSWORD, body: { title: 'Batch — still life ceramics' } });
    ok('create session (app password) → 201', r.status === 201 && r.json.data.title === 'Batch — still life ceramics' && r.json.data._id, r.json);
    const s1 = r.json.data._id;

    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'batch — STILL LIFE ceramics' } });
    ok('duplicate title (case-insensitive) → 409', r.status === 409 && r.json.error.code === 'CONFLICT');

    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'ab' } });
    ok('title too short → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR' && r.json.error.details[0].path === 'title');

    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'Batch — mountain landscapes' } });
    ok('create second session → 201', r.status === 201);
    const s2 = r.json.data._id;

    r = await call('GET', `/api/sessions/${s1}`, { key: API_KEY });
    ok('get session → 200 + counts', r.status === 200 && r.json.data.imagesCount === 0);

    r = await call('GET', '/api/sessions/000000000000000000000000', { key: API_KEY });
    ok('get missing session → 404', r.status === 404);

    r = await call('PATCH', `/api/sessions/${s1}`, { password: APP_PASSWORD, body: { title: 'renamed' } });
    ok('PATCH session → 404 (not editable by design)', r.status === 404);

    // ── images CRUD ────────────────────────────────────────────────────────
    console.log('─ images');
    const mkImage = (i, sessionId, extra = {}) => ({
      session_id: sessionId,
      prompt: `Photorealistic still life ${i}, soft window light, 50mm lens, muted palette`,
      ratio: i % 2 ? '16:9' : '4:3',
      quality: '1K',
      image_link: `https://cdn.example.com/img-${i}.png`,
      title: `Minimal ceramic set number ${i} on linen`,
      category: 'Food',
      keywords: [`ceramic${i}`, 'linen', 'minimalism', 'still life', 'top view'],
      ...extra,
    });

    r = await call('POST', '/api/images', { key: API_KEY, body: mkImage(1, s1) });
    ok('create image (agent key) → 201', r.status === 201 && r.json.data._id && r.json.data.used_in_adobe_stock === false, r.json);
    const img1 = r.json.data._id;

    r = await call('POST', '/api/images', { key: API_KEY, body: mkImage(2, '000000000000000000000000') });
    ok('image with unknown session → 404 SESSION_NOT_FOUND', r.status === 404 && r.json.error.code === 'SESSION_NOT_FOUND');

    r = await call('POST', '/api/images', { key: API_KEY, body: mkImage(3, s1, { category: 'Not a category' }) });
    ok('invalid category → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    r = await call('POST', '/api/images', { key: API_KEY, body: mkImage(4, s1, { keywords: ['one', 'two'] }) });
    ok('too few keywords → 400', r.status === 400);

    r = await call('POST', '/api/images', { key: API_KEY, body: mkImage(5, s1, { image_link: 'ftp://nope/x.png' }) });
    ok('non-http image_link → 400', r.status === 400);

    // bulk: 12 images in s1, 3 in s2
    for (let i = 10; i <= 21; i += 1) {
      await call('POST', '/api/images', {
        key: API_KEY,
        body: mkImage(i, s1, { title: `Alpha asset ${i}`, category: i % 3 === 0 ? 'Landscapes' : 'Food' }),
      });
    }
    for (let i = 30; i <= 32; i += 1) {
      await call('POST', '/api/images', {
        key: API_KEY,
        body: mkImage(i, s2, { title: `Beta asset ${i}`, category: 'Technology' }),
      });
    }

    // ── listing contract ───────────────────────────────────────────────────
    console.log('─ listing: pagination / search / filter / sort');
    const K = { key: API_KEY };
    r = await call('GET', '/api/images?page=1&limit=5', K);
    ok('pagination: page=1 limit=5 → 5 items + meta', r.status === 200 && r.json.data && r.json.data.length === 5 && r.json.pagination.total === 16 && r.json.pagination.totalPages === 4, { status: r.status, body: r.json || r.text });

    r = await call('GET', '/api/images?page=2&limit=5', K);
    const page2Ids = r.json.data.map((d) => d._id);
    r = await call('GET', '/api/images?page=1&limit=5', K);
    const page1Ids = r.json.data.map((d) => d._id);
    ok('stable pages: no overlap page1/page2', page1Ids.filter((id) => page2Ids.includes(id)).length === 0);

    r = await call('GET', '/api/images?page=1&limit=7', K);
    ok('limit not in [5,10,20,50,100] → 400', r.status === 400 && r.json.error.details[0].path === 'limit');

    r = await call('GET', '/api/images?limit=5&sort=bogus', K);
    ok('bogus sort → 400', r.status === 400);

    r = await call('GET', '/api/images?limit=5&sort=quality&order=sideways', K);
    ok('bogus order → 400', r.status === 400);

    r = await call('GET', `/api/images?limit=100&session_id=${s1}`, K);
    ok('filter session_id → 13 images', r.json.data.length === 13 && r.json.data.every((d) => d.session_id === s1));

    r = await call('GET', `/api/images?limit=100&session_id=${s1}&category=Landscapes`, K);
    ok('filter session + category → 4', r.json.data.length === 4);

    r = await call('GET', `/api/images?limit=100&session_id=${s1}&used_in_adobe_stock=true`, K);
    ok('filter used=true → 0 (none yet)', r.json.data.length === 0);

    r = await call('GET', '/api/images?limit=100&used_in_adobe_stock=maybe', K);
    ok('bad used value → 400', r.status === 400);

    r = await call('GET', '/api/images?limit=100&search=beta', K);
    ok('search matches title → 3', r.json.data.length === 3 && r.json.data.every((d) => /Beta/.test(d.title)));

    r = await call('GET', '/api/images?limit=100&search=ceramic20', K);
    ok('search matches keywords → ≥1', r.json.data.length >= 1);

    r = await call('GET', '/api/images?limit=100&search=minimal%20ceramic', K);
    ok('search regex-escaped (space, no crash) → 200', r.status === 200);

    // sort + ASC/DESC switch
    r = await call('GET', `/api/images?limit=100&sort=title&order=asc&session_id=${s1}`, K);
    const asc = r.json.data.map((d) => d.title);
    r = await call('GET', `/api/images?limit=100&sort=title&order=desc&session_id=${s1}`, K);
    const desc = r.json.data.map((d) => d.title);
    ok('sort by title asc vs desc — exact mirror',
      asc.length === desc.length && asc[0] === desc[desc.length - 1] && asc.join('|') === [...desc].reverse().join('|'),
      { asc: asc.slice(0, 3), desc: desc.slice(0, 3) });

    r = await call('GET', '/api/images?limit=100&sort=createdAt&order=asc', K);
    const datesAsc = r.json.data.map((d) => new Date(d.createdAt).getTime());
    ok('sort createdAt asc is monotonic', datesAsc.every((v, i) => i === 0 || v >= datesAsc[i - 1]));

    // sessions listing
    r = await call('GET', '/api/sessions?sort=imagesCount&order=desc', K);
    ok('sessions sorted by imagesCount desc → [13, 3]', r.json.data.map((d) => d.imagesCount).join(',') === '13,3', r.json.data);

    r = await call('GET', '/api/sessions?search=land', K);
    ok('sessions search → 1', r.json.data.length === 1 && r.json.data[0].title.includes('landscapes'));

    r = await call('GET', `/api/sessions/${s1}`, K);
    ok('session imagesCount reflects inserts', r.json.data.imagesCount === 13);

    // ── /api/images/all (agent dedup helper) ──────────────────────────────
    console.log('─ images/all (dedup helper)');
    // NB: the 401 check goes LAST and is followed by a short pause: a failed
    // auth re-arms the brute-force guard (400 ms block) and would 429 the
    // next fast calls otherwise.
    r = await call('GET', '/api/images/all', K);
    ok('images/all → all 16 images + count, not truncated', r.status === 200 && r.json.count === 16 && r.json.truncated === false && r.json.data.length === 16, r.json && { count: r.json.count, truncated: r.json.truncated });
    ok('images/all lean projection — no image_link, no upscales',
      r.json.data.every((d) => d.image_link === undefined && d.upscales === undefined));
    ok('images/all carries the dedup fields (title/category/keywords/prompt)',
      r.json.data.every((d) => typeof d.title === 'string' && typeof d.category === 'string' && Array.isArray(d.keywords) && typeof d.prompt === 'string'));
    ok('images/all ids are 24-hex strings', r.json.data.every((d) => /^[0-9a-f]{24}$/.test(d._id)));
    ok('images/all newest first (last insert on top)', r.json.data[0].title === 'Beta asset 32', r.json.data.slice(0, 2).map((d) => d.title));

    r = await call('GET', '/api/images/all?with_links=1', K);
    ok('images/all?with_links=1 → image_link + upscales present',
      r.status === 200 && r.json.data.every((d) => typeof d.image_link === 'string' && Array.isArray(d.upscales)));

    r = await call('GET', '/api/images/all?with_links=banana', K);
    ok('images/all unknown with_links value → 200 (ignored, lean)', r.status === 200 && r.json.data.every((d) => d.image_link === undefined));

    r = await call('GET', '/api/images/all', { password: APP_PASSWORD });
    ok('images/all with app password → 200 (dual credential)', r.status === 200 && r.json.count === 16);

    r = await call('GET', '/api/images/all');
    ok('images/all without credentials → 401', r.status === 401 && r.json.error.code === 'AUTH_REQUIRED');
    await new Promise((resolve) => setTimeout(resolve, 450)); // let the brute-force block expire

    // ── update (mark/unmark) ────────────────────────────────────────────────
    console.log('─ updates');
    r = await call('PATCH', `/api/images/${img1}`, { password: APP_PASSWORD, body: { used_in_adobe_stock: true } });
    ok('mark used (web password) → 200', r.status === 200 && r.json.data.used_in_adobe_stock === true);

    r = await call('PATCH', `/api/images/${img1}`, { password: APP_PASSWORD, body: { used_in_adobe_stock: false } });
    ok('unmark used → 200', r.status === 200 && r.json.data.used_in_adobe_stock === false);

    r = await call('GET', `/api/images/${img1}`, { key: API_KEY });
    ok('persisted unmarked state', r.json.data.used_in_adobe_stock === false);

    r = await call('PATCH', `/api/images/${img1}`, { password: APP_PASSWORD, body: { keywords: ['a', 'b', 'c', 'c'] } });
    ok('keywords dedupe on update', r.status === 200 && r.json.data.keywords.length === 3);

    r = await call('PATCH', `/api/images/${img1}`, { password: APP_PASSWORD, body: {} });
    ok('empty patch → 400', r.status === 400);

    r = await call('PATCH', `/api/images/${img1}`, { password: APP_PASSWORD, body: { title: 'x'.repeat(300) } });
    ok('bad patch value → 400', r.status === 400);

    // ── download proxy ──────────────────────────────────────────────────────
    console.log('─ download proxy');
    r = await call('POST', '/api/images', {
      key: API_KEY,
      body: mkImage(99, s1, {
        image_link: `http://127.0.0.1:${fakeImgPort}/img.png`,
        title: 'Download proxy probe asset',
      }),
    });
    const dl = r.json.data._id;

    const dlRes = await fetch(`${BASE}/api/images/${dl}/download`, { headers: { 'X-API-Key': API_KEY } });
    const buf = Buffer.from(await dlRes.arrayBuffer());
    ok('download → 200 png + attachment + sane filename',
      dlRes.status === 200 &&
      dlRes.headers.get('content-type') === 'image/png' &&
      /attachment/.test(dlRes.headers.get('content-disposition') || '') &&
      /download-proxy-probe-asset/.test(dlRes.headers.get('content-disposition') || '') &&
      buf.length >= 60 && buf[0] === 0x89 && buf[1] === 0x50,
      { type: dlRes.headers.get('content-type'), size: buf.length, cd: dlRes.headers.get('content-disposition') });

    r = await call('GET', '/api/images/000000000000000000000000/download', { key: API_KEY });
    ok('download unknown image → 404', r.status === 404);

    // 502 path: point at the fake server's 404 route
    await call('PATCH', `/api/images/${dl}`, { key: API_KEY, body: { image_link: `http://127.0.0.1:${fakeImgPort}/missing.png` } });
    r = await call('GET', `/api/images/${dl}/download`, { key: API_KEY });
    ok('download dead link → 502 BAD_GATEWAY', r.status === 502 && r.json.error.code === 'BAD_GATEWAY');

    // ── upscales ────────────────────────────────────────────────────────────
    console.log('─ upscales');
    const mkUpscale = (over = {}) => ({
      url: `http://127.0.0.1:${fakeImgPort}/img.png`,
      public_id: 'adobe-stock/upscales/test_x4',
      scale: 4,
      model: 'RealESRGAN_x4plus',
      width: 4096, height: 4096, size_bytes: 12345,
      source: 'github-actions', run_id: '9876543210',
      ...over,
    });

    r = await call('POST', '/api/images', {
      key: API_KEY,
      body: mkImage(70, s1, { title: 'Upscale probe asset number one', image_link: `http://127.0.0.1:${fakeImgPort}/img.png` }),
    });
    const up = r.json.data._id;

    r = await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale() });
    ok('POST upscale → 201 + entry with _id', r.status === 201 && r.json.data.upscales.length === 1 && r.json.data.upscales[0]._id, r.json);
    const uid1 = r.json.data.upscales[0]._id;

    ok('POST upscale stores model/scale/run_id', r.json.data.upscales[0].model === 'RealESRGAN_x4plus' && r.json.data.upscales[0].scale === 4 && r.json.data.upscales[0].run_id === '9876543210');

    r = await call('POST', `/api/images/${up}/upscales`, {
      key: API_KEY,
      body: mkUpscale({ max_upscales: 1, url: 'http://127.0.0.1:1/x.png' }),
    });
    ok('POST beyond caller max_upscales → 409 UPSCALE_LIMIT_REACHED',
      r.status === 409 && r.json.error.code === 'UPSCALE_LIMIT_REACHED' && /already has 1 upscale/.test(r.json.error.message), r.json);

    r = await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale({ scale: 1 }) });
    ok('POST scale=1 → 400 VALIDATION_ERROR', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    r = await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale({ url: 'ftp://nope/x.png' }) });
    ok('POST non-http url → 400', r.status === 400);

    r = await call('POST', '/api/images/000000000000000000000000/upscales', { key: API_KEY, body: mkUpscale() });
    ok('POST upscale on missing image → 404', r.status === 404 && r.json.error.code === 'NOT_FOUND');

    // server default cap (env not set in this test → CONFIG.MAX_UPSCALES_PER_IMAGE=10)
    for (let i = 0; i < 8; i += 1) {
      await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale() });
    }
    r = await call('GET', `/api/images/${up}`, { key: API_KEY });
    ok('9 upscales stored so far', r.json.data.upscales.length === 9, r.json.data.upscales && r.json.data.upscales.length);
    r = await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale() });
    ok('10th upscale stored (server default cap)', r.status === 201 && r.json.data.upscales.length === 10);
    r = await call('POST', `/api/images/${up}/upscales`, { key: API_KEY, body: mkUpscale() });
    ok('11th upscale → 409 (server default cap)', r.status === 409 && r.json.error.code === 'UPSCALE_LIMIT_REACHED');

    // PATCH (mark used / unmark)
    r = await call('PATCH', `/api/images/${up}/upscales/${uid1}`, { password: APP_PASSWORD, body: { used_in_adobe_stock: true } });
    ok('PATCH upscale mark used (app password) → 200', r.status === 200 && r.json.data.upscales.find((u) => u._id === uid1).used_in_adobe_stock === true);

    r = await call('PATCH', `/api/images/${up}/upscales/${uid1}`, { password: APP_PASSWORD, body: { used_in_adobe_stock: false } });
    ok('PATCH upscale unmark → 200', r.status === 200 && r.json.data.upscales.find((u) => u._id === uid1).used_in_adobe_stock === false);

    r = await call('PATCH', `/api/images/${up}/upscales/000000000000000000000000`, { password: APP_PASSWORD, body: { used_in_adobe_stock: true } });
    ok('PATCH unknown upscale → 404 UPSCALE_NOT_FOUND', r.status === 404 && r.json.error.code === 'UPSCALE_NOT_FOUND');

    r = await call('PATCH', `/api/images/${up}/upscales/${uid1}`, { password: APP_PASSWORD, body: {} });
    ok('PATCH upscale empty body → 400', r.status === 400);

    // listing filters
    r = await call('GET', '/api/images?limit=100&has_upscales=true', K);
    ok('filter has_upscales=true → only the probe image', r.json.data.length === 1 && r.json.data[0]._id === up, r.json.data && r.json.data.length);

    r = await call('GET', '/api/images?limit=100&has_upscales=false', K);
    ok('filter has_upscales=false → all others', r.json.data.length === 17 && r.json.data.every((d) => d._id !== up), r.json.data && r.json.data.length);

    r = await call('GET', '/api/images?limit=100&upscales_lt=2', K);
    ok('filter upscales_lt=2 → 17 (0 upscales, probe excluded)', r.json.data.length === 17 && r.json.data.every((d) => d._id !== up), r.json.data && r.json.data.length);

    r = await call('GET', '/api/images?limit=100&upscales_lt=11', K);
    ok('filter upscales_lt=11 → 18 (probe included)', r.json.data.length === 18, r.json.data && r.json.data.length);

    r = await call('GET', '/api/images?limit=100&upscales_lt=abc', K);
    ok('bad upscales_lt → 400', r.status === 400 && r.json.error.details[0].path === 'upscales_lt');

    r = await call('GET', '/api/images?limit=100&has_upscales=maybe', K);
    ok('bad has_upscales → 400', r.status === 400 && r.json.error.details[0].path === 'has_upscales');

    r = await call('GET', '/api/images?limit=100&has_upscales=true&upscales_lt=5', K);
    ok('both upscale filters → 400 (mutually exclusive)', r.status === 400);

    // download upscale (proxy)
    const dlUp = await fetch(`${BASE}/api/images/${up}/upscales/${uid1}/download`, { headers: { 'X-API-Key': API_KEY } });
    const upBuf = Buffer.from(await dlUp.arrayBuffer());
    ok('download upscale → 200 png + filename _x4',
      dlUp.status === 200 &&
      dlUp.headers.get('content-type') === 'image/png' &&
      /_x4\.png/.test(dlUp.headers.get('content-disposition') || '') &&
      upBuf[0] === 0x89,
      { cd: dlUp.headers.get('content-disposition') });

    r = await call('GET', `/api/images/${up}/upscales/000000000000000000000000/download`, { key: API_KEY });
    ok('download unknown upscale → 404 UPSCALE_NOT_FOUND', r.status === 404 && r.json.error.code === 'UPSCALE_NOT_FOUND');

    // 502 path: dead upscale url
    r = await call('POST', '/api/images', {
      key: API_KEY,
      body: mkImage(71, s1, { title: 'Upscale dead link probe asset', image_link: `http://127.0.0.1:${fakeImgPort}/img.png` }),
    });
    const upDead = r.json.data._id;
    r = await call('POST', `/api/images/${upDead}/upscales`, { key: API_KEY, body: mkUpscale({ url: `http://127.0.0.1:${fakeImgPort}/missing.png` }) });
    const deadUid = r.json.data.upscales[0]._id;
    r = await call('GET', `/api/images/${upDead}/upscales/${deadUid}/download`, { key: API_KEY });
    ok('download dead upscale link → 502 BAD_GATEWAY', r.status === 502 && r.json.error.code === 'BAD_GATEWAY');

    // DELETE upscale (Cloudinary not configured here → DB-only, reported clearly)
    r = await call('DELETE', `/api/images/${upDead}/upscales/${deadUid}`, { password: APP_PASSWORD });
    ok('DELETE upscale → 200 + cloudinary note (not configured)',
      r.status === 200 && r.json.data.deleted === true && r.json.data.upscalesRemaining === 0 &&
      r.json.data.cloudinary && r.json.data.cloudinary.destroyed === false,
      r.json);

    r = await call('DELETE', `/api/images/${upDead}/upscales/${deadUid}`, { password: APP_PASSWORD });
    ok('DELETE same upscale again → 404 UPSCALE_NOT_FOUND', r.status === 404 && r.json.error.code === 'UPSCALE_NOT_FOUND');

    // cleanup: probe images
    await call('DELETE', `/api/images/${up}`, { password: APP_PASSWORD });
    await call('DELETE', `/api/images/${upDead}`, { password: APP_PASSWORD });

    // ── CORS preflight ──────────────────────────────────────────────────────
    const pre = await fetch(`${BASE}/api/images`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://stockroom-web.netlify.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-app-password',
      },
    });
    ok('CORS preflight → 204 + reflected origin + app-password allowed',
      pre.status === 204 &&
      pre.headers.get('access-control-allow-origin') === 'https://stockroom-web.netlify.app' &&
      /x-app-password/i.test(pre.headers.get('access-control-allow-headers') || ''));

    // ── cascade delete ──────────────────────────────────────────────────────
    console.log('─ cascade delete');
    r = await call('DELETE', `/api/sessions/${s2}`, { password: APP_PASSWORD });
    ok('delete session → 200 + imagesDeleted:3', r.status === 200 && r.json.data.deleted === true && r.json.data.imagesDeleted === 3, r.json);

    r = await call('GET', `/api/sessions/${s2}`, { key: API_KEY });
    ok('session gone → 404', r.status === 404);

    r = await call('GET', '/api/images?limit=100&search=beta', { key: API_KEY });
    ok('cascaded images gone', r.json.data.length === 0);

    r = await call('DELETE', `/api/images/${img1}`, { password: APP_PASSWORD });
    ok('delete single image → 200', r.status === 200);

    r = await call('GET', `/api/images/${img1}`, { key: API_KEY });
    ok('image gone → 404', r.status === 404);

    // ── parallel batch workers: claim / release ─────────────────────────────
    console.log('─ claim / release (parallel batch workers)');
    const Image = require('../src/models/ImageToBay'); // same mongoose connection as the server

    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'Claim probe session' } });
    const s3 = r.json.data._id;

    r = await call('POST', '/api/images', {
      key: API_KEY,
      body: mkImage(50, s3, { title: 'Claim probe A' }),
    });
    const cA = r.json.data._id;
    ok('create → active:true, in_use:false, error_message:""',
      r.status === 201 && r.json.data.active === true && r.json.data.in_use === false && r.json.data.error_message === '', r.json.data);

    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 'banana' } });
    ok('claim with string max_upscales → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('claim → oldest eligible first + claimed:true + in_use:true + in_use_at set',
      r.status === 200 && r.json.claimed === true && r.json.data.title === 'Alpha asset 10' &&
      r.json.data.in_use === true && r.json.data.in_use_at,
      { title: r.json.data && r.json.data.title });
    const cl1 = r.json.data._id;

    r = await call('GET', `/api/images/${cl1}`, K);
    ok('claim persisted (GET shows in_use true)', r.json.data.in_use === true);

    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const cl2 = r.json.data._id;
    ok('second concurrent claim → a DIFFERENT image (atomic reservation)',
      r.json.claimed === true && cl2 !== cl1, { cl1, cl2 });

    r = await call('POST', `/api/images/${cl1}/release`, { key: API_KEY, body: { status: 'stopped' } });
    ok('release stopped → in_use:false, active untouched, no error',
      r.status === 200 && r.json.data.in_use === false && r.json.data.active === true && r.json.data.error_message === '');

    r = await call('POST', `/api/images/${cl2}/release`, { key: API_KEY, body: { status: 'error' } });
    ok('release error without error_message → 400', r.status === 400);

    r = await call('POST', `/api/images/${cl2}/release`, {
      key: API_KEY,
      body: { status: 'error', error_message: 'Upscale failed: Real-ESRGAN crashed on tile 3' },
    });
    ok('release error → in_use:false + active:false + error_message recorded',
      r.status === 200 && r.json.data.in_use === false && r.json.data.active === false &&
      /Real-ESRGAN crashed/.test(r.json.data.error_message), r.json.data);

    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const cl3 = r.json.data._id;
    ok('claim skips the paused (active:false) image', r.json.claimed === true && cl3 !== cl2);

    // in_use / active filters (cl3 is claimed, cl2 is paused)
    r = await call('GET', '/api/images?active=false&limit=100', K);
    ok('filter active=false → paused images only (includes failed one)',
      r.status === 200 && r.json.data.some((d) => d._id === cl2) && r.json.data.every((d) => d.active === false));
    r = await call('GET', '/api/images?active=true&limit=100', K);
    ok('filter active=true → excludes paused image', r.json.data.every((d) => d._id !== cl2));
    r = await call('GET', '/api/images?in_use=true&limit=100', K);
    ok('filter in_use=true → currently claimed only', r.json.data.some((d) => d._id === cl3) && r.json.data.every((d) => d.in_use === true));
    r = await call('GET', '/api/images?in_use=false&limit=100', K);
    ok('filter in_use=false → excludes claimed image', r.json.data.every((d) => d._id !== cl3));
    r = await call('GET', '/api/images?active=banana&limit=5', K);
    ok('bad active filter value → 400', r.status === 400);

    // webapp flows: re-activate + dismiss the error message
    r = await call('PATCH', `/api/images/${cl2}`, { password: APP_PASSWORD, body: { active: 'yes' } });
    ok('PATCH active with non-boolean → 400', r.status === 400);
    r = await call('PATCH', `/api/images/${cl2}`, { password: APP_PASSWORD, body: { active: true } });
    ok('PATCH re-activate paused image → 200 + active:true', r.status === 200 && r.json.data.active === true);
    r = await call('PATCH', `/api/images/${cl2}`, { password: APP_PASSWORD, body: { error_message: '' } });
    ok('PATCH dismiss error_message → 200 + cleared', r.status === 200 && r.json.data.error_message === '');

    r = await call('POST', `/api/images/${cl3}/release`, { key: API_KEY, body: { status: 'stopped' } });
    ok('release cl3 (cleanup)', r.status === 200);

    // pre-feature document: fields absent → still active + claimable
    await Image.updateOne({ _id: cA }, { $unset: { active: '', in_use: '', error_message: '' } });
    r = await call('GET', '/api/images?active=false&limit=100', K);
    ok('pre-feature doc (no active field) NOT listed as paused', r.json.data.every((d) => d._id !== cA));
    r = await call('GET', '/api/images?active=true&limit=100', K);
    ok('pre-feature doc listed as active', r.json.data.some((d) => d._id === cA));

    // stale reclaim: a claim older than the stale window is reclaimable
    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const cl4 = r.json.data._id;
    await Image.updateOne({ _id: cl4 }, { $set: { in_use_at: new Date(Date.now() - 40 * 60000) } });
    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5, stale_minutes: 30 } });
    ok('stale claim (in_use_at 40 min old) is reclaimed by the next worker',
      r.json.claimed === true && r.json.data._id === cl4, { expected: cl4, got: r.json.data && r.json.data._id });
    r = await call('POST', `/api/images/${cl4}/release`, { key: API_KEY, body: { status: 'stopped' } });
    ok('reclaimed image released → 200', r.status === 200);

    // a FRESH claim must NOT be stolen
    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const cl5 = r.json.data._id;
    r = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5, stale_minutes: 30 } });
    ok('fresh claim is NOT stolen (another image returned)', r.json.claimed === true && r.json.data._id !== cl5);
    await call('POST', `/api/images/${cl5}/release`, { key: API_KEY, body: { status: 'stopped' } });
    await call('POST', `/api/images/${r.json.data._id}/release`, { key: API_KEY, body: { status: 'stopped' } });

    // release on an unknown image → 404
    r = await call('POST', '/api/images/000000000000000000000000/release', { key: API_KEY, body: { status: 'ok' } });
    ok('release unknown image → 404', r.status === 404);

    // ── Etsy products: per-image claim / release / upscales ─────────────────
    console.log('─ etsy products: per-image claim / release / upscales');
    const EtsyProduct = require('../src/models/EtsyProduct');

    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'Etsy upscale probe session' } });
    const s4 = r.json.data._id;

    const mkEtsyProduct = (title, images) => ({
      session_id: s4,
      product_type: 'coloring_book',
      images,
      metadata: {
        title,
        description: 'A printable coloring book with distinct, charming pages for relaxed afternoons.',
        tags: ['coloring book', 'printable', 'kids activity'],
        category: 'Toys & Games > Games > Coloring Books',
        price: 4.99,
      },
    });

    r = await call('POST', '/api/etsy-products', {
      key: API_KEY,
      body: mkEtsyProduct('Woodland Coloring Book', [
        { image_link: `http://127.0.0.1:${fakeImgPort}/img.png`, role: 'cover', caption: 'Cover' },
        { image_link: 'https://cdn.example.com/page-1.png', role: 'page', caption: 'Page 1 — toadstools' },
        { image_link: 'https://cdn.example.com/page-2.png', role: 'page', caption: 'Page 2 — lanterns' },
      ]),
    });
    ok('create etsy product with 3 images → 201', r.status === 201 && r.json.data.images.length === 3, r.json);
    const ep1 = r.json.data._id;
    const ep1Images = r.json.data.images.map((im) => im._id);

    r = await call('POST', '/api/etsy-products', {
      key: API_KEY,
      body: mkEtsyProduct('Harbor Coloring Book', [
        { image_link: 'https://cdn.example.com/harbor-cover.png', role: 'cover', caption: 'Cover' },
        { image_link: 'https://cdn.example.com/harbor-1.png', role: 'page', caption: 'Page 1 — boats' },
      ]),
    });
    ok('create second etsy product → 201', r.status === 201);
    const ep2 = r.json.data._id;

    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 'banana' } });
    ok('etsy claim with string max_upscales → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('etsy claim → oldest product first + claimed:true + shape {product_id, image_id, image_index, product, image}',
      r.status === 200 && r.json.claimed === true && r.json.data.product_id === ep1 &&
      typeof r.json.data.image_id === 'string' && r.json.data.image_index >= 0 &&
      r.json.data.image && r.json.data.product && r.json.data.image.in_use === true,
      r.json.data && { product_id: r.json.data.product_id, image_index: r.json.data.image_index });
    const ec1 = r.json.data.image_id;

    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('second etsy claim → a DIFFERENT image (atomic reservation)',
      r.json.claimed === true && r.json.data.image_id !== ec1, { ec1, got: r.json.data && r.json.data.image_id });
    const ec2 = r.json.data.image_id;

    r = await call('GET', `/api/etsy-products/${ep1}`, K);
    const claimedImage = r.json.data.images.find((im) => im._id === ec1);
    ok('claim persisted (GET shows the image in_use:true)', claimedImage.in_use === true);

    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec1}/release`, { key: API_KEY, body: { status: 'stopped' } });
    ok('etsy release stopped → in_use:false, active untouched, no error',
      r.status === 200 && r.json.data.images.find((im) => im._id === ec1).in_use === false &&
      r.json.data.images.find((im) => im._id === ec1).active !== false);

    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec2}/release`, { key: API_KEY, body: { status: 'error' } });
    ok('etsy release error without error_message → 400', r.status === 400);

    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec2}/release`, {
      key: API_KEY,
      body: { status: 'error', error_message: 'Real-ESRGAN crashed while upscaling this page' },
    });
    const releasedImg = r.json.data.images.find((im) => im._id === ec2);
    ok('etsy release error → in_use:false + active:false + error_message recorded',
      r.status === 200 && releasedImg.in_use === false && releasedImg.active === false &&
      /Real-ESRGAN crashed/.test(releasedImg.error_message), releasedImg);

    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('etsy claim skips the paused image', r.json.claimed === true && r.json.data.image_id !== ec2);
    const ec3 = r.json.data.image_id;

    // webapp flows: re-activate + dismiss the error message on ONE image
    r = await call('PATCH', `/api/etsy-products/${ep1}/images/${ec2}`, { password: APP_PASSWORD, body: { active: 'yes' } });
    ok('PATCH etsy image with non-boolean active → 400', r.status === 400);
    r = await call('PATCH', `/api/etsy-products/${ep1}/images/${ec2}`, { password: APP_PASSWORD, body: { active: true } });
    ok('PATCH re-activate paused etsy image → 200 + active:true',
      r.status === 200 && r.json.data.images.find((im) => im._id === ec2).active === true);
    r = await call('PATCH', `/api/etsy-products/${ep1}/images/${ec2}`, { password: APP_PASSWORD, body: { error_message: '' } });
    ok('PATCH dismiss etsy image error_message → 200 + cleared',
      r.status === 200 && r.json.data.images.find((im) => im._id === ec2).error_message === '');
    r = await call('PATCH', `/api/etsy-products/${ep1}/images/${ec2}`, { password: APP_PASSWORD, body: {} });
    ok('PATCH etsy image with empty body → 400', r.status === 400);

    // upscales on the nested images
    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec3}/upscales`, {
      key: API_KEY,
      body: { url: 'https://res.cloudinary.com/demo/woodland_x4.png', scale: 4, model: 'RealESRGAN_x4plus', width: 4096, height: 4096, size_bytes: 3145728, run_id: '42' },
    });
    ok('etsy addUpscale → 201 + entry on the image',
      r.status === 201 && r.json.data.images.find((im) => im._id === ec3).upscales.length === 1, r.json);
    const eUpscaleId = r.json.data.images.find((im) => im._id === ec3).upscales[0]._id;

    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec3}/upscales`, {
      key: API_KEY,
      body: { url: 'https://res.cloudinary.com/demo/woodland_x4_2.png', scale: 4, model: 'RealESRGAN_x4plus', max_upscales: 1 },
    });
    ok('etsy addUpscale past max_upscales → 409 UPSCALE_LIMIT_REACHED',
      r.status === 409 && r.json.error.code === 'UPSCALE_LIMIT_REACHED');

    r = await call('PATCH', `/api/etsy-products/${ep1}/images/${ec3}/upscales/${eUpscaleId}`, {
      password: APP_PASSWORD, body: { used_in_adobe_stock: true },
    });
    ok('etsy updateUpscale mark used → 200',
      r.status === 200 && r.json.data.images.find((im) => im._id === ec3).upscales[0].used_in_adobe_stock === true,
      { status: r.status, body: JSON.stringify(r.json).slice(0, 200) });

    // download proxies (the cover points at the fake local image server)
    r = await call('GET', `/api/etsy-products/${ep1}/images/${ep1Images[0]}/download`, K);
    ok('etsy image download proxy → 200 + image/png + attachment filename',
      r.status === 200 && (r.headers.get('content-type') || '').includes('image/png') &&
      /attachment; filename=/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));

    r = await call('GET', `/api/etsy-products/${ep1}/images/${ec3}/upscales/${eUpscaleId}/download`, K);
    ok('etsy upscale download proxy → 200 (cloudinary url is faked → 502 expected)',
      r.status === 502 && r.json.error.code === 'BAD_GATEWAY', { status: r.status });

    r = await call('DELETE', `/api/etsy-products/${ep1}/images/${ec3}/upscales/${eUpscaleId}`, { password: APP_PASSWORD });
    ok('etsy removeUpscale → 200 + deleted + upscalesRemaining:0',
      r.status === 200 && r.json.data.deleted === true && r.json.data.upscalesRemaining === 0, r.json);

    // ── Etsy products: marketing (announcement) images ─────────────────────
    console.log('─ etsy products: marketing images + per-image management');

    r = await call('POST', `/api/etsy-products/${ep1}/images`, {
      key: API_KEY,
      body: {
        image_link: 'https://cdn.example.com/woodland-promo-1.png',
        role: 'marketing',
        caption: 'Woodland Coloring Book — Promo 1: what is inside collage',
        ratio: '1:1',
        quality: '2K',
      },
    });
    ok('append a marketing (announcement) image → 201 + role kept',
      r.status === 201 && r.json.data.images.some((im) => im.role === 'marketing' && /Promo 1/.test(im.caption || '')), r.json);

    r = await call('POST', `/api/etsy-products/${ep1}/images`, {
      key: API_KEY,
      body: { image_link: 'https://cdn.example.com/x.png', role: 'hero-shot' },
    });
    ok('append with an unknown role → 400 (enum includes marketing)',
      r.status === 400 && /role/.test(JSON.stringify(r.json.error.details || [])));

    r = await call('POST', '/api/etsy-products', {
      key: API_KEY,
      body: mkEtsyProduct('Garden Coloring Book', [
        { image_link: 'https://cdn.example.com/garden-cover.png', role: 'cover' },
        { image_link: 'https://cdn.example.com/garden-promo.png', role: 'marketing', caption: 'Garden — Promo 1' },
      ]),
    });
    ok('create product with a marketing image inline → 201',
      r.status === 201 && r.json.data.images.some((im) => im.role === 'marketing'));
    const ep3 = r.json.data._id;
    const ep3Marketing = r.json.data.images.find((im) => im.role === 'marketing')._id;
    const ep3Cover = r.json.data.images.find((im) => im.role === 'cover')._id;

    // PATCH product with ONLY images → 400: the array is not wholesale
    // patchable (it would drop every nested _id / upscales / worker field).
    r = await call('PATCH', `/api/etsy-products/${ep3}`, {
      password: APP_PASSWORD,
      body: { images: [{ image_link: 'https://cdn.example.com/replace-all.png', role: 'page' }] },
    });
    ok('PATCH product with only images → 400 (images managed via dedicated endpoints)',
      r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    // per-image PATCH: image_link fix + role change
    r = await call('PATCH', `/api/etsy-products/${ep3}/images/${ep3Marketing}`, {
      password: APP_PASSWORD,
      body: { image_link: 'https://cdn.example.com/garden-promo-fixed.png', role: 'marketing' },
    });
    ok('PATCH etsy image image_link → 200 + link replaced',
      r.status === 200 && r.json.data.images.find((im) => im._id === ep3Marketing).image_link === 'https://cdn.example.com/garden-promo-fixed.png');

    // DELETE image: not the last one → 200 + imagesRemaining
    r = await call('DELETE', `/api/etsy-products/${ep3}/images/${ep3Marketing}`, { password: APP_PASSWORD });
    ok('DELETE etsy image → 200 + deleted + imagesRemaining:1',
      r.status === 200 && r.json.data.deleted === true && r.json.data.imagesRemaining === 1, r.json);

    // DELETE the LAST image → 409 LAST_IMAGE
    r = await call('DELETE', `/api/etsy-products/${ep3}/images/${ep3Cover}`, { password: APP_PASSWORD });
    ok('DELETE the last etsy image → 409 LAST_IMAGE (product needs ≥ 1)',
      r.status === 409 && r.json.error.code === 'LAST_IMAGE');

    // DELETE unknown image → 404
    r = await call('DELETE', `/api/etsy-products/${ep3}/images/000000000000000000000000`, { password: APP_PASSWORD });
    ok('DELETE unknown etsy image → 404', r.status === 404);

    // DELETE with a live upscale on the image → 200, the whole image
    // (upscale included) is gone from the product. No public_id on the test
    // upscale → Cloudinary is not even contacted (cloudinary: null).
    r = await call('POST', `/api/etsy-products/${ep3}/images`, {
      key: API_KEY,
      body: { image_link: 'https://cdn.example.com/garden-page.png', role: 'page', caption: 'Garden — Page 1' },
    });
    const ep3Page = r.json.data.images[r.json.data.images.length - 1]._id;
    r = await call('POST', `/api/etsy-products/${ep3}/images/${ep3Page}/upscales`, {
      key: API_KEY,
      body: { url: 'https://res.cloudinary.com/demo/garden_x4.png', scale: 4, model: 'RealESRGAN_x4plus' },
    });
    ok('marketing product: addUpscale on a page → 201', r.status === 201);
    r = await call('DELETE', `/api/etsy-products/${ep3}/images/${ep3Page}`, { password: APP_PASSWORD });
    ok('DELETE etsy image holding an upscale → 200 + entry + upscale gone',
      r.status === 200 && r.json.data.deleted === true && r.json.data.imagesRemaining === 1, r.json);
    r = await call('GET', `/api/etsy-products/${ep3}`, K);
    ok('after DELETE the image (and its upscale) left the product',
      r.json.data.images.length === 1 && !r.json.data.images.some((im) => im._id === ep3Page));

    // 404s & malformed ids
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    await call('POST', `/api/etsy-products/${r.json.data.product_id}/images/${r.json.data.image_id}/release`, { key: API_KEY, body: { status: 'stopped' } });
    r = await call('POST', `/api/etsy-products/000000000000000000000000/images/${ec1}/release`, { key: API_KEY, body: { status: 'ok' } });
    ok('etsy release unknown product → 404', r.status === 404);
    r = await call('PATCH', `/api/etsy-products/${ep1}/images/000000000000000000000000`, { password: APP_PASSWORD, body: { active: true } });
    ok('PATCH unknown etsy image → 404 IMAGE_NOT_FOUND', r.status === 404 && r.json.error.code === 'IMAGE_NOT_FOUND');
    r = await call('POST', `/api/etsy-products/${ep1}/images/not-an-objectid/upscales`, {
      key: API_KEY, body: { url: 'https://x/y.png', scale: 4, model: 'RealESRGAN_x4plus' },
    });
    ok('etsy addUpscale malformed image id → 404 (not a 500)', r.status === 404);

    // stale reclaim on a product image
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const es1 = { pid: r.json.data.product_id, iid: r.json.data.image_id };
    await EtsyProduct.updateOne(
      { _id: es1.pid, 'images._id': es1.iid },
      { $set: { 'images.$.in_use_at': new Date(Date.now() - 40 * 60000) } }
    );
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5, stale_minutes: 30 } });
    ok('stale etsy claim (in_use_at 40 min old) is reclaimed',
      r.json.claimed === true && r.json.data.image_id === es1.iid, { expected: es1.iid, got: r.json.data && r.json.data.image_id });
    await call('POST', `/api/etsy-products/${es1.pid}/images/${es1.iid}/release`, { key: API_KEY, body: { status: 'stopped' } });

    // a FRESH etsy claim must NOT be stolen
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    const es2 = { pid: r.json.data.product_id, iid: r.json.data.image_id };
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5, stale_minutes: 30 } });
    ok('fresh etsy claim is NOT stolen (another image returned)',
      r.json.claimed === true && r.json.data.image_id !== es2.iid);
    await call('POST', `/api/etsy-products/${es2.pid}/images/${es2.iid}/release`, { key: API_KEY, body: { status: 'stopped' } });
    await call('POST', `/api/etsy-products/${r.json.data.product_id}/images/${r.json.data.image_id}/release`, { key: API_KEY, body: { status: 'stopped' } });

    // the ec3 probe image is still claimed (used for the upscale tests) —
    // release it so the exhaustion loop sees the full eligible pool.
    await call('POST', `/api/etsy-products/${ep1}/images/${ec3}/release`, { key: API_KEY, body: { status: 'stopped' } });

    // exhaustion: claim every eligible etsy image (NO release — the claim
    // itself removes them from the eligible pool), then data:null.
    // Pool at this point: ep1's 4 images (3 + the appended marketing one)
    // + ep2's 2 + ep3's 1 remaining cover = 7.
    const etsyClaimed = [];
    for (;;) {
      const res = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
      if (!res.json.claimed) {
        ok('etsy claim → data:null + claimed:false once exhausted', res.json.data === null && res.json.claimed === false);
        break;
      }
      etsyClaimed.push(`${res.json.data.product_id}:${res.json.data.image_id}`);
    }
    ok(`etsy exhaustion loop: ${etsyClaimed.length} image claims, all distinct (no double reservation)`,
      new Set(etsyClaimed).size === etsyClaimed.length && etsyClaimed.length === 7,
      { count: etsyClaimed.length });

    // pre-feature product: image sub-documents WITHOUT worker fields → still
    // claimable (absent in_use/active = eligible). Everything is claimed now,
    // so unsetting ep2's fields frees exactly its two images.
    await EtsyProduct.updateOne(
      { _id: ep2 },
      { $unset: { 'images.$[].active': '', 'images.$[].in_use': '', 'images.$[].error_message': '' } }
    );
    const rawEp2 = await EtsyProduct.findById(ep2).lean();
    ok('pre-feature etsy images have no worker fields in the DB (migration shape)',
      rawEp2.images.every((im) => im.active === undefined && im.in_use === undefined && im.error_message === undefined));
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('pre-feature etsy image (no active/in_use fields) is claimable',
      r.json.claimed === true && r.json.data.product_id === ep2,
      { ep2, got: r.json.data && r.json.data.product_id });
    await call('POST', `/api/etsy-products/${r.json.data.product_id}/images/${r.json.data.image_id}/release`, { key: API_KEY, body: { status: 'stopped' } });
    // and the second pre-feature image too — the absent-fields semantics hold
    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 5 } });
    ok('second pre-feature etsy image is claimable too',
      r.json.claimed === true && r.json.data.product_id === ep2);

    // ── stuck worker claims: visibility + emergency release (webapp unlock) ──
    console.log('─ claims: stuck reservations, quota-aware claim (regression), emergency release');
    // State here: the exhaustion + pre-feature sections left 6 etsy images
    // claimed (in_use: true, never released) and 0 images_to_bay claims.
    r = await call('GET', '/api/claims', K);
    ok('GET /api/claims → the 6 reservations left by the tests (both sources counted)',
      r.status === 200 && r.json.data.total === 6 && r.json.data.etsy.length === 6 &&
      r.json.data.images.length === 0 &&
      r.json.data.etsy.every((c) => c.product_id && c.image_id && c.in_use_at),
      r.json.data && { total: r.json.data.total, etsy: r.json.data.etsy.length, images: r.json.data.images.length });

    r = await call('POST', '/api/claims/release', { key: API_KEY, body: { source: 'banana' } });
    ok('claims/release with an unknown source → 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR');

    r = await call('POST', '/api/claims/release', { key: API_KEY, body: { source: 'etsy' } });
    ok('claims/release (source: etsy) clears every etsy reservation and nothing else',
      r.status === 200 && r.json.data.etsy_images_released === 6 &&
      r.json.data.images_released === 0 && r.json.data.total === 6,
      r.json.data);

    r = await call('GET', '/api/claims', K);
    ok('claims list is empty after the targeted release', r.status === 200 && r.json.data.total === 0);

    r = await call('GET', `/api/etsy-products/${ep2}`, K);
    ok('released etsy images are actually free (no in_use:true left)',
      r.json.data.images.every((im) => im.in_use === false || im.in_use === undefined));

    // ── regression: the claim must skip images already at their quota ──────
    // The claim aggregation projects upscales as a COUNT; the per-candidate
    // re-check once read it with Array.isArray() (a count is not an array →
    // 0) so EVERY image of a candidate product looked eligible: workers
    // claimed the FIRST (already maxed) pages, skipped them, released them,
    // and re-claimed the same ones forever — the fresh pages of a 21-image
    // product were never picked while the log looped on the same 4 pages.
    r = await call('POST', `/api/etsy-products/${ep1}/images/${ec1}/upscales`, {
      key: API_KEY,
      body: { url: 'https://res.cloudinary.com/demo/quota-first_x4.png', scale: 4, model: 'RealESRGAN_x4plus', max_upscales: 1 },
    });
    ok('fill the quota of ep1 FIRST image (1/1) → 201', r.status === 201, r.json);

    r = await call('POST', '/api/etsy-products/claim', { key: API_KEY, body: { max_upscales: 1 } });
    ok('claim (max 1) skips the maxed FIRST image → an eligible image instead',
      r.json.claimed === true && r.json.data.product_id === ep1 && r.json.data.image_id !== ec1 &&
      Array.isArray(r.json.data.image.upscales) && r.json.data.image.upscales.length === 0,
      { got: r.json.data && r.json.data.image_id, ec1 });
    const qclaim = { pid: r.json.data.product_id, iid: r.json.data.image_id };
    await call('POST', `/api/etsy-products/${qclaim.pid}/images/${qclaim.iid}/release`, { key: API_KEY, body: { status: 'stopped' } });

    // clean pool for whatever comes next
    r = await call('POST', '/api/claims/release', { key: API_KEY, body: {} });
    ok('claims/release (default source all) → idempotent zeros once empty',
      r.status === 200 && r.json.data.total === 0, r.json.data);

    // exhaustion: claim everything, then data:null — the batch worker's exit condition
    const claimedIds = [];
    for (;;) {
      const res = await call('POST', '/api/images/claim', { key: API_KEY, body: { max_upscales: 5 } });
      if (!res.json.claimed) {
        ok('claim → data:null + claimed:false once exhausted', res.json.data === null && res.json.claimed === false);
        break;
      }
      claimedIds.push(res.json.data._id);
    }
    ok(`exhaustion loop: ${claimedIds.length} claims, all distinct (no double reservation)`,
      new Set(claimedIds).size === claimedIds.length && claimedIds.length >= 10,
      { count: claimedIds.length });
    ok('pre-feature doc was claimable too (absent fields = eligible)', claimedIds.includes(cA));

    // NB: 401 LAST on purpose — a failed auth re-arms the brute-force guard.
    r = await call('POST', '/api/images/claim', { body: { max_upscales: 5 } });
    ok('claim without credentials → 401', r.status === 401 && r.json.error.code === 'AUTH_REQUIRED');
    await new Promise((resolve) => setTimeout(resolve, 450)); // let the brute-force block expire

    // ── create with the FULL metadata route (the webapp "Add image" form) ──
    // Runs LAST on purpose: it adds one more image, and every count-sensitive
    // test above has already run. adobe_stock is the required base, the
    // explicit shutterstock block is stored verbatim, the other platforms are
    // derived from the Adobe block.
    console.log('─ images: multi-platform metadata create (webapp form route)');
    r = await call('POST', '/api/sessions', { key: API_KEY, body: { title: 'Webapp form probe session' } });
    const sForm = r.json.data._id;
    r = await call('POST', '/api/images', {
      key: API_KEY,
      body: {
        session_id: sForm,
        prompt: 'Multi-platform metadata create probe — brushed brass kettle on a teal counter',
        ratio: '4:3',
        quality: '2K',
        image_link: 'https://cdn.example.com/kettle.png',
        metadata: {
          adobe_stock: {
            title: 'Brushed brass kettle on a teal counter',
            category: 'Drinks',
            keywords: ['brass kettle', 'teal counter', 'kitchen still life', 'minimalism'],
          },
          shutterstock: {
            description: 'A brushed brass kettle resting on a teal kitchen counter',
            categories: ['Objects'],
            keywords: ['brass kettle', 'teal counter', 'kitchen', 'still life', 'minimalism', 'metal', 'appliance'],
          },
        },
      },
    });
    ok('create image with metadata (adobe + explicit shutterstock) → 201', r.status === 201, r.json);
    if (r.status === 201) {
      const md = r.json.data.metadata || {};
      ok('explicit shutterstock block stored verbatim',
        md.shutterstock && md.shutterstock.description.startsWith('A brushed brass kettle') &&
        Array.isArray(md.shutterstock.categories) && md.shutterstock.categories[0] === 'Objects');
      ok('missing platforms derived from the Adobe block (e.g. dreamstime title)',
        md.dreamstime && md.dreamstime.title === 'Brushed brass kettle on a teal counter');
      ok('adobe block stored', md.adobe_stock && md.adobe_stock.category === 'Drinks');
      ok('legacy flat projections derived (title / category / keywords)',
        r.json.data.title === 'Brushed brass kettle on a teal counter' &&
        r.json.data.category === 'Drinks' &&
        Array.isArray(r.json.data.keywords) && r.json.data.keywords.length === 4);
    }

    // ── summary ─────────────────────────────────────────────────────────────
    console.log(`\n══ ${passed} passed, ${failed} failed`);
  } finally {
    server.close();
    fakeImg.close();
    await mongod.stop();
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E fatal:', e);
  process.exit(1);
});
