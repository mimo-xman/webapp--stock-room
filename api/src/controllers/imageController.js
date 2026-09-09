/**
 * Image controller — CRUD + advanced listing + download proxy + upscales.
 *
 * The images live in the `images_to_bay` collection (ImageToBay model) with
 * per-platform metadata + per-platform used flags. Legacy flat writes
 * (title/category/keywords/used_in_adobe_stock) are mapped onto
 * metadata.adobe_stock / used.adobe_stock, and list/get responses expose flat
 * legacy projections derived from the new structure, so the webapp and older
 * agent prompts keep working during the transition.
 */
const { Readable } = require('node:stream');
const Image = require('../models/ImageToBay');
const Session = require('../models/Session');
const { CONFIG } = require('../config');
const {
  IMAGE_SORT_FIELDS,
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
  MONGODB_OBJECT_ID_RE,
  UPSCALE_HARD_MAX,
  IMAGES_ALL_MAX,
  CLAIM_STALE_DEFAULT_MINUTES,
  STOCK_PLATFORM_IDS,
} = require('../constants');
const { derivePlatformMetadata, emptyUsed, usedCount } = require('../utils/derivePlatformMetadata');
const {
  escapeRegex,
  parseCommonQuery,
  exactFilter,
  paginationMeta,
} = require('../utils/listQuery');
const { destroyAsset } = require('../utils/cloudinary');
const { HttpError } = require('../middleware/errorHandler');

function badRequest(res, problems) {
  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: `Invalid data — ${problems[0].message}`,
      details: problems,
    },
  });
}

function toPlain(doc) {
  return Image.plain(doc);
}

/** Parse image-specific filters.
 *  session_id, category (adobe), platform metadata presence, used (any or
 *  per-platform), quality, ratio, upscales. */
function parseImageFilters(query) {
  const problems = [];
  const filters = {};

  const f1 = exactFilter(query.session_id, 'session_id');
  if (f1.problem) problems.push(f1.problem);
  else if (f1.value !== undefined) {
    if (!MONGODB_OBJECT_ID_RE.test(f1.value)) {
      problems.push({ path: 'session_id', message: 'session_id must be a 24-character MongoDB ObjectId' });
    } else {
      filters.session_id = f1.value;
    }
  }

  // category → metadata.adobe_stock.category (legacy flat filter)
  const f2 = exactFilter(query.category, 'category', ADOBE_CATEGORIES);
  if (f2.problem) problems.push(f2.problem);
  else if (f2.value !== undefined) filters['metadata.adobe_stock.category'] = f2.value;

  // platform=shutterstock → images that carry metadata for that platform
  if (query.platform !== undefined && query.platform !== '') {
    if (STOCK_PLATFORM_IDS.includes(query.platform)) {
      const key = `metadata.${query.platform}`;
      filters[key] = { $exists: true, $ne: null };
    } else {
      problems.push({
        path: 'platform',
        message: `platform must be one of: ${STOCK_PLATFORM_IDS.join(', ')}`,
      });
    }
  }

  // used=true|false → used on ANY platform (used_count > 0 / == 0).
  // used=<platform> is NOT supported — use platform+used combos via
  // `used_platform` below for per-platform used filters.
  if (query.used !== undefined && query.used !== '') {
    const v = String(query.used).toLowerCase();
    if (v === 'true') filters.used_count = { $gt: 0 };
    else if (v === 'false') filters.used_count = { $eq: 0 };
    else problems.push({ path: 'used', message: 'used must be "true" or "false"' });
  }

  // used_platform=adobe_stock&used_platform_value=true|false — per-platform.
  if (query.used_platform !== undefined && query.used_platform !== '') {
    if (STOCK_PLATFORM_IDS.includes(query.used_platform)) {
      const v = String(query.used_platform_value || 'true').toLowerCase();
      if (v === 'true' || v === 'false') {
        filters[`used.${query.used_platform}`] = v === 'true';
      } else {
        problems.push({ path: 'used_platform_value', message: 'used_platform_value must be "true" or "false"' });
      }
    } else {
      problems.push({
        path: 'used_platform',
        message: `used_platform must be one of: ${STOCK_PLATFORM_IDS.join(', ')}`,
      });
    }
  }

  // legacy wire name — maps to used.adobe_stock exactly (historical
  // behavior of the filter kept for old clients)
  if (query.used_in_adobe_stock !== undefined && query.used_in_adobe_stock !== '' &&
      query.used === undefined) {
    const v = String(query.used_in_adobe_stock).toLowerCase();
    if (v === 'true') filters['used.adobe_stock'] = true;
    else if (v === 'false') filters['used.adobe_stock'] = { $ne: true };
    else problems.push({ path: 'used_in_adobe_stock', message: 'used_in_adobe_stock must be "true" or "false"' });
  }

  const f4 = exactFilter(query.quality, 'quality', ['1K', '2K', '4K']);
  if (f4.problem) problems.push(f4.problem);
  else if (f4.value !== undefined) filters.quality = f4.value;

  // ── batch-worker status filters ──
  // active=true  → "not paused"  : matches true AND absent (pre-feature docs)
  // active=false → "paused"      : exactly false (set after a hard failure)
  if (query.active !== undefined && query.active !== '') {
    const v = String(query.active).toLowerCase();
    if (v === 'true') filters.active = { $ne: false };
    else if (v === 'false') filters.active = false;
    else problems.push({ path: 'active', message: 'active must be "true" or "false"' });
  }
  // in_use=true  → currently claimed by a batch worker (exactly true)
  // in_use=false → free (matches false AND absent)
  if (query.in_use !== undefined && query.in_use !== '') {
    const v = String(query.in_use).toLowerCase();
    if (v === 'true') filters.in_use = true;
    else if (v === 'false') filters.in_use = { $ne: true };
    else problems.push({ path: 'in_use', message: 'in_use must be "true" or "false"' });
  }

  const f5 = exactFilter(query.ratio, 'ratio', null);
  if (f5.value !== undefined) filters.ratio = f5.value;

  // ── upscale filters (mutually exclusive — both write filters.$expr) ──
  // has_upscales=true|false : images with / without upscale variants (webapp).
  // upscales_lt=N          : images with FEWER than N upscales — eligibility
  //                          query used by the daily batch job.
  if (query.has_upscales !== undefined && query.has_upscales !== '' &&
      query.upscales_lt !== undefined && query.upscales_lt !== '') {
    problems.push({ path: 'has_upscales', message: 'has_upscales and upscales_lt are mutually exclusive — use one or the other' });
  } else {
    if (query.has_upscales !== undefined && query.has_upscales !== '') {
      const v = String(query.has_upscales).toLowerCase();
      if (v === 'true' || v === 'false') {
        const size = { $size: { $ifNull: ['$upscales', []] } };
        filters.$expr = v === 'true' ? { $gt: [size, 0] } : { $eq: [size, 0] };
      } else {
        problems.push({ path: 'has_upscales', message: 'has_upscales must be "true" or "false"' });
      }
    }

    if (query.upscales_lt !== undefined && query.upscales_lt !== '') {
      const n = parseInt(query.upscales_lt, 10);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        problems.push({ path: 'upscales_lt', message: 'upscales_lt must be an integer between 0 and 100' });
      } else {
        filters.$expr = { $lt: [{ $size: { $ifNull: ['$upscales', []] } }, n] };
      }
    }
  }

  return { problems, filters };
}

async function list(req, res, next) {
  try {
    const parsed = parseCommonQuery(req.query, IMAGE_SORT_FIELDS);
    if (parsed.problems) return badRequest(res, parsed.problems);
    const { filters, problems } = parseImageFilters(req.query);
    if (problems.length) return badRequest(res, problems);

    const { page, limit, skip, search, sort, order, from, to } = parsed.value;

    const match = { ...filters };
    if (search) {
      const re = { $regex: escapeRegex(search), $options: 'i' };
      match.$or = [
        { 'metadata.adobe_stock.title': re },
        { 'metadata.shutterstock.description': re },
        { 'metadata.istock.title': re },
        { 'metadata.wirestock.title': re },
        { 'metadata.pond5.title': re },
        { 'metadata.depositphotos.description': re },
        { 'metadata.123rf.description': re },
        { 'metadata.dreamstime.title': re },
        { prompt: re },
        { 'metadata.adobe_stock.category': re },
        { 'metadata.adobe_stock.keywords': re },
        { 'metadata.shutterstock.keywords': re },
      ];
    }
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const dir = order === 'asc' ? 1 : -1;
    // "used" sorts on the used_count mirror; "title"/"category" sort on the
    // Adobe-first projection (the display fields).
    const sortKeyMap = {
      title: 'metadata.adobe_stock.title',
      category: 'metadata.adobe_stock.category',
      used: 'used_count',
    };
    const sortKey = sortKeyMap[sort] || sort;
    const stringSort = ['title', 'prompt', 'category', 'ratio', 'metadata.adobe_stock.title', 'metadata.adobe_stock.category'].includes(sortKey);
    const collation = stringSort ? { locale: 'en', strength: 2 } : undefined;

    let q = Image.find(match).sort({ [sortKey]: dir, _id: dir }).skip(skip).limit(limit);
    if (collation) q = q.collation(collation);

    const [docs, total] = await Promise.all([q.lean(), Image.countDocuments(match)]);

    res.json({
      data: docs.map((d) => {
        const plain = Image.plain(d);
        return plain;
      }),
      pagination: paginationMeta({ page, limit, total }),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const payload = req.validated;
    const session = await Session.findById(payload.session_id);
    if (!session) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `Session ${payload.session_id} does not exist — create the session first`);
    }

    // Normalize: legacy flat fields → metadata.adobe_stock; derive missing
    // platforms; merge the explicit per-platform blocks on top.
    const provided = payload.metadata || {};
    const adobe =
      provided.adobe_stock ||
      (payload.title && payload.category && payload.keywords
        ? { title: payload.title, category: payload.category, keywords: payload.keywords }
        : null);
    if (!adobe) {
      return badRequest(res, [
        { path: 'metadata.adobe_stock', message: 'metadata.adobe_stock (or legacy flat title/category/keywords) is required' },
      ]);
    }
    const derived = derivePlatformMetadata(adobe);
    // explicit per-platform blocks win over the derived defaults
    const metadata = {};
    for (const id of STOCK_PLATFORM_IDS) {
      metadata[id] = provided[id] !== undefined ? provided[id] : derived[id];
    }

    // used flags: explicit values win, else legacy alias, else false
    const used = emptyUsed();
    if (payload.used) {
      for (const id of STOCK_PLATFORM_IDS) {
        if (typeof payload.used[id] === 'boolean') used[id] = payload.used[id];
      }
    }
    if (typeof payload.used_in_adobe_stock === 'boolean' &&
        (!payload.used || payload.used.adobe_stock === undefined)) {
      used.adobe_stock = payload.used_in_adobe_stock;
    }

    const image = await Image.create({
      session_id: payload.session_id,
      prompt: payload.prompt,
      ratio: payload.ratio,
      quality: payload.quality,
      image_link: payload.image_link,
      metadata,
      used,
      used_count: usedCount(used),
    });
    res.status(201).json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

// ── all images (dedup helper for the generation agent) ───────────────────

/**
 * GET /api/images/all[?with_links=1]
 *
 * EVERY image in one response — the generation agent calls it BEFORE
 * preparing a batch to avoid producing near-duplicates (same subject +
 * same composition) of what is already stored. Lean projection by default
 * (per-platform titles/keywords, prompt…); `with_links=1` also returns
 * image_link + the upscales array. Newest first; hard-capped at
 * IMAGES_ALL_MAX with an explicit `truncated` flag.
 */
async function listAll(req, res, next) {
  try {
    const withLinks = ['true', '1'].includes(String(req.query.with_links || '').trim().toLowerCase());

    const projection = {
      session_id: 1,
      metadata: 1,
      used: 1,
      used_count: 1,
      prompt: 1,
      ratio: 1,
      quality: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    if (withLinks) {
      projection.image_link = 1;
      projection.upscales = 1;
    }

    const docs = await Image.find({})
      .select(projection)
      .sort({ createdAt: -1, _id: -1 })
      .limit(IMAGES_ALL_MAX + 1)
      .lean();

    const truncated = docs.length > IMAGES_ALL_MAX;
    const data = docs.slice(0, IMAGES_ALL_MAX).map((d) => {
      const plain = Image.plain(d);
      return plain;
    });

    res.json({
      data,
      count: data.length,
      truncated,
      ...(truncated
        ? { note: `Result truncated at ${IMAGES_ALL_MAX} images — page through GET /api/images?limit=100&page=N for the rest.` }
        : {}),
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const image = await Image.findById(req.params.id).lean();
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }
    res.json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const patch = { ...req.validated };

    // legacy flat fields → metadata.adobe_stock (merged with the stored block)
    if (patch.title || patch.category || patch.keywords) {
      const current = await Image.findById(req.params.id).lean();
      if (!current) {
        throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
      }
      const existing = (current.metadata && current.metadata.adobe_stock) || {};
      patch.metadata = {
        ...(patch.metadata || {}),
        adobe_stock: {
          title: patch.title !== undefined ? patch.title : existing.title,
          category: patch.category !== undefined ? patch.category : existing.category,
          keywords: patch.keywords !== undefined ? patch.keywords : existing.keywords,
        },
      };
      delete patch.title;
      delete patch.category;
      delete patch.keywords;
    }

    // used: merge the patch onto the stored flags + refresh the mirror
    if (patch.used || patch.used_in_adobe_stock !== undefined) {
      const current = await Image.findById(req.params.id).lean();
      if (!current) {
        throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
      }
      const used = { ...emptyUsed(), ...(current.used || {}) };
      if (patch.used) {
        for (const id of STOCK_PLATFORM_IDS) {
          if (typeof patch.used[id] === 'boolean') used[id] = patch.used[id];
        }
      }
      if (typeof patch.used_in_adobe_stock === 'boolean') {
        used.adobe_stock = patch.used_in_adobe_stock;
      }
      patch.used = used;
      patch.used_count = usedCount(used);
      delete patch.used_in_adobe_stock;
    }

    if (patch.session_id) {
      const session = await Session.findById(patch.session_id);
      if (!session) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', `Session ${patch.session_id} does not exist`);
      }
    }

    const image = await Image.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }
    res.json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/images/bulk-used
 * Bulk "Mark as used" for the webapp multi-selection: stamps many images
 * and/or upscale variants in ONE request (used: true → Adobe Stock, the
 * primary platform — exactly like the single-image stamp; used: false →
 * clear every platform). Idempotent per target; unknown targets are
 * reported in `missing` instead of failing the whole batch.
 */
async function bulkUsed(req, res, next) {
  try {
    const { used, image_ids = [], upscales = [] } = req.validated;

    // Group the requested targets by parent image — one load + one save per
    // image even when it carries both the image stamp and several variants.
    const byImage = new Map();
    for (const id of image_ids) {
      const entry = byImage.get(String(id)) || { stampImage: false, upscaleIds: new Set() };
      entry.stampImage = true;
      byImage.set(String(id), entry);
    }
    for (const target of upscales) {
      const key = String(target.image_id);
      const entry = byImage.get(key) || { stampImage: false, upscaleIds: new Set() };
      entry.upscaleIds.add(String(target.upscale_id));
      byImage.set(key, entry);
    }

    const images = [];
    const missing = [];
    let marked = 0;

    for (const [imageId, plan] of byImage) {
      const image = await Image.findById(imageId);
      if (!image) {
        if (plan.stampImage) missing.push({ image_id: imageId });
        for (const upscaleId of plan.upscaleIds) {
          missing.push({ image_id: imageId, upscale_id: upscaleId });
        }
        continue;
      }

      if (plan.stampImage) {
        image.used = used
          ? { ...emptyUsed(), ...(image.used || {}), adobe_stock: true }
          : emptyUsed();
        marked += 1;
      }

      for (const upscaleId of plan.upscaleIds) {
        const upscale = image.upscales && image.upscales.id(upscaleId);
        if (!upscale) {
          missing.push({ image_id: imageId, upscale_id: upscaleId });
          continue;
        }
        upscale.used_in_adobe_stock = used;
        marked += 1;
      }

      await image.save(); // pre('save') keeps used_count in sync
      images.push(toPlain(image));
    }

    res.json({ data: { marked, images, missing } });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const image = await Image.findByIdAndDelete(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }
    res.json({ data: { deleted: true } });
  } catch (err) {
    next(err);
  }
}

// ── parallel batch workers: claim / release ─────────────────────────────

/**
 * POST /api/images/claim
 *
 * A parallel batch worker atomically reserves ONE eligible image:
 * upscales count BELOW max_upscales, active, and not in use (or claimed
 * longer than `stale_minutes` ago — a worker that died without releasing).
 * The reservation (in_use: true + in_use_at: now) is written by the SAME
 * findOneAndUpdate that selects the document, so two concurrent workers can
 * never reserve the same image. Oldest images first.
 *
 * Body: { max_upscales?, stale_minutes? } — both optional.
 * Response: 200 { data: <image | null>, claimed: boolean, max_upscales: n }
 * (data: null means "nothing to claim" — the worker exits its loop).
 */
async function claim(req, res, next) {
  try {
    const { max_upscales, stale_minutes } = req.validated;
    const effectiveMax = Math.min(
      max_upscales ?? CONFIG.MAX_UPSCALES_PER_IMAGE,
      UPSCALE_HARD_MAX
    );
    const staleMinutes = stale_minutes ?? CLAIM_STALE_DEFAULT_MINUTES;
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000);

    const filter = {
      // Absent field (= images created before this feature) counts as active.
      active: { $ne: false },
      $or: [
        { in_use: { $ne: true } },
        { in_use_at: { $lt: staleBefore } },
      ],
      $expr: { $lt: [{ $size: { $ifNull: ['$upscales', []] } }, effectiveMax] },
    };

    const doc = await Image.findOneAndUpdate(
      filter,
      { $set: { in_use: true, in_use_at: new Date() } },
      { sort: { createdAt: 1, _id: 1 }, new: true }
    ).lean();

    if (!doc) {
      return res.json({ data: null, claimed: false, max_upscales: effectiveMax });
    }
    res.json({
      data: toPlain(doc),
      claimed: true,
      max_upscales: effectiveMax,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/images/:id/release
 *
 * The worker that claimed an image reports the terminal state of its attempt.
 * Body: { status: 'ok' | 'stopped' | 'error', error_message? }
 *   ok      → in_use: false, in_use_at: null, error_message: ''
 *   stopped → in_use: false, in_use_at: null (run cancelled / limit raced)
 *   error   → in_use: false, in_use_at: null, active: false, error_message: …
 * Always idempotent — releasing an unclaimed image is a harmless no-op,
 * which lets single.py mark failures without claiming first.
 */
async function release(req, res, next) {
  try {
    const { status, error_message } = req.validated;

    const patch = { in_use: false, in_use_at: null };
    if (status === 'ok') patch.error_message = '';
    if (status === 'error') {
      patch.active = false;
      patch.error_message = error_message || 'Unknown upscale failure';
    }

    const image = await Image.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }
    res.json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

// ── download proxy ──────────────────────────────────────────────────────────

// Shared with the Etsy product-image endpoints (utils/proxyImage.js).
const { streamRemoteImage, extFromType } = require('../utils/proxyImage');

function slugify(title) {
  const s = String(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'image';
}

function displayTitle(image) {
  const md = image.metadata || {};
  return (
    (md.adobe_stock && md.adobe_stock.title) ||
    (md.shutterstock && md.shutterstock.description) ||
    (md.istock && md.istock.title) ||
    (md.wirestock && md.wirestock.title) ||
    (md.dreamstime && md.dreamstime.title) ||
    'image'
  );
}

async function download(req, res, next) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    const fallbackExt = (image.image_link.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    await streamRemoteImage(res, image.image_link, {
      filenameBase: `${slugify(displayTitle(image))}_${image._id}`,
      fallbackExt,
      timeoutMs: CONFIG.DOWNLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    next(err);
  }
}

// ── upscales (Real-ESRGAN derivatives registered by GitHub Actions) ─────────

/**
 * POST /api/images/:id/upscales
 * Register one upscaled variant on the image (called by the upscale job).
 * Body: { url, public_id?, scale, model, width?, height?, size_bytes?,
 *         source?, run_id?, max_upscales? }
 * `max_upscales` = the caller's policy (repo secret) — the request is refused
 * with a clear 409 once the image already holds that many upscales.
 */
async function addUpscale(req, res, next) {
  try {
    const { max_upscales, ...entry } = req.validated;

    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    // Effective policy: the caller's max when given, else the server default,
    // capped by the hard ceiling either way.
    const effectiveMax = Math.min(
      max_upscales ?? CONFIG.MAX_UPSCALES_PER_IMAGE,
      UPSCALE_HARD_MAX
    );
    const current = image.upscales ? image.upscales.length : 0;
    if (current >= effectiveMax) {
      throw new HttpError(
        409,
        'UPSCALE_LIMIT_REACHED',
        `Image ${image._id} ("${displayTitle(image)}") already has ${current} upscale${current === 1 ? '' : 's'} — ` +
          `the limit for this operation is ${effectiveMax}. ` +
          'Delete an existing upscale first, or raise the limit (secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE / input max_upscales).'
      );
    }

    image.upscales.push(entry);
    await image.save();
    res.status(201).json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/images/:id/upscales/:upscaleId
 * Update one upscale entry (webapp "Mark used" stamp).
 * Body: { used_in_adobe_stock: boolean }
 */
async function updateUpscale(req, res, next) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${image._id} — it may have been deleted already`
      );
    }

    Object.assign(upscale, req.validated);
    await image.save();
    res.json({ data: toPlain(image) });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/images/:id/upscales/:upscaleId
 * Remove one upscale entry. When Cloudinary is configured on the API and the
 * entry carries a public_id, the remote asset is destroyed too (best-effort —
 * a Cloudinary failure never blocks the database deletion).
 */
async function removeUpscale(req, res, next) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${image._id} — it may have been deleted already`
      );
    }

    const publicId = upscale.public_id;
    upscale.deleteOne();
    await image.save();

    let cloudinary = null;
    if (publicId) {
      const result = await destroyAsset(publicId);
      cloudinary = {
        destroyed: result.destroyed,
        note: result.error || result.result || 'ok',
      };
      if (!result.destroyed) {
        console.warn(
          `[api] upscale ${req.params.upscaleId}: DB entry removed, remote asset kept — ${cloudinary.note}`
        );
      }
    }

    res.json({ data: { deleted: true, upscalesRemaining: image.upscales.length, cloudinary } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/images/:id/upscales/:upscaleId/download
 * Download proxy for an upscaled variant (same behavior as the original's
 * download route: server-side fetch, attachment disposition, clear 502s).
 */
async function downloadUpscale(req, res, next) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${image._id} — it may have been deleted already`
      );
    }

    let upstream;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.DOWNLOAD_TIMEOUT_MS);
      upstream = await fetch(upscale.url, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
    } catch (e) {
      return res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message: `Could not fetch the upscaled image at its source — ${e.name === 'AbortError' ? 'timeout' : e.message}`,
        },
      });
    }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message: `The upscaled image source answered HTTP ${upstream.status} — the stored link may have expired`,
        },
      });
    }

    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = extFromType(type) || (upscale.url.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    const filename = `${slugify(displayTitle(image))}_${image._id}_x${upscale.scale}.${ext}`;

    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', (e) => {
      console.error('[api] upscale download stream error:', e.message);
      if (!res.headersSent) {
        res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Image stream interrupted' } });
      } else {
        res.end();
      }
    });
    nodeStream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  listAll,
  create,
  claim,
  release,
  getOne,
  update,
  bulkUsed,
  remove,
  download,
  addUpscale,
  updateUpscale,
  removeUpscale,
  downloadUpscale,
};
