/**
 * EtsyProduct controller — CRUD + listing for Etsy digital products
 * (coloring books, invitations, wall-art sets…): one product = one or many
 * images + ONE shared set of Etsy listing metadata.
 *
 * The nested product images carry their OWN upscales / worker fields: the
 * parallel Real-ESRGAN jobs claim them one by one through
 * POST /api/etsy-products/claim and register the results on
 * POST /api/etsy-products/:id/images/:imageId/upscales — the same protocol
 * as the sellable images (images_to_bay), adapted to the nested structure.
 */
const EtsyProduct = require('../models/EtsyProduct');
const Session = require('../models/Session');
const { CONFIG } = require('../config');
const {
  ETSY_PRODUCT_SORT_FIELDS,
  ETSY_PRODUCT_TYPES,
  MONGODB_OBJECT_ID_RE,
  UPSCALE_HARD_MAX,
  CLAIM_STALE_DEFAULT_MINUTES,
} = require('../constants');
const {
  escapeRegex,
  parseCommonQuery,
  exactFilter,
  paginationMeta,
} = require('../utils/listQuery');
const { streamRemoteImage } = require('../utils/proxyImage');
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
  const o = doc.toObject ? doc.toObject({ flattenMaps: true }) : doc;
  return {
    ...o,
    _id: String(o._id),
    session_id: String(o.session_id),
    images: (o.images || []).map((im) => ({
      ...im,
      _id: im._id ? String(im._id) : undefined,
    })),
  };
}

/** 404 on malformed ids (instead of a CastError 500). */
function assertIds(...ids) {
  for (const id of ids) {
    if (!MONGODB_OBJECT_ID_RE.test(String(id))) {
      throw new HttpError(404, 'NOT_FOUND', `Unknown id "${id}" — not a valid MongoDB ObjectId`);
    }
  }
}

function productTitle(product) {
  return (product.metadata && product.metadata.title) || 'Untitled product';
}

function imageLabel(image, index) {
  const caption = (image.caption || '').trim();
  return caption || `image #${index + 1}`;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

/** Load a product + one of its images (404s with clear codes otherwise). */
async function loadProductImage(productId, imageId) {
  assertIds(productId, imageId);
  const product = await EtsyProduct.findById(productId);
  if (!product) {
    throw new HttpError(404, 'NOT_FOUND', `Etsy product ${productId} does not exist`);
  }
  const index = product.images.findIndex(
    (im) => im._id && String(im._id) === String(imageId)
  );
  if (index < 0) {
    throw new HttpError(
      404,
      'IMAGE_NOT_FOUND',
      `Image ${imageId} does not exist on product ${productId} — it may have been removed already`
    );
  }
  return { product, image: product.images[index], index };
}

/** Parse product-specific filters (session_id, product_type, used_in_etsy). */
function parseProductFilters(query) {
  const problems = [];
  const filters = {};

  const f1 = exactFilter(query.session_id, 'session_id');
  if (f1.problem) problems.push(f1.problem);
  else if (f1.value !== undefined) filters.session_id = f1.value;

  const f2 = exactFilter(query.product_type, 'product_type', ETSY_PRODUCT_TYPES);
  if (f2.problem) problems.push(f2.problem);
  else if (f2.value !== undefined) filters.product_type = f2.value;

  if (query.used_in_etsy !== undefined && query.used_in_etsy !== '') {
    const v = String(query.used_in_etsy).toLowerCase();
    if (v === 'true') filters.used_in_etsy = true;
    else if (v === 'false') filters.used_in_etsy = { $ne: true };
    else problems.push({ path: 'used_in_etsy', message: 'used_in_etsy must be "true" or "false"' });
  }

  return { problems, filters };
}

async function list(req, res, next) {
  try {
    const parsed = parseCommonQuery(req.query, ETSY_PRODUCT_SORT_FIELDS);
    if (parsed.problems) return badRequest(res, parsed.problems);
    const { filters, problems } = parseProductFilters(req.query);
    if (problems.length) return badRequest(res, problems);

    const { page, limit, skip, search, sort, order, from, to } = parsed.value;

    const match = { ...filters };
    if (search) {
      const re = { $regex: escapeRegex(search), $options: 'i' };
      match.$or = [
        { 'metadata.title': re },
        { 'metadata.description': re },
        { 'metadata.tags': re },
        { 'images.caption': re },
      ];
    }
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const dir = order === 'asc' ? 1 : -1;
    const sortKeyMap = {
      title: 'metadata.title',
      productType: 'product_type',
      usedInEtsy: 'used_in_etsy',
      imagesCount: 'imagesCount',
    };
    const sortKey = sortKeyMap[sort] || sort;
    const stringSort = ['title', 'metadata.title', 'product_type'].includes(sortKey);
    const collation = stringSort ? { locale: 'en', strength: 2 } : undefined;

    // imagesCount needs the aggregation stage; other sorts go through plain find.
    let docs;
    if (sort === 'imagesCount') {
      docs = await EtsyProduct.aggregate([
        { $match: match },
        { $addFields: { imagesCount: { $size: { $ifNull: ['$images', []] } } } },
        { $sort: { imagesCount: dir, _id: dir } },
        { $skip: skip },
        { $limit: limit },
      ]).collation(collation || { locale: 'en', strength: 2 });
    } else {
      let q = EtsyProduct.find(match)
        .sort({ [sortKey]: dir, _id: dir })
        .skip(skip)
        .limit(limit);
      if (collation) q = q.collation(collation);
      docs = await q.lean();
    }

    const total = await EtsyProduct.countDocuments(match);

    res.json({
      data: docs.map((d) => {
        const plain = toPlain(d);
        plain.imagesCount = (plain.images || []).length;
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
    const product = await EtsyProduct.create(payload);
    res.status(201).json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const product = await EtsyProduct.findById(req.params.id).lean();
    if (!product) {
      throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} does not exist`);
    }
    const plain = toPlain(product);
    plain.imagesCount = (plain.images || []).length;
    res.json({ data: plain });
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
    // metadata: merge the patch onto the stored block (PATCH semantics)
    if (patch.metadata) {
      const current = await EtsyProduct.findById(req.params.id).lean();
      if (!current) {
        throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} does not exist`);
      }
      patch.metadata = { ...(current.metadata || {}), ...patch.metadata };
    }
    const product = await EtsyProduct.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!product) {
      throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} does not exist`);
    }
    res.json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const product = await EtsyProduct.findByIdAndDelete(req.params.id);
    if (!product) {
      throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} does not exist`);
    }
    res.json({ data: { deleted: true } });
  } catch (err) {
    next(err);
  }
}

/** Append one image to a product (the generation agent builds its book page
 *  by page — POST /api/etsy-products creates the product with the cover, then
 *  each finished page is appended here). */
async function addImage(req, res, next) {
  try {
    const { image_link, role, caption, prompt, ratio, quality } = req.validated;
    const product = await EtsyProduct.findById(req.params.id);
    if (!product) {
      throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} does not exist`);
    }
    product.images.push({
      image_link,
      role: role || 'page',
      caption: caption || '',
      prompt: prompt || '',
      ratio: ratio || '',
      quality: quality || '',
      upscales: [],
    });
    await product.save();
    res.status(201).json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

// ── parallel batch workers: claim / release (per nested image) ──────────────

/** How many candidate products each claim attempt inspects before giving up
 *  (a race with another worker simply retries with the next candidate). */
const CLAIM_CANDIDATES = 3;
const CLAIM_ATTEMPTS = 5;

/** Upscale count of a candidate image — accepts BOTH shapes the claim sees:
 *  the full sub-document (upscales = ARRAY of variants) and the aggregation
 *  projection below (upscales = precomputed COUNT via $size).
 *
 *  These two shapes were once mixed up: eligibleImage read the projected
 *  count with Array.isArray() → false → 0, so EVERY image of a candidate
 *  product looked eligible. The claim then reserved the FIRST image of the
 *  array — already at its quota — the worker skipped it, released it, and
 *  the next claim took the very same image again: an infinite claim/skip
 *  ping-pong across every worker. Reading both shapes correctly is the
 *  permanent fix for that loop. */
function imageUpscaleCount(im) {
  if (Array.isArray(im.upscales)) return im.upscales.length;
  const n = Number(im.upscales);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** True when the product image is eligible for a claim: upscales below the
 *  policy max, active (absent field = active), and free (or its claim is
 *  older than the stale window — a worker that died without releasing). */
function eligibleImage(im, effectiveMax, staleBefore) {
  const activeOk = im.active !== false;
  const free = im.in_use !== true || (im.in_use_at && im.in_use_at < staleBefore);
  return imageUpscaleCount(im) < effectiveMax && activeOk && free;
}

/** Query fragment: an image whose upscales array holds FEWER than
 *  `effectiveMax` entries. An array of length L exposes index i iff L > i,
 *  so "index max-1 does not exist" ⟺ count < max — the only way to express
 *  a size comparison inside a plain $elemMatch (no $expr there). Used to
 *  make the atomic reservation re-check the quota, not just in_use. */
function belowQuotaField(effectiveMax) {
  return `upscales.${Math.max(effectiveMax - 1, 0)}`;
}

/** $expr helper: products holding at least one eligible image. */
function hasEligibleImageExpr(effectiveMax, staleBefore) {
  return {
    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ['$images', []] },
              as: 'im',
              cond: {
                $and: [
                  { $lt: [{ $size: { $ifNull: ['$$im.upscales', []] } }, effectiveMax] },
                  { $ne: ['$$im.active', false] },
                  {
                    $or: [
                      { $ne: ['$$im.in_use', true] },
                      { $lt: [{ $ifNull: ['$$im.in_use_at', new Date(0)] }, staleBefore] },
                    ],
                  },
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };
}

/**
 * POST /api/etsy-products/claim
 *
 * A parallel batch worker atomically reserves ONE eligible product image
 * (upscales < max_upscales, active, free — or claimed longer than
 * stale_minutes ago). Two steps on purpose:
 *   1. an aggregation picks the oldest products holding an eligible image;
 *   2. a findOneAndUpdate (the single source of truth) flips in_use on the
 *      chosen sub-document — if another worker won the race, we simply retry
 *      with the next candidate.
 *
 * Body: { max_upscales?, stale_minutes? } — both optional.
 * Response: 200 {
 *   data: {
 *     product_id, image_id, image_index,
 *     product: <plain product>,   // full doc, images included
 *     image:   <plain image>,    // the claimed sub-document (in_use: true)
 *   } | null,
 *   claimed: boolean, max_upscales: n,
 * }
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

    for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
      const candidates = await EtsyProduct.aggregate([
        { $match: hasEligibleImageExpr(effectiveMax, staleBefore) },
        { $sort: { createdAt: 1, _id: 1 } },
        { $limit: CLAIM_CANDIDATES },
        {
          $project: {
            images: {
              $map: {
                input: '$images',
                as: 'im',
                in: {
                  _id: '$$im._id',
                  upscales: { $size: { $ifNull: ['$$im.upscales', []] } },
                  active: '$$im.active',
                  in_use: '$$im.in_use',
                  in_use_at: '$$im.in_use_at',
                },
              },
            },
          },
        },
      ]);

      if (candidates.length === 0) {
        return res.json({ data: null, claimed: false, max_upscales: effectiveMax });
      }

      for (const candidate of candidates) {
        const image = (candidate.images || []).find(
          (im) => im._id && eligibleImage(im, effectiveMax, staleBefore)
        );
        if (!image) continue; // stale candidate view — try the next product

        // The atomic reservation itself: the findOneAndUpdate re-checks that
        // the chosen image is still free AND still below its upscale quota
        // (the aggregation view can be stale — another worker may have just
        // registered the final upscale), so two workers can never reserve
        // the same image, and a just-maxed image is never handed out.
        const doc = await EtsyProduct.findOneAndUpdate(
          {
            _id: candidate._id,
            images: {
              $elemMatch: {
                _id: image._id,
                [belowQuotaField(effectiveMax)]: { $exists: false },
                $or: [
                  { in_use: { $ne: true } },
                  { in_use_at: { $lt: staleBefore } },
                ],
              },
            },
          },
          { $set: { 'images.$[img].in_use': true, 'images.$[img].in_use_at': new Date() } },
          { arrayFilters: [{ 'img._id': image._id }], new: true }
        );
        if (!doc) continue; // lost the race — next candidate

        const plain = toPlain(doc);
        const index = plain.images.findIndex((im) => im._id === String(image._id));
        return res.json({
          data: {
            product_id: plain._id,
            image_id: plain.images[index]._id,
            image_index: index,
            product: plain,
            image: plain.images[index],
          },
          claimed: true,
          max_upscales: effectiveMax,
        });
      }
    }

    // Every candidate lost its race on every attempt — behave like "nothing
    // claimable" for this call; the worker will call again on its next loop.
    return res.json({ data: null, claimed: false, max_upscales: effectiveMax });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/etsy-products/:id/images/:imageId/release
 *
 * The worker that claimed a product image reports the terminal state:
 *   ok      → in_use cleared, error_message cleared
 *   stopped → in_use cleared only (cancelled / limit raced)
 *   error   → in_use cleared + active:false + error_message recorded
 * Idempotent by design (releasing a free image is a no-op), which lets the
 * single-image job report failures without claiming first.
 */
async function releaseImage(req, res, next) {
  try {
    assertIds(req.params.id, req.params.imageId);
    const { status, error_message } = req.validated;

    const patch = {
      'images.$[img].in_use': false,
      'images.$[img].in_use_at': null,
    };
    if (status === 'ok') patch['images.$[img].error_message'] = '';
    if (status === 'error') {
      patch['images.$[img].active'] = false;
      patch['images.$[img].error_message'] = error_message || 'Unknown upscale failure';
    }

    const product = await EtsyProduct.findOneAndUpdate(
      { _id: req.params.id, 'images._id': req.params.imageId },
      { $set: patch },
      { arrayFilters: [{ 'img._id': req.params.imageId }], new: true }
    );
    if (!product) {
      throw new HttpError(404, 'NOT_FOUND', `Etsy product ${req.params.id} (or its image ${req.params.imageId}) does not exist`);
    }
    res.json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

// ── per-image webapp edits (pause / reactivate / dismiss error) ─────────────

/**
 * PATCH /api/etsy-products/:id/images/:imageId
 * Edit one product image from the webapp: caption / role / image_link, and
 * the worker fields — active (pause & reactivate) and error_message
 * (dismiss).
 */
async function updateImage(req, res, next) {
  try {
    const { product, image } = await loadProductImage(req.params.id, req.params.imageId);
    Object.assign(image, req.validated);
    await product.save();
    res.json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/etsy-products/:id/images/:imageId
 * Remove ONE image from a product (webapp edit form). Every upscale entry
 * of that image is destroyed on Cloudinary too (best-effort — same hygiene
 * as DELETE …/upscales/:upscaleId). Refuses to remove the LAST image: an
 * Etsy product always needs at least one (create-time contract).
 */
async function removeImage(req, res, next) {
  try {
    assertIds(req.params.id, req.params.imageId);
    const { product, image } = await loadProductImage(req.params.id, req.params.imageId);

    if (product.images.length <= 1) {
      throw new HttpError(
        409,
        'LAST_IMAGE',
        'An Etsy product needs at least one image — delete the product itself instead'
      );
    }

    const upscales = Array.isArray(image.upscales) ? image.upscales : [];
    image.deleteOne();
    await product.save();

    // Best-effort Cloudinary cleanup for the upscale derivatives of the
    // removed image (the ORIGINAL image file is not ours to delete).
    const destroyed = [];
    const kept = [];
    for (const u of upscales) {
      if (u.public_id) {
        try {
          const result = await destroyAsset(u.public_id);
          if (result.destroyed) destroyed.push(String(u._id));
          else kept.push({ id: String(u._id), note: result.error || result.result || 'not destroyed' });
        } catch (e) {
          kept.push({ id: String(u._id), note: String(e && e.message ? e.message : e) });
        }
      }
    }
    if (kept.length) {
      console.warn(
        `[api] etsy image ${req.params.imageId}: DB entry removed, ${kept.length} remote asset(s) kept — ${kept.map((k) => k.note).join('; ')}`
      );
    }

    res.json({
      data: {
        deleted: true,
        imagesRemaining: product.images.length,
        upscalesDestroyed: destroyed.length,
        cloudinary: destroyed.length + kept.length > 0 ? { destroyed: destroyed.length, kept: kept.length } : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── download proxy (same contract as /api/images/:id/download) ─────────────

/**
 * GET /api/etsy-products/:id/images/:imageId/download
 * Server-side proxy download of ONE product image (avoids CORS, dead-link
 * and ephemeral-source issues; 502 when the origin is unreachable — the
 * Python worker retries those while the origin service wakes up).
 */
async function downloadImage(req, res, next) {
  try {
    const { product, image, index } = await loadProductImage(req.params.id, req.params.imageId);
    const fallbackExt = (image.image_link.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    await streamRemoteImage(res, image.image_link, {
      filenameBase: `${slugify(productTitle(product))}-${slugify(imageLabel(image, index))}`,
      fallbackExt,
      timeoutMs: CONFIG.DOWNLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    next(err);
  }
}

// ── upscales on the nested images (Real-ESRGAN derivatives) ───────────────

/**
 * POST /api/etsy-products/:id/images/:imageId/upscales
 * Register one upscaled variant on a product image (called by the upscale
 * job). Refused with 409 UPSCALE_LIMIT_REACHED once the image already holds
 * max_upscales entries.
 */
async function addUpscale(req, res, next) {
  try {
    const { max_upscales, ...entry } = req.validated;
    const { product, image, index } = await loadProductImage(req.params.id, req.params.imageId);

    const effectiveMax = Math.min(
      max_upscales ?? CONFIG.MAX_UPSCALES_PER_IMAGE,
      UPSCALE_HARD_MAX
    );
    const current = image.upscales ? image.upscales.length : 0;
    if (current >= effectiveMax) {
      throw new HttpError(
        409,
        'UPSCALE_LIMIT_REACHED',
        `Image "${imageLabel(image, index)}" of "${productTitle(product)}" already has ${current} upscale${current === 1 ? '' : 's'} — ` +
          `the limit for this operation is ${effectiveMax}. ` +
          'Delete an existing upscale first, or raise the limit (secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE / input max_upscales).'
      );
    }

    image.upscales.push(entry);
    await product.save();
    res.status(201).json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/etsy-products/:id/images/:imageId/upscales/:upscaleId
 * Update one upscale entry (webapp "Mark used" stamp).
 */
async function updateUpscale(req, res, next) {
  try {
    assertIds(req.params.id, req.params.imageId, req.params.upscaleId);
    const { product, image } = await loadProductImage(req.params.id, req.params.imageId);

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${req.params.imageId} — it may have been deleted already`
      );
    }

    Object.assign(upscale, req.validated);
    await product.save();
    res.json({ data: toPlain(product) });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/etsy-products/:id/images/:imageId/upscales/:upscaleId
 * Remove one upscale entry. When Cloudinary is configured on the API and the
 * entry carries a public_id, the remote asset is destroyed too (best-effort).
 */
async function removeUpscale(req, res, next) {
  try {
    assertIds(req.params.id, req.params.imageId, req.params.upscaleId);
    const { product, image } = await loadProductImage(req.params.id, req.params.imageId);

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${req.params.imageId} — it may have been deleted already`
      );
    }

    const publicId = upscale.public_id;
    upscale.deleteOne();
    await product.save();

    let cloudinary = null;
    if (publicId) {
      const result = await destroyAsset(publicId);
      cloudinary = {
        destroyed: result.destroyed,
        note: result.error || result.result || 'ok',
      };
      if (!result.destroyed) {
        console.warn(
          `[api] etsy upscale ${req.params.upscaleId}: DB entry removed, remote asset kept — ${cloudinary.note}`
        );
      }
    }

    res.json({
      data: {
        deleted: true,
        upscalesRemaining: image.upscales ? image.upscales.length : 0,
        cloudinary,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/etsy-products/:id/images/:imageId/upscales/:upscaleId/download
 * Download proxy for one upscaled variant of a product image.
 */
async function downloadUpscale(req, res, next) {
  try {
    assertIds(req.params.id, req.params.imageId, req.params.upscaleId);
    const { product, image, index } = await loadProductImage(req.params.id, req.params.imageId);

    const upscale = image.upscales && image.upscales.id(req.params.upscaleId);
    if (!upscale) {
      throw new HttpError(
        404,
        'UPSCALE_NOT_FOUND',
        `Upscale ${req.params.upscaleId} does not exist on image ${req.params.imageId} — it may have been deleted already`
      );
    }

    const fallbackExt = (upscale.url.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    await streamRemoteImage(res, upscale.url, {
      filenameBase: `${slugify(productTitle(product))}-${slugify(imageLabel(image, index))}_x${upscale.scale}`,
      fallbackExt,
      timeoutMs: CONFIG.DOWNLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  getOne,
  update,
  remove,
  addImage,
  claim,
  releaseImage,
  updateImage,
  removeImage,
  downloadImage,
  addUpscale,
  updateUpscale,
  removeUpscale,
  downloadUpscale,
};
