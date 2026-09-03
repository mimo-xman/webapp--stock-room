/**
 * Image controller — CRUD + advanced listing + download proxy.
 */
const { Readable } = require('node:stream');
const Image = require('../models/Image');
const Session = require('../models/Session');
const { CONFIG } = require('../config');
const { IMAGE_SORT_FIELDS, ADOBE_CATEGORIES, MONGODB_OBJECT_ID_RE } = require('../constants');
const {
  escapeRegex,
  parseCommonQuery,
  exactFilter,
  paginationMeta,
} = require('../utils/listQuery');
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

/** Parse image-specific filters (session_id, category, used, quality, ratio). */
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

module.exports = { list, create, getOne, update, remove, download };
