/**
 * Image model — one generated stock asset with its Adobe Stock upload metadata.
 */
const mongoose = require('mongoose');
const { ADOBE_CATEGORIES } = require('../constants');

const RATIO_RE = /^(auto|\d{1,2}:\d{1,2})$/i;

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
  },
  { timestamps: true, collation: { locale: 'en', strength: 2 } }
);

// Compound index for the most common listing: a session's images, newest first.
imageSchema.index({ session_id: 1, createdAt: -1 });

module.exports = mongoose.models.Image || mongoose.model('Image', imageSchema);
