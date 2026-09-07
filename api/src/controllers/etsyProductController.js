/**
 * EtsyProduct controller — CRUD + listing for Etsy digital products
 * (coloring books, invitations, wall-art sets…): one product = one or many
 * images + ONE shared set of Etsy listing metadata.
 */
const EtsyProduct = require('../models/EtsyProduct');
const Session = require('../models/Session');
const { ETSY_PRODUCT_SORT_FIELDS, ETSY_PRODUCT_TYPES } = require('../constants');
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

module.exports = {
  list,
  create,
  getOne,
  update,
  remove,
  addImage,
};
