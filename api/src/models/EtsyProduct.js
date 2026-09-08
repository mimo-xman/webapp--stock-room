/**
 * EtsyProduct model — one DIGITAL product sold on Etsy (collection
 * `etsy_products`). Coloring books are just one product type: a product is
 * one or several images bundled into a deliverable (PDF / ZIP / image set)
 * that share ONE set of Etsy listing metadata.
 *
 * Shape (the owner's spec):
 *
 *   {
 *     session_id,
 *     product_type: 'coloring_book' | 'party_invitations' | …,
 *     images: [ { image_link, role: cover|page|asset|preview|marketing,
 *                 caption, ratio, quality, upscales: [],
 *                 active, in_use, in_use_at, error_message } ],
 *     metadata: { title, description, tags: [], category, price, … },
 *     file_link,        // optional ready deliverable (PDF / ZIP)
 *     used_in_etsy,     // published on Etsy?
 *     createdAt, updatedAt,
 *   }
 *
 * `marketing` images are the ANNOUNCEMENT images: the listing photos that
 * present the product on Etsy (mockups, "what's inside" collages, samples).
 * They are generated alongside the product images and upscale exactly like
 * every other image in the array.
 *
 * Etsy listing limits (official, validated at the API layer):
 *   title ≤ 140 chars · 13 tags max, each ≤ 20 chars · price ≥ $0.20.
 * `category` is a free-text Etsy taxonomy path — the taxonomy tree is too
 * large to embed, so the generation agent researches and picks the path.
 */
const mongoose = require('mongoose');
const { UPSCALE_SOURCES, ETSY_PRODUCT_TYPES, ETSY_IMAGE_ROLES } = require('../constants');

const HTTP_URL_RE = /^https?:\/\//;

const productImageSchema = new mongoose.Schema(
  {
    image_link: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: (v) => HTTP_URL_RE.test(v),
        message: 'image_link must be an absolute http(s) URL',
      },
    },
    role: {
      type: String,
      enum: ETSY_IMAGE_ROLES,
      default: 'page',
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    /** The exact generation prompt that produced this image (agent traceability). */
    prompt: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    ratio: { type: String, trim: true, maxlength: 12, default: '' },
    quality: { type: String, enum: ['1K', '2K', '4K', ''], default: '' },
    /** Carries the Real-ESRGAN derivatives when a product is migrated from
     *  the legacy images collection (same shape as ImageToBay upscales). */
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
          public_id: { type: String, trim: true, maxlength: 512, default: '' },
          scale: { type: Number, required: true, min: 2, max: 8 },
          model: { type: String, required: true, trim: true, maxlength: 100 },
          width: { type: Number, min: 1 },
          height: { type: Number, min: 1 },
          size_bytes: { type: Number, min: 0 },
          source: { type: String, enum: UPSCALE_SOURCES, default: 'github-actions' },
          run_id: { type: String, trim: true, maxlength: 64, default: '' },
          used_in_adobe_stock: { type: Boolean, default: false },
          created_at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    // ── parallel batch-worker coordination (same semantics as ImageToBay) ──
    // active: a paused image is EXCLUDED from every etsy claim — set to false
    //   by a release 'error' (with error_message), toggled back on from the
    //   webapp once fixed. Absent field = active (pre-feature documents).
    // in_use / in_use_at: optimistic lock for the parallel upscale jobs — a
    //   worker claims an image (findOneAndUpdate sets in_use: true + a
    //   timestamp), releases it when done; a claim older than the stale
    //   window (default 30 min) is considered dead and reclaimable.
    active: {
      type: Boolean,
      default: true,
    },
    in_use: {
      type: Boolean,
      default: false,
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
  },
  { _id: true }
);

const etsyProductSchema = new mongoose.Schema(
  {
    session_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    product_type: {
      type: String,
      enum: ETSY_PRODUCT_TYPES,
      default: 'digital_download',
      index: true,
    },
    images: {
      type: [productImageSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'an Etsy product needs at least one image',
      },
    },
    // Etsy listing metadata — validated by the zod schemas.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    // Optional ready deliverable (the assembled PDF / ZIP on Cloudinary).
    file_link: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: '',
      validate: {
        validator: (v) => !v || HTTP_URL_RE.test(v),
        message: 'file_link must be an absolute http(s) URL',
      },
    },
    used_in_etsy: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true, collation: { locale: 'en', strength: 2 } }
);

etsyProductSchema.index({ session_id: 1, createdAt: -1 });

module.exports =
  mongoose.models.EtsyProduct || mongoose.model('EtsyProduct', etsyProductSchema, 'etsy_products');
