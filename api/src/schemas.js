/**
 * Zod schemas — request payloads (write operations).
 *
 * Multi-platform metadata: every image stores its upload metadata for EACH
 * stock platform under metadata.<platform_id>. Only the Adobe Stock block is
 * required on create (the historical primary market); the other platforms are
 * optional and auto-derived from it when absent (see
 * utils/derivePlatformMetadata.js — the generation agent is instructed to
 * write the real per-platform values itself).
 */
const { z } = require('zod');
const {
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
  ETSY_PRODUCT_TYPES,
  ETSY_TITLE_MAX,
  ETSY_TAGS_MAX,
  ETSY_TAG_MAX_LEN,
  ETSY_PRICE_MIN,
  MONGODB_OBJECT_ID_RE,
  STOCK_PLATFORM_IDS,
} = require('./constants');

const objectId = z
  .string()
  .regex(MONGODB_OBJECT_ID_RE, 'must be a 24-character MongoDB ObjectId');

const ratio = z
  .string()
  .trim()
  .regex(/^(auto|\d{1,2}:\d{1,2})$/i, 'ratio must look like "16:9" or "Auto"');

const keyword = z.string().trim().min(1, 'keyword cannot be empty').max(60);

const keywords = (min, max, platform) =>
  z
    .array(keyword)
    .min(min, `at least ${min} keywords are required (${platform} minimum)`)
    .max(max, `at most ${max} keywords are allowed (${platform} limit)`)
    .transform((ks) => [...new Set(ks)]); // dedupe, keep order

const httpUrl = z
  .string()
  .trim()
  .url('image_link must be a valid URL')
  .max(2048)
  .regex(/^https?:\/\//, 'image_link must be an http(s) URL');

// ── per-platform metadata blocks ────────────────────────────────────────────

const adobeStockMeta = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters')
    .max(200, 'title must be at most 200 characters (Adobe Stock limit)'),
  category: z.enum(ADOBE_CATEGORIES, {
    errorMap: () => ({
      message: `category must be exactly one of the ${ADOBE_CATEGORIES.length} Adobe Stock categories`,
    }),
  }),
  keywords: keywords(3, 49, 'Adobe Stock'),
});

const shutterstockMeta = z.object({
  description: z
    .string()
    .trim()
    .min(5, 'description must be at least 5 characters')
    .max(200, 'description must be at most 200 characters (Shutterstock limit)'),
  categories: z
    .array(z.enum(SHUTTERSTOCK_CATEGORIES))
    .min(1, 'at least 1 Shutterstock category is required')
    .max(2, 'at most 2 Shutterstock categories are allowed')
    .transform((cs) => [...new Set(cs)]),
  keywords: keywords(7, 50, 'Shutterstock'),
});

const istockMeta = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  keywords: keywords(1, 50, 'iStock'),
});

const wirestockMeta = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(1000),
  keywords: keywords(5, 50, 'Wirestock'),
});

const pond5Meta = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters')
    .max(80, 'title must be at most 80 characters (Pond5 limit)'),
  description: z.string().trim().max(1000).optional().default(''),
  keywords: keywords(5, 50, 'Pond5'),
  price: z.number().positive('price must be a positive USD amount').optional(),
});

const depositphotosMeta = z.object({
  description: z
    .string()
    .trim()
    .min(5, 'description must be at least 5 characters')
    .max(250, 'description must be at most 250 characters (Depositphotos limit)'),
  keywords: keywords(8, 50, 'Depositphotos'),
});

const rf123Meta = z.object({
  description: z
    .string()
    .trim()
    .min(5, 'description must be at least 5 characters')
    .max(180, 'description must be at most 180 characters (123RF limit)'),
  keywords: keywords(7, 50, '123RF'),
});

const dreamstimeMeta = z.object({
  title: z
    .string()
    .trim()
    .min(5, 'title must be at least 5 characters')
    .max(250, 'title must be at most 250 characters (Dreamstime limit)'),
  description: z.string().trim().max(2000).optional().default(''),
  keywords: keywords(7, 50, 'Dreamstime'),
});

const PLATFORM_META_SCHEMAS = {
  adobe_stock: adobeStockMeta,
  shutterstock: shutterstockMeta,
  istock: istockMeta,
  wirestock: wirestockMeta,
  pond5: pond5Meta,
  depositphotos: depositphotosMeta,
  '123rf': rf123Meta,
  dreamstime: dreamstimeMeta,
};

/** metadata object: each present platform block must be valid; the platform
 *  key must be one of the known ids (typo guard). */
const metadataSchema = z
  .object(
    Object.fromEntries(
      STOCK_PLATFORM_IDS.map((id) => [id, PLATFORM_META_SCHEMAS[id].optional()])
    )
  )
  .strict(); // unknown platform keys → error

// ── auth ──
const verifySchema = z.object({
  password: z.string().min(1, 'password is required').max(256),
});

// ── sessions ──
const sessionCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters')
    .max(120, 'title must be at most 120 characters'),
});

// ── images (new multi-platform shape + legacy flat fields) ──
const imageCreateSchema = z
  .object({
    session_id: objectId,
    prompt: z.string().trim().min(1, 'prompt is required').max(2000),
    ratio,
    quality: z.enum(['1K', '2K', '4K'], {
      errorMap: () => ({ message: 'quality must be one of: 1K, 2K, 4K' }),
    }),
    image_link: httpUrl,
    metadata: metadataSchema.optional(),
    // legacy flat fields (pre-multiplatform agents/forms) — mapped onto
    // metadata.adobe_stock by the controller when metadata is absent
    title: z.string().trim().min(3).max(200).optional(),
    category: z.enum(ADOBE_CATEGORIES).optional(),
    keywords: keywords(3, 50, 'legacy flat').optional(),
    // per-platform published flags (default false everywhere)
    used: z
      .object(
        Object.fromEntries(STOCK_PLATFORM_IDS.map((id) => [id, z.boolean().optional()]))
      )
      .optional(),
    used_in_adobe_stock: z.boolean().optional(), // legacy alias for used.adobe_stock
  })
  .refine(
    (v) => v.metadata?.adobe_stock || (v.title && v.category && v.keywords),
    {
      message:
        'provide either metadata.adobe_stock {title, category, keywords} or the legacy flat title/category/keywords fields',
      path: ['metadata'],
    }
  );

const imageUpdateSchema = z
  .object({
    session_id: objectId,
    prompt: z.string().trim().min(1).max(2000),
    ratio,
    quality: z.enum(['1K', '2K', '4K']),
    image_link: httpUrl,
    metadata: metadataSchema.partial().optional(), // patch platform blocks wholesale
    used: z
      .object(
        Object.fromEntries(STOCK_PLATFORM_IDS.map((id) => [id, z.boolean().optional()]))
      )
      .optional(),
    used_in_adobe_stock: z.boolean().optional(), // legacy alias
    // legacy flat fields (pre-multiplatform clients) — merged onto
    // metadata.adobe_stock by the controller
    title: z.string().trim().min(3).max(200).optional(),
    category: z.enum(ADOBE_CATEGORIES).optional(),
    keywords: keywords(3, 50, 'legacy flat').optional(),
    // Batch-worker coordination (webapp "Active/Paused" toggle + error dismissal).
    active: z.boolean(),
    error_message: z.string().trim().max(2000, 'error_message must be at most 2000 characters'),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'provide at least one field to update',
  });

// ── parallel batch workers (claim / release) ──
// POST /api/images/claim — a batch worker atomically reserves the oldest
// eligible image (upscales < max_upscales, active, not already claimed —
// or claimed long enough ago to be considered stale). Returns {data: null}
// when nothing is claimable.
const imageClaimSchema = z.object({
  max_upscales: z
    .number({ invalid_type_error: 'max_upscales must be a number' })
    .int('max_upscales must be an integer')
    .min(1, 'max_upscales must be at least 1')
    .max(10, 'max_upscales must be at most 10')
    .optional(),
  stale_minutes: z
    .number({ invalid_type_error: 'stale_minutes must be a number' })
    .int('stale_minutes must be an integer')
    .min(1, 'stale_minutes must be at least 1')
    .max(1440, 'stale_minutes must be at most 1440 (24h)')
    .optional(),
});

// POST /api/images/:id/release — the worker that claimed an image reports
// the terminal state of its attempt:
//   ok      → in_use cleared, error_message cleared (success)
//   stopped → in_use cleared only (cancelled / limit raced / skipped-neutral)
//   error   → in_use cleared + active set to false + error_message recorded
const imageReleaseSchema = z
  .object({
    status: z.enum(['ok', 'stopped', 'error'], {
      errorMap: () => ({ message: 'status must be one of: ok, stopped, error' }),
    }),
    error_message: z
      .string()
      .trim()
      .min(1, 'error_message is required when status is "error"')
      .max(2000, 'error_message must be at most 2000 characters')
      .optional(),
  })
  .refine((s) => s.status !== 'error' || Boolean(s.error_message), {
    message: 'error_message is required when status is "error"',
    path: ['error_message'],
  });

// ── upscales ──
// POST /api/images/:id/upscales — the upscale job (GitHub Actions) registers
// a new Real-ESRGAN derivative on the image. `max_upscales` is the caller's
// policy (repo secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE by default): the API
// answers 409 UPSCALE_LIMIT_REACHED when the image already holds that many.
const upscaleCreateSchema = z.object({
  url: httpUrl,
  public_id: z.string().trim().max(512).optional().default(''),
  scale: z
    .number({ invalid_type_error: 'scale must be a number' })
    .int('scale must be an integer')
    .min(2, 'scale must be at least 2')
    .max(8, 'scale must be at most 8'),
  model: z.string().trim().min(1, 'model is required').max(100),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  source: z.enum(['github-actions', 'manual']).optional().default('github-actions'),
  run_id: z.string().trim().max(64).optional().default(''),
  max_upscales: z
    .number({ invalid_type_error: 'max_upscales must be a number' })
    .int('max_upscales must be an integer')
    .min(1, 'max_upscales must be at least 1')
    .max(10, 'max_upscales must be at most 10')
    .optional(),
});

// PATCH /api/images/:id/upscales/:upscaleId — webapp "Mark used" toggle.
const upscaleUpdateSchema = z
  .object({
    used_in_adobe_stock: z.boolean(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'provide at least one field to update',
  });

// ── Etsy products ───────────────────────────────────────────────────────────

const etsyProductImageSchema = z.object({
  image_link: httpUrl,
  role: z.enum(['cover', 'page', 'asset', 'preview']).optional().default('page'),
  caption: z.string().trim().max(200).optional().default(''),
  prompt: z.string().trim().max(2000).optional().default(''),
  ratio: z.string().trim().max(12).optional().default(''),
  quality: z.enum(['1K', '2K', '4K']).optional(),
});

const etsyTags = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'tag cannot be empty')
      .max(ETSY_TAG_MAX_LEN, `each Etsy tag must be at most ${ETSY_TAG_MAX_LEN} characters`)
  )
  .max(ETSY_TAGS_MAX, `Etsy allows at most ${ETSY_TAGS_MAX} tags`)
  .transform((ts) => [...new Set(ts.map((t) => t.toLowerCase()))]);

const etsyMetadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters')
    .max(ETSY_TITLE_MAX, `title must be at most ${ETSY_TITLE_MAX} characters (Etsy limit)`),
  description: z.string().trim().min(10, 'description must be at least 10 characters').max(20000),
  tags: etsyTags.optional().default([]),
  category: z
    .string()
    .trim()
    .max(200, 'category (Etsy taxonomy path) must be at most 200 characters')
    .optional()
    .default(''),
  price: z
    .number({ invalid_type_error: 'price must be a number (USD)' })
    .min(ETSY_PRICE_MIN, `Etsy minimum listing price is $${ETSY_PRICE_MIN}`)
    .optional(),
});

const etsyProductCreateSchema = z
  .object({
    session_id: objectId,
    product_type: z.enum(ETSY_PRODUCT_TYPES).optional().default('digital_download'),
    images: z.array(etsyProductImageSchema).min(1, 'at least one image is required').max(200),
    metadata: etsyMetadataSchema,
    file_link: httpUrl.optional().default(''),
    used_in_etsy: z.boolean().optional().default(false),
  })
  .refine((v) => !v.file_link || v.file_link !== '', {
    message: 'file_link must be an http(s) URL when provided',
    path: ['file_link'],
  });

const etsyProductUpdateSchema = z
  .object({
    session_id: objectId,
    product_type: z.enum(ETSY_PRODUCT_TYPES),
    images: z.array(etsyProductImageSchema).min(1).max(200),
    metadata: etsyMetadataSchema.partial(),
    file_link: z.union([httpUrl, z.literal('')]),
    used_in_etsy: z.boolean(),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'provide at least one field to update',
  });

// POST /api/etsy-products/:id/images — append ONE image (a finished page)
// to an existing product (the agent builds its book page by page).
const etsyProductAddImageSchema = z.object({
  image_link: httpUrl,
  role: z.enum(['cover', 'page', 'asset', 'preview']).optional().default('page'),
  caption: z.string().trim().max(200).optional().default(''),
  prompt: z.string().trim().max(2000).optional().default(''),
  ratio: z.string().trim().max(12).optional().default(''),
  quality: z.enum(['1K', '2K', '4K']).optional(),
});

module.exports = {
  verifySchema,
  sessionCreateSchema,
  imageCreateSchema,
  imageUpdateSchema,
  imageClaimSchema,
  imageReleaseSchema,
  upscaleCreateSchema,
  upscaleUpdateSchema,
  etsyProductCreateSchema,
  etsyProductUpdateSchema,
  etsyProductAddImageSchema,
};
