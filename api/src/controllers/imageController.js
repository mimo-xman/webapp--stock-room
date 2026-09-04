/**
 * Image controller — CRUD + advanced listing + download proxy + upscales.
 */
const { Readable } = require('node:stream');
const Image = require('../models/Image');
const Session = require('../models/Session');
const { CONFIG } = require('../config');
const { IMAGE_SORT_FIELDS, ADOBE_CATEGORIES, MONGODB_OBJECT_ID_RE, UPSCALE_HARD_MAX, IMAGES_ALL_MAX } = require('../constants');
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
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    ...o,
    _id: String(o._id),
    session_id: String(o.session_id),
  };
}

/** Parse image-specific filters (session_id, category, used, quality, ratio, upscales). */
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

  const f2 = exactFilter(query.category, 'category', ADOBE_CATEGORIES);
  if (f2.problem) problems.push(f2.problem);
  else if (f2.value !== undefined) filters.category = f2.value;

  if (query.used_in_adobe_stock !== undefined && query.used_in_adobe_stock !== '') {
    const v = String(query.used_in_adobe_stock).toLowerCase();
    if (v === 'true') filters.used_in_adobe_stock = true;
    else if (v === 'false') filters.used_in_adobe_stock = false;
    else problems.push({ path: 'used_in_adobe_stock', message: 'used_in_adobe_stock must be "true" or "false"' });
  }

  const f4 = exactFilter(query.quality, 'quality', ['1K', '2K', '4K']);
  if (f4.problem) problems.push(f4.problem);
  else if (f4.value !== undefined) filters.quality = f4.value;

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
      match.$or = [{ title: re }, { prompt: re }, { category: re }, { keywords: re }];
    }
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const dir = order === 'asc' ? 1 : -1;
    const stringSort = ['title', 'prompt', 'category', 'ratio'].includes(sort);
    const collation = stringSort ? { locale: 'en', strength: 2 } : undefined;

    let q = Image.find(match).sort({ [sort]: dir, _id: dir }).skip(skip).limit(limit);
    if (collation) q = q.collation(collation);

    const [docs, total] = await Promise.all([q.lean(), Image.countDocuments(match)]);

    res.json({
      data: docs.map((d) => ({
        ...d,
        _id: String(d._id),
        session_id: String(d.session_id),
      })),
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
    const image = await Image.create(payload);
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
 * (title, category, keywords, prompt…); `with_links=1` also returns
 * image_link + the upscales array. Newest first; hard-capped at
 * IMAGES_ALL_MAX with an explicit `truncated` flag.
 */
async function listAll(req, res, next) {
  try {
    const withLinks = ['true', '1'].includes(String(req.query.with_links || '').trim().toLowerCase());

    const projection = {
      session_id: 1,
      title: 1,
      category: 1,
      keywords: 1,
      prompt: 1,
      ratio: 1,
      quality: 1,
      used_in_adobe_stock: 1,
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
    const data = docs.slice(0, IMAGES_ALL_MAX).map((d) => ({
      ...d,
      _id: String(d._id),
      session_id: String(d.session_id),
    }));

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
    res.json({
      data: { ...image, _id: String(image._id), session_id: String(image.session_id) },
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const patch = req.validated;
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

// ── download proxy ──────────────────────────────────────────────────────────

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

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

async function download(req, res, next) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      throw new HttpError(404, 'NOT_FOUND', `Image ${req.params.id} does not exist`);
    }

    let upstream;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.DOWNLOAD_TIMEOUT_MS);
      upstream = await fetch(image.image_link, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
    } catch (e) {
      return res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message: `Could not fetch the image at its source — ${e.name === 'AbortError' ? 'timeout' : e.message}`,
        },
      });
    }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message: `The image source answered HTTP ${upstream.status} — the stored link may have expired`,
        },
      });
    }

    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type] || (image.image_link.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    const filename = `${slugify(image.title)}_${image._id}.${ext}`;

    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', (e) => {
      console.error('[api] download stream error:', e.message);
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
        `Image ${image._id} ("${image.title}") already has ${current} upscale${current === 1 ? '' : 's'} — ` +
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
    const ext = EXT_BY_TYPE[type] || (upscale.url.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    const filename = `${slugify(image.title)}_${image._id}_x${upscale.scale}.${ext}`;

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
  getOne,
  update,
  remove,
  download,
  addUpscale,
  updateUpscale,
  removeUpscale,
  downloadUpscale,
};
