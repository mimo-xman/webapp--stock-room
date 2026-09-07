/**
 * Per-platform metadata derivation.
 *
 * Every image carries metadata for ALL stock platforms
 * (metadata.adobe_stock, metadata.shutterstock, …). When a writer (agent,
 * webapp, migration) only knows the Adobe Stock fields, this module derives
 * sensible defaults for the other platforms so the CSV export works
 * everywhere from day one. The generation agent is instructed to write the
 * REAL per-platform values — derivation is only the fallback baseline.
 */

const {
  STOCK_PLATFORM_IDS,
  SHUTTERSTOCK_CATEGORIES,
  ADOBE_TO_SHUTTERSTOCK_CATEGORY,
} = require('../constants');

/** Default price (USD) used when a Pond5 price is unknown. */
const POND5_DEFAULT_PRICE = 5;

/** Plain-ASCII text fallback: transliterate common accents, drop the rest. */
function asciiFold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/** Trim to the first N characters on a word boundary. */
function clip(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/**
 * Build the full per-platform metadata object from the Adobe Stock fields.
 * Missing platforms get deterministic defaults:
 *   - title/description reuse the Adobe title (per-platform caps applied)
 *   - keywords reuse the Adobe keywords (relevance order kept, capped)
 *   - Shutterstock gets ONE mapped category from the Adobe category
 *   - Pond5 gets a default price (photos)
 */
function derivePlatformMetadata(adobe, { keywords } = {}) {
  const a = adobe || {};
  const title = String(a.title || '').trim();
  const keywordsAll = (Array.isArray(keywords) ? keywords : a.keywords || [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  const ssCategory =
    ADOBE_TO_SHUTTERSTOCK_CATEGORY[a.category] &&
    SHUTTERSTOCK_CATEGORIES.includes(ADOBE_TO_SHUTTERSTOCK_CATEGORY[a.category])
      ? ADOBE_TO_SHUTTERSTOCK_CATEGORY[a.category]
      : 'Objects';

  const kw = (max) => keywordsAll.slice(0, max);

  return {
    adobe_stock: {
      title,
      category: a.category || '',
      keywords: kw(49),
    },
    shutterstock: {
      description: clip(title, 200),
      categories: [ssCategory],
      keywords: kw(50),
    },
    istock: {
      title: clip(title, 120),
      description: title,
      keywords: kw(50),
    },
    wirestock: {
      title: clip(title, 200),
      description: title,
      keywords: kw(50),
    },
    pond5: {
      title: asciiFold(clip(title, 80)),
      description: asciiFold(title),
      keywords: kw(50).map(asciiFold),
      price: POND5_DEFAULT_PRICE,
    },
    depositphotos: {
      description: asciiFold(clip(title, 250)),
      keywords: kw(50).map(asciiFold),
    },
    '123rf': {
      description: asciiFold(clip(title, 180)),
      keywords: kw(50).map(asciiFold),
    },
    dreamstime: {
      title: clip(title, 250) || title.slice(0, 250),
      description: title,
      keywords: kw(50),
    },
  };
}

/** The `used` object for a fresh image: false everywhere. */
function emptyUsed() {
  return Object.fromEntries(STOCK_PLATFORM_IDS.map((id) => [id, false]));
}

/** Count platforms marked as used (used_count mirror for sort/filter). */
function usedCount(used) {
  if (!used || typeof used !== 'object') return 0;
  return STOCK_PLATFORM_IDS.filter((id) => used[id] === true).length;
}

module.exports = {
  derivePlatformMetadata,
  emptyUsed,
  usedCount,
  POND5_DEFAULT_PRICE,
  asciiFold,
  clip,
};
