/**
 * Image model — one generated stock asset with its Adobe Stock upload metadata.
 */
const mongoose = require('mongoose');
const { ADOBE_CATEGORIES, UPSCALE_SOURCES } = require('../constants');

const RATIO_RE = /^(auto|\d{1,2}:\d{1,2})$/i;
const HTTP_URL_RE = /^https?:\/\//;
const SCALE_MIN = 2;
const SCALE_MAX = 8;

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
    // Adobe Stock upload metadata
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 200,
    },
    category: {
      type: String,
      required: true,
      enum: ADOBE_CATEGORIES,
      index: true,
    },
    keywords: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) =>
          Array.isArray(arr) &&
          arr.length >= 3 &&
          arr.length <= 50 &&
          arr.every((k) => typeof k === 'string' && k.trim().length >= 1 && k.length <= 60),
        message: 'keywords must contain between 3 and 50 non-empty entries (max 60 chars each)',
      },
    },
    used_in_adobe_stock: {
      type: Boolean,
      default: false,
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
    // NOTE: images created before this feature have NO active/in_use fields —
    // queries must treat "absent" as active:true / in_use:false ($ne filters).
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
    // One entry per upscaled variant, appended via POST /api/images/:id/upscales.
    // The entry count is the "number of upscales" compared against the policy
    // limit (secrets: MAX_NUMBER_OF_UPSCALES_PER_IMAGE — see docs/UPSCALE.md).
    upscales: {
      type: [
        {
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
          public_id: {
            type: String,
            trim: true,
            maxlength: 512,
            default: '',
          },
          scale: {
            type: Number,
            required: true,
            min: [SCALE_MIN, `scale must be ≥ ${SCALE_MIN}`],
            max: [SCALE_MAX, `scale must be ≤ ${SCALE_MAX}`],
          },
          model: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
          },
          width: { type: Number, min: 1 },
          height: { type: Number, min: 1 },
          size_bytes: { type: Number, min: 0 },
          source: {
            type: String,
            enum: UPSCALE_SOURCES,
            default: 'github-actions',
          },
          run_id: {
            type: String,
            trim: true,
            maxlength: 64,
            default: '',
          },
          used_in_adobe_stock: {
            type: Boolean,
            default: false,
          },
          created_at: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
      // No index: the batch job filters on the array *count* via $expr/$size,
      // which MongoDB cannot serve from an index anyway.
    },
  },
  { timestamps: true, collation: { locale: 'en', strength: 2 } }
);

// Compound index for the most common listing: a session's images, newest first.
imageSchema.index({ session_id: 1, createdAt: -1 });

// Claim query (parallel batch workers): oldest eligible first. Partial-ish
// coverage via the single-field indexes above is enough — the eligibility
// filter is dominated by $expr on the upscales array (unindexable anyway).
imageSchema.index({ createdAt: 1, _id: 1 });

module.exports = mongoose.models.Image || mongoose.model('Image', imageSchema);
