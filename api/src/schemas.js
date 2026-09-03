/**
 * Zod schemas — request payloads (write operations).
 */
const { z } = require('zod');
const { ADOBE_CATEGORIES, MONGODB_OBJECT_ID_RE } = require('./constants');

const objectId = z
  .string()
  .regex(MONGODB_OBJECT_ID_RE, 'must be a 24-character MongoDB ObjectId');

const ratio = z
  .string()
  .trim()
  .regex(/^(auto|\d{1,2}:\d{1,2})$/i, 'ratio must look like "16:9" or "Auto"');

const keyword = z.string().trim().min(1, 'keyword cannot be empty').max(60);

const keywords = z
  .array(keyword)
  .min(3, 'at least 3 keywords are required')
  .max(50, 'at most 50 keywords are allowed (Adobe Stock limit)')
  .transform((ks) => [...new Set(ks)]); // dedupe, keep order

const httpUrl = z
  .string()
  .trim()
  .url('image_link must be a valid URL')
  .max(2048)
  .regex(/^https?:\/\//, 'image_link must be an http(s) URL');

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

// ── images ──
const imageCreateSchema = z.object({
  session_id: objectId,
  prompt: z.string().trim().min(1, 'prompt is required').max(2000),
  ratio,
  quality: z.enum(['1K', '2K', '4K'], {
    errorMap: () => ({ message: 'quality must be one of: 1K, 2K, 4K' }),
  }),
  image_link: httpUrl,
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
  keywords,
  used_in_adobe_stock: z.boolean().optional().default(false),
});

const imageUpdateSchema = z
  .object({
    session_id: objectId,
    prompt: z.string().trim().min(1).max(2000),
    ratio,
    quality: z.enum(['1K', '2K', '4K']),
    image_link: httpUrl,
    title: z.string().trim().min(3).max(200),
    category: z.enum(ADOBE_CATEGORIES),
    keywords,
    used_in_adobe_stock: z.boolean(),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'provide at least one field to update',
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

module.exports = {
  verifySchema,
  sessionCreateSchema,
  imageCreateSchema,
  imageUpdateSchema,
  upscaleCreateSchema,
  upscaleUpdateSchema,
};
