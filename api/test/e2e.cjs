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
    ok('GET / → HTML docs', r.status === 200 && /<html/i.test(r.text) && /Stockroom API/.test(r.text));

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
