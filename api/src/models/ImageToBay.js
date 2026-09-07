/**
 * ImageToBay model — one generated stock asset (collection `images_to_bay`)
 * sold INDIVIDUALLY on every stock marketplace, with per-platform upload
 * metadata and per-platform "used" flags.
 *
 * Shape (the owner's spec):
 *
 *   {
 *     session_id, prompt, ratio, quality, image_link,
 *     metadata: {
 *       adobe_stock:    { title, category, keywords: [] },
 *       shutterstock:   { description, categories: [], keywords: [] },
 *       istock:         { title, description, keywords: [] },
 *       wirestock:      { title, description, keywords: [] },
 *       pond5:          { title, description, keywords: [], price },
 *       depositphotos:  { description, keywords: [] },
 *       '123rf':        { description, keywords: [] },
 *       dreamstime:     { title, description, keywords: [] },
 *     },
 *     used:      { adobe_stock: false, shutterstock: false, … },
 *     used_count: 0,
 *     active, in_use, in_use_at, error_message, upscales: [],
 *     createdAt, updatedAt,
 *   }
 *
 * `metadata` is a Mixed object validated at the API layer (zod) — each
 * platform has its own field names/caps, so a rigid subdocument schema would
 * fight the platform differences. `used_count` is a scalar mirror of `used`
 * maintained on every write — it powers sort-by-used and any-platform filters.
 *
 * Legacy compatibility: the API still ACCEPTS the old flat fields
 * (title/category/keywords/used_in_adobe_stock) and maps them into
 * metadata.adobe_stock / used.adobe_stock, and list/get responses still
 * expose flat `title`, `category`, `keywords`, `used_in_adobe_stock`
 * projections derived from the new structure.
 */
const mongoose = require('mongoose');
const { UPSCALE_SOURCES, STOCK_PLATFORM_IDS } = require('../constants');
const { usedCount } = require('../utils/derivePlatformMetadata');

const RATIO_RE = /^(auto|\d{1,2}:\d{1,2})$/i;
const HTTP_URL_RE = /^https?:\/\//;
const SCALE_MIN = 2;
const SCALE_MAX = 8;

const upscaleEntrySchema = {
  url: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2048,
    validate: {
      validator: (v) => HTTP_URL_RE.test(v),
      message: 'upscale url must be an absolute http(s) URL',
    },
  },
  public_id: { type: String, trim: true, maxlength: 512, default: '' },
  scale: {
    type: Number,
    required: true,
    min: [SCALE_MIN, `scale must be ≥ ${SCALE_MIN}`],
    max: [SCALE_MAX, `scale must be ≤ ${SCALE_MAX}`],
  },
  model: { type: String, required: true, trim: true, maxlength: 100 },
  width: { type: Number, min: 1 },
  height: { type: Number, min: 1 },
  size_bytes: { type: Number, min: 0 },
  source: { type: String, enum: UPSCALE_SOURCES, default: 'github-actions' },
  run_id: { type: String, trim: true, maxlength: 64, default: '' },
  used_in_adobe_stock: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
};

const imageSchema = new mongoose.Schema(
  {
    session_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    ratio: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => RATIO_RE.test(v),
        message: 'ratio must look like "16:9" or "Auto"',
      },
    },
    quality: {
      type: String,
      required: true,
      enum: ['1K', '2K', '4K'],
    },
    image_link: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: (v) => /^https?:\/\//.test(v),
        message: 'image_link must be an absolute http(s) URL',
      },
    },

    // ── per-platform upload metadata (validated by the zod schemas) ──
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },

    // ── per-platform published flags + scalar mirror ──
    used: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    used_count: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },

    // ── batch-worker coordination (parallel upscale workflow) ──
    // active: an inactive image is EXCLUDED from every batch claim — set to
    //   false automatically when an upscale attempt hard-fails (with
    //   error_message below), toggled back on from the webapp once fixed.
    // in_use / in_use_at: optimistic lock for the parallel jobs — a worker
    //   claims an image (findOneAndUpdate sets in_use: true + in_use_at),
    //   and MUST release it when done (POST /api/images/:id/release).
    //   A claim older than the stale window (default 30 min) can be reclaimed
    //   by another worker — survives jobs killed without cleanup.
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    in_use: {
      type: Boolean,
      default: false,
      index: true,
    },
    in_use_at: {
      type: Date,
      default: null,
    },
    error_message: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    // ── upscales (Real-ESRGAN derivatives, produced by GitHub Actions) ──
    upscales: {
      type: [upscaleEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collation: { locale: 'en', strength: 2 },
    collection: 'images_to_bay',
  }
);

// Compound index for the most common listing: a session's images, newest first.
imageSchema.index({ session_id: 1, createdAt: -1 });

// Claim query (parallel batch workers): oldest eligible first.
imageSchema.index({ createdAt: 1, _id: 1 });

/** Keep used_count in sync whenever `used` is written through mongoose. */
function syncUsedCount(doc) {
  if (doc && doc.used && typeof doc.used === 'object') {
    doc.used_count = usedCount(doc.used);
  }
}

imageSchema.pre('save', function preSave(next) {
  syncUsedCount(this);
  next();
});

/**
 * Serialize with the legacy flat projections (title/category/keywords/
 * used_in_adobe_stock) so old consumers keep working during the transition.
 */
imageSchema.statics.plain = function plain(doc) {
  if (!doc) return doc;
  const o = doc.toObject ? doc.toObject({ flattenMaps: true }) : doc;
  const md = o.metadata || {};
  const adobe = md.adobe_stock || {};
  const used = o.used || {};
  return {
    ...o,
    _id: String(o._id),
    session_id: String(o.session_id),
    metadata: md,
    used,
    used_in_adobe_stock: used.adobe_stock === true,
    // legacy flat projection (Adobe-first display)
    title: adobe.title || '',
    category: adobe.category || '',
    keywords: Array.isArray(adobe.keywords) ? adobe.keywords : [],
  };
};

module.exports =
  mongoose.models.ImageToBay || mongoose.model('ImageToBay', imageSchema, 'images_to_bay');
