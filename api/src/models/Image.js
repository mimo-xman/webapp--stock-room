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

module.exports = mongoose.models.Image || mongoose.model('Image', imageSchema);
