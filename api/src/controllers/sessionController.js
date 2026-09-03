/**
 * Session controller.
 *
 * NOTE: sessions are intentionally NOT editable (per product spec the web app
 * user may only modify Images). Sessions can be created, listed and deleted.
 */
const Session = require('../models/Session');
const Image = require('../models/Image');
const { SESSION_SORT_FIELDS } = require('../constants');
const {
  escapeRegex,
  parseCommonQuery,
  paginationMeta,
} = require('../utils/listQuery');
const { HttpError } = require('../middleware/errorHandler');

function toPlain(doc, extra = {}) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    ...o,
    _id: String(o._id),
    ...(o.session_id !== undefined ? { session_id: String(o.session_id) } : {}),
    ...extra,
  };
}

async function list(req, res, next) {
  try {
    const parsed = parseCommonQuery(req.query, SESSION_SORT_FIELDS);
    if (parsed.problems) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `Invalid data — ${parsed.problems[0].message}`, details: parsed.problems },
      });
    }
    const { page, limit, skip, search, sort, order, from, to } = parsed.value;

    const match = {};
    if (search) match.title = { $regex: escapeRegex(search), $options: 'i' };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const dir = order === 'asc' ? 1 : -1;
    const collation = { locale: 'en', strength: 2 };

    const [docs, total] = await Promise.all([
      Session.aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'images',
            localField: '_id',
            foreignField: 'session_id',
            as: 'sessionImages',
            pipeline: [{ $project: { _id: 1, used_in_adobe_stock: 1 } }],
          },
        },
        {
          $addFields: {
            imagesCount: { $size: '$sessionImages' },
            usedCount: {
              $size: {
                $filter: {
                  input: '$sessionImages',
                  as: 'im',
                  cond: { $eq: ['$$im.used_in_adobe_stock', true] },
                },
              },
            },
          },
        },
        { $project: { sessionImages: 0, __v: 0 } },
        { $sort: { [sort]: dir, _id: dir } },
        { $skip: skip },
        { $limit: limit },
      ]).collation(collation),
      Session.countDocuments(match),
    ]);

    res.json({
      data: docs.map((d) => ({
        _id: String(d._id),
        title: d.title,
        imagesCount: d.imagesCount,
        usedCount: d.usedCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      pagination: paginationMeta({ page, limit, total }),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { title } = req.validated;
    const session = await Session.create({ title });
    res.status(201).json({ data: toPlain(session) });
  } catch (err) {
    next(err); // 11000 duplicate → 409 via errorHandler
  }
}

async function getOne(req, res, next) {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      throw new HttpError(404, 'NOT_FOUND', `Session ${req.params.id} does not exist`);
    }
    const [imagesCount, usedCount] = await Promise.all([
      Image.countDocuments({ session_id: session._id }),
      Image.countDocuments({ session_id: session._id, used_in_adobe_stock: true }),
    ]);
    res.json({ data: { ...toPlain(session), imagesCount, usedCount } });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      throw new HttpError(404, 'NOT_FOUND', `Session ${req.params.id} does not exist`);
    }
    // Cascade: a session's images die with it.
    const { deletedCount } = await Image.deleteMany({ session_id: session._id });
    await session.deleteOne();
    res.json({ data: { deleted: true, imagesDeleted: deletedCount } });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, getOne, remove };
