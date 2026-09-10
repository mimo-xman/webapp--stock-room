/**
 * API routes.
 */
const express = require('express');
const { CONFIG } = require('../config');
const { dbState } = require('../db');
const { requireAuth, badAuthGuard } = require('../middleware/auth');
const { generalLimiter, authLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const {
  verifySchema,
  sessionCreateSchema,
  imageCreateSchema,
  imageUpdateSchema,
  imageBulkUsedSchema,
  imageClaimSchema,
  imageReleaseSchema,
  imageBulkFetchSchema,
  upscaleCreateSchema,
  etsyProductCreateSchema,
  etsyProductUpdateSchema,
  etsyProductAddImageSchema,
  etsyImageUpdateSchema,
  claimReleaseSchema,
} = require('../schemas');
const authController = require('../controllers/authController');
const sessionController = require('../controllers/sessionController');
const imageController = require('../controllers/imageController');
const etsyProductController = require('../controllers/etsyProductController');
const claimController = require('../controllers/claimController');
const docsHtml = require('./docs');

const router = express.Router();

// ── public ──
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(docsHtml);
});

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'stock-room-api',
    version: CONFIG.VERSION,
    status: dbState() === 'up' ? 'ok' : 'degraded',
    db: dbState(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

router.get('/ready', (req, res) => {
  const up = dbState() === 'up';
  res.status(up ? 200 : 503).json({ ready: up });
});

router.post('/auth/verify', authLimiter, validate(verifySchema), authController.verify);

// ── authenticated ──
router.use('/api', badAuthGuard, generalLimiter, requireAuth);

// sessions
router.get('/api/sessions', sessionController.list);
router.post('/api/sessions', validate(sessionCreateSchema), sessionController.create);
router.get('/api/sessions/:id', sessionController.getOne);
router.delete('/api/sessions/:id', sessionController.remove);

// images (multi-platform: collection images_to_bay, per-platform metadata)
router.get('/api/images', imageController.list);
router.post('/api/images', validate(imageCreateSchema), imageController.create);
// NOTE: /api/images/all, /api/images/claim and /api/images/bulk-used MUST
// stay ABOVE /api/images/:id — Express matches routes in declaration order
// and 'all' / 'claim' / 'bulk-used' would otherwise be treated as an id.
router.get('/api/images/all', imageController.listAll);
// Parallel batch workers: atomically reserve the oldest eligible image.
router.post('/api/images/claim', validate(imageClaimSchema), imageController.claim);
// Webapp multi-selection: stamp many images at once, on the platforms
// chosen in the popup (upscales follow their original — no per-variant stamps).
router.post('/api/images/bulk-used', validate(imageBulkUsedSchema), imageController.bulkUsed);
// Webapp multi-selection: fresh-from-the-DB read of every selected image
// (platform-picker stats + CSV build — the grid snapshot is never trusted).
router.post('/api/images/bulk-fetch', validate(imageBulkFetchSchema), imageController.bulkFetch);
router.get('/api/images/:id', imageController.getOne);
router.patch('/api/images/:id', validate(imageUpdateSchema), imageController.update);
router.post('/api/images/:id/release', validate(imageReleaseSchema), imageController.release);
router.delete('/api/images/:id', imageController.remove);
router.get('/api/images/:id/download', imageController.download);

// image upscales (Real-ESRGAN derivatives — registered by GitHub Actions,
// managed from the webapp: download / delete. No PATCH route: an upscale
// has no "used" state of its own, it follows its original image.)
router.post('/api/images/:id/upscales', validate(upscaleCreateSchema), imageController.addUpscale);
router.delete('/api/images/:id/upscales/:upscaleId', imageController.removeUpscale);
router.get('/api/images/:id/upscales/:upscaleId/download', imageController.downloadUpscale);

// etsy products (digital products sold on Etsy: coloring books, invitations…)
router.get('/api/etsy-products', etsyProductController.list);
router.post('/api/etsy-products', validate(etsyProductCreateSchema), etsyProductController.create);
// NOTE: /api/etsy-products/claim MUST stay ABOVE /api/etsy-products/:id —
// 'claim' would otherwise be treated as an id.
// Parallel batch workers: atomically reserve the oldest eligible PRODUCT IMAGE.
router.post('/api/etsy-products/claim', validate(imageClaimSchema), etsyProductController.claim);
// Whole-product ZIP (origin / x2 / x4 / metadata — nothing default) — must
// stay ABOVE the /api/etsy-products/:id/images/... downloads too.
router.get('/api/etsy-products/:id/download-zip', etsyProductController.downloadZip);
router.get('/api/etsy-products/:id', etsyProductController.getOne);
router.patch('/api/etsy-products/:id', validate(etsyProductUpdateSchema), etsyProductController.update);
router.post('/api/etsy-products/:id/images', validate(etsyProductAddImageSchema), etsyProductController.addImage);
router.delete('/api/etsy-products/:id', etsyProductController.remove);

// etsy product images — per-image worker coordination + webapp edits
// (nested images carry their own upscales, in_use / active / error_message).
router.patch('/api/etsy-products/:id/images/:imageId', validate(etsyImageUpdateSchema), etsyProductController.updateImage);
router.delete('/api/etsy-products/:id/images/:imageId', etsyProductController.removeImage);
router.post('/api/etsy-products/:id/images/:imageId/release', validate(imageReleaseSchema), etsyProductController.releaseImage);
router.get('/api/etsy-products/:id/images/:imageId/download', etsyProductController.downloadImage);

// etsy image upscales (Real-ESRGAN derivatives — same protocol as the
// images; no PATCH route: an upscale follows its original image)
router.post('/api/etsy-products/:id/images/:imageId/upscales', validate(upscaleCreateSchema), etsyProductController.addUpscale);
router.delete('/api/etsy-products/:id/images/:imageId/upscales/:upscaleId', etsyProductController.removeUpscale);
router.get('/api/etsy-products/:id/images/:imageId/upscales/:upscaleId/download', etsyProductController.downloadUpscale);

// worker-claim visibility + emergency release — the webapp lists the images
// a force-stopped batch left locked (in_use: true) and unlocks them at once.
router.get('/api/claims', claimController.list);
router.post('/api/claims/release', validate(claimReleaseSchema), claimController.release);

module.exports = router;
