/**
 * Domain constants — multi-platform stock taxonomy + API conventions.
 *
 * Stock Room sells the same generated image on SEVERAL marketplaces. Every
 * platform has its own upload metadata (title/description/category/keywords
 * caps and category lists) and, for five of them, a documented bulk CSV
 * upload format. Everything platform-specific lives here so the models,
 * schemas, controllers, the CSV builders in the webapp and the agent prompts
 * all share ONE source of truth.
 */

// ── the stock marketplaces (wire keys = DB metadata.<id> keys) ──────────────

const STOCK_PLATFORMS = [
  {
    id: 'adobe_stock',
    label: 'Adobe Stock',
    // The 21 official Adobe Stock contributor categories (exact values).
    categories: [
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
    ],
    keywordsMin: 3,
    keywordsMax: 49, // Adobe's CSV cap (50 per docs — 49 keeps us safe)
    titleMax: 200,
    aiContent: 'accepted', // as Generative AI content, labeled
    note: 'CSV: Filename,Title,Keywords,Category — upload images first, then import the CSV in the Contributor portal.',
  },
  {
    id: 'shutterstock',
    label: 'Shutterstock',
    // The 26 official Shutterstock photo categories (exact values, from the
    // contributor help center CSV spec — 1 or 2 categories per file).
    categories: [
      'Abstract',
      'Animals/Wildlife',
      'Arts',
      'Backgrounds/Textures',
      'Beauty/Fashion',
      'Buildings/Landmarks',
      'Business/Finance',
      'Celebrities',
      'Education',
      'Food and drink',
      'Healthcare/Medical',
      'Holidays',
      'Industrial',
      'Interiors',
      'Miscellaneous',
      'Nature',
      'Objects',
      'Parks/Outdoor',
      'People',
      'Religion',
      'Science',
      'Signs/Symbols',
      'Sports/Recreation',
      'Technology',
      'Transportation',
      'Vintage',
    ],
    categoriesMax: 2,
    keywordsMin: 7,
    keywordsMax: 50,
    descriptionMax: 200,
    aiContent: 'verify', // policy evolves — the agent must check it at run time
    note: 'CSV: Filename,Description,Keywords,Categories — uploaded via the Submit page CSV button (NOT with the files).',
  },
  {
    id: 'istock',
    label: 'iStock / Getty',
    categories: [],
    keywordsMin: 0,
    keywordsMax: 50,
    titleMax: 120,
    descriptionMax: 2000,
    aiContent: 'refused', // iStock/Getty ask for non-AI samples at application
    note: 'No public bulk CSV. AI-generated content currently NOT accepted — verify before uploading.',
  },
  {
    id: 'wirestock',
    label: 'Wirestock',
    categories: [],
    keywordsMin: 5,
    keywordsMax: 50,
    titleMax: 200,
    descriptionMax: 1000,
    aiContent: 'accepted', // with disclosure
    note: 'No public CSV. AI content accepted but MUST be disclosed in title, description and keywords. Wirestock redistributes to partner platforms.',
  },
  {
    id: 'pond5',
    label: 'Pond5',
    categories: [],
    keywordsMin: 5,
    keywordsMax: 50,
    titleMax: 80,
    descriptionMax: 1000,
    aiContent: 'refused',
    note: 'CSV template: originalfilename,title,description,keywords,price (plain ASCII, no quotes/special chars). AI-generated content currently NOT accepted.',
  },
  {
    id: 'depositphotos',
    label: 'Depositphotos',
    categories: [],
    keywordsMin: 8, // validated at save time (spell-checked)
    keywordsMax: 50,
    descriptionMax: 250,
    aiContent: 'refused',
    note: 'No public CSV. AI-generated images NOT accepted. Min 8 spell-checked keywords, plain-ASCII descriptions.',
  },
  {
    id: '123rf',
    label: '123RF',
    categories: [],
    keywordsMin: 7,
    keywordsMax: 50,
    descriptionMax: 180,
    aiContent: 'accepted',
    note: 'CSV: "oldfilename","123rf_filename","description","keywords","country" — every field quoted, ≤ 2 MB.',
  },
  {
    id: 'dreamstime',
    label: 'Dreamstime',
    categories: [],
    keywordsMin: 7,
    keywordsMax: 50,
    titleMax: 250, // 5–250 characters
    descriptionMax: 2000,
    aiContent: 'accepted', // no AI people (we generate none anyway)
    note: 'CSV: Filename,Title,Description,Keywords — imported on the unfinished-uploads screen.',
  },
];

const STOCK_PLATFORM_IDS = STOCK_PLATFORMS.map((p) => p.id);

// Legacy alias kept for readability in a few places.
const ADOBE_CATEGORIES = STOCK_PLATFORMS[0].categories;
const SHUTTERSTOCK_CATEGORIES = STOCK_PLATFORMS[1].categories;

/** Adobe category → closest Shutterstock category (fallback derivation only —
 *  the generation agent writes the real per-platform values). */
const ADOBE_TO_SHUTTERSTOCK_CATEGORY = {
  Animals: 'Animals/Wildlife',
  'Buildings and Architecture': 'Buildings/Landmarks',
  Business: 'Business/Finance',
  Drinks: 'Food and drink',
  'The Environment': 'Nature',
  'States of Mind': 'Abstract',
  Food: 'Food and drink',
  'Graphic Resources': 'Backgrounds/Textures',
  'Hobbies and Leisure': 'Objects',
  Industry: 'Industrial',
  Landscapes: 'Nature',
  Lifestyle: 'Interiors',
  People: 'People',
  'Plants and Flowers': 'Nature',
  'Culture and Religion': 'Religion',
  Science: 'Science',
  'Social Issues': 'Miscellaneous',
  Sports: 'Sports/Recreation',
  Technology: 'Technology',
  Transport: 'Transportation',
  Travel: 'Parks/Outdoor',
};

// ── Etsy digital products ───────────────────────────────────────────────────

/** The kinds of digital products sold on Etsy (coloring book is just one). */
const ETSY_PRODUCT_TYPES = [
  'coloring_book',
  'activity_book',
  'party_invitations',
  'wall_art_set',
  'printable_set',
  'clipart_bundle',
  'digital_download',
  'other',
];

// Etsy listing limits (official): title ≤ 140 chars, 13 tags ≤ 20 chars each.
const ETSY_TITLE_MAX = 140;
const ETSY_TAGS_MAX = 13;
const ETSY_TAG_MAX_LEN = 20;
const ETSY_PRICE_MIN = 0.2;

// ── generation / listing conventions ────────────────────────────────────────

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
const SESSION_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'imagesCount', 'productsCount'];
const IMAGE_SORT_FIELDS = [
  'createdAt', 'updatedAt', 'title', 'prompt',
  'category', 'used', 'quality', 'ratio',
];
const ETSY_PRODUCT_SORT_FIELDS = [
  'createdAt', 'updatedAt', 'title', 'productType', 'usedInEtsy', 'imagesCount',
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
  STOCK_PLATFORMS,
  STOCK_PLATFORM_IDS,
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
  ADOBE_TO_SHUTTERSTOCK_CATEGORY,
  ETSY_PRODUCT_TYPES,
  ETSY_TITLE_MAX,
  ETSY_TAGS_MAX,
  ETSY_TAG_MAX_LEN,
  ETSY_PRICE_MIN,
  QUALITIES,
  RATIOS,
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SESSION_SORT_FIELDS,
  IMAGE_SORT_FIELDS,
  ETSY_PRODUCT_SORT_FIELDS,
  MONGODB_OBJECT_ID_RE,
  UPSCALE_SOURCES,
  UPSCALE_HARD_MAX,
  CLAIM_STALE_DEFAULT_MINUTES,
  IMAGES_ALL_MAX,
};
