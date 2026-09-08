/**
 * Claims controller — visibility + emergency release for the in_use
 * reservations written by the parallel upscale workers.
 *
 * A worker that dies WITHOUT releasing (a force-stopped GitHub Actions run,
 * a cancelled job whose SIGTERM never reached Python, a crashed runner…)
 * leaves images locked: in_use stays true and in_use_at stays set, so the
 * next batch sees them as "currently being processed" and skips them until
 * the stale window (30 min by default) makes them reclaimable.
 *
 * This controller gives the webapp an immediate manual unlock:
 *
 *   GET  /api/claims           → every currently-claimed image, both sources
 *   POST /api/claims/release   → clear them all (or one source) at once
 *
 * Releasing only touches the reservation fields (in_use, in_use_at) —
 * upscales, active and error_message are never modified.
 */
const Image = require('../models/ImageToBay');
const EtsyProduct = require('../models/EtsyProduct');

function countUpscales(doc) {
  return Array.isArray(doc && doc.upscales) ? doc.upscales.length : 0;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

/** Oldest-first sort key for nested claims (products carry no in_use_at
 *  themselves — the per-image timestamp does). */
function claimSortKey(claim) {
  return claim.in_use_at || '0';
}

/**
 * GET /api/claims
 *
 * Response: 200 {
 *   data: {
 *     total: n,
 *     images: [ { _id, title, in_use_at, upscales, active } ],
 *     etsy:   [ { product_id, product_title, image_id, image_index,
 *                 role, caption, in_use_at, upscales, active } ],
 *   }
 * }
 */
async function list(req, res, next) {
  try {
    const [imageDocs, productDocs] = await Promise.all([
      Image.find({ in_use: true }).sort({ in_use_at: 1, _id: 1 }).lean(),
      EtsyProduct.find({ 'images.in_use': true }).lean(),
    ]);

    const images = imageDocs.map((d) => ({
      _id: String(d._id),
      title: d.title || (d.metadata && d.metadata.adobe_stock && d.metadata.adobe_stock.title) || '',
      in_use_at: toIso(d.in_use_at),
      upscales: countUpscales(d),
      active: d.active !== false,
    }));

    const etsy = [];
    for (const product of productDocs) {
      (product.images || []).forEach((im, index) => {
        if (!im || im.in_use !== true) return;
        etsy.push({
          product_id: String(product._id),
          product_title: (product.metadata && product.metadata.title) || '',
          image_id: im._id ? String(im._id) : null,
          image_index: index,
          role: im.role || 'page',
          caption: im.caption || '',
          in_use_at: toIso(im.in_use_at),
          upscales: countUpscales(im),
          active: im.active !== false,
        });
      });
    }
    etsy.sort((a, b) => String(claimSortKey(a)).localeCompare(String(claimSortKey(b))));

    res.json({ data: { total: images.length + etsy.length, images, etsy } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/claims/release
 *
 * Body: { source?: 'images' | 'etsy' | 'all' } — defaults to 'all'.
 *
 * Clears in_use / in_use_at on every matching reservation. Idempotent by
 * design (releasing nothing returns zeros). Response: 200 {
 *   data: { source, images_released, etsy_images_released, total }
 * }
 */
async function release(req, res, next) {
  try {
    const { source } = req.validated;

    let imagesReleased = 0;
    let etsyReleased = 0;

    if (source === 'images' || source === 'all') {
      // Count first: updateMany reports matched/modified DOCUMENTS, which
      // is the same thing here — one document = one reservation.
      imagesReleased = await Image.countDocuments({ in_use: true });
      if (imagesReleased > 0) {
        await Image.updateMany(
          { in_use: true },
          { $set: { in_use: false, in_use_at: null } }
        );
      }
    }

    if (source === 'etsy' || source === 'all') {
      // updateMany would count PRODUCTS, not nested images — expand and
      // count the claimed sub-documents first, then bulk-release them.
      const productDocs = await EtsyProduct.find({ 'images.in_use': true }).lean();
      for (const product of productDocs) {
        etsyReleased += (product.images || []).filter((im) => im && im.in_use === true).length;
      }
      if (etsyReleased > 0) {
        await EtsyProduct.updateMany(
          { 'images.in_use': true },
          { $set: { 'images.$[img].in_use': false, 'images.$[img].in_use_at': null } },
          { arrayFilters: [{ 'img.in_use': true }] }
        );
      }
    }

    res.json({
      data: {
        source,
        images_released: imagesReleased,
        etsy_images_released: etsyReleased,
        total: imagesReleased + etsyReleased,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, release };
