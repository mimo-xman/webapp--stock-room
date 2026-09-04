/**
 * Domain constants — Adobe Stock taxonomy + API conventions.
 */

// The 21 official Adobe Stock contributor categories (exact values).
const ADOBE_CATEGORIES = [
  'Animals',
  'Buildings and Architecture',
  'Business',
  'Drinks',
  'The Environment',
  'States of Mind',
  'Food',
  'Graphic Resources',
  'Hobbies and Leisure',
  'Industry',
  'Landscapes',
  'Lifestyle',
  'People',
  'Plants and Flowers',
  'Culture and Religion',
  'Science',
  'Social Issues',
  'Sports',
  'Technology',
  'Transport',
  'Travel',
];

const QUALITIES = ['1K', '2K', '4K'];

// Aspect ratios accepted by the image generation API (zazogptimage2api).
const RATIOS = [
  'Auto', '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
];

// Server-enforced page sizes (the web app must use one of these).
const PAGE_SIZES = [5, 10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

// Sortable fields (whitelists — anything else is a validation error).
const SESSION_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'imagesCount'];
const IMAGE_SORT_FIELDS = [
  'createdAt', 'updatedAt', 'title', 'prompt',
  'category', 'used_in_adobe_stock', 'quality', 'ratio',
];

const MONGODB_OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// GET /api/images/all — safety ceiling (the agent library stays far below;
// beyond it the caller pages through GET /api/images).
const IMAGES_ALL_MAX = 5000;

// Who can append an upscale entry (enum on the subdocument `source` field).
const UPSCALE_SOURCES = ['github-actions', 'manual'];

// Hard server-side ceiling for the upscales array (safety net on top of the
// caller's own policy — see POST /api/images/:id/upscales and docs/UPSCALE.md).
const UPSCALE_HARD_MAX = 10;

// POST /api/images/claim — a claim older than this (minutes) is considered
// stale (worker died without releasing) and can be reclaimed by another worker.
const CLAIM_STALE_DEFAULT_MINUTES = 30;

module.exports = {
  ADOBE_CATEGORIES,
  QUALITIES,
  RATIOS,
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SESSION_SORT_FIELDS,
  IMAGE_SORT_FIELDS,
  MONGODB_OBJECT_ID_RE,
  UPSCALE_SOURCES,
  UPSCALE_HARD_MAX,
  CLAIM_STALE_DEFAULT_MINUTES,
  IMAGES_ALL_MAX,
};
