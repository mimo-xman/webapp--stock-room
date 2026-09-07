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
  imageClaimSchema,
  imageReleaseSchema,
  upscaleCreateSchema,
  upscaleUpdateSchema,
  etsyProductCreateSchema,
  etsyProductUpdateSchema,
  etsyProductAddImageSchema,
} = require('../schemas');
const authController = require('../controllers/authController');
const sessionController = require('../controllers/sessionController');
const imageController = require('../controllers/imageController');
const etsyProductController = require('../controllers/etsyProductController');
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
// NOTE: /api/images/all and /api/images/claim MUST stay ABOVE
// /api/images/:id — Express matches routes in declaration order and 'all' /
// 'claim' would otherwise be treated as an id.
router.get('/api/images/all', imageController.listAll);
// Parallel batch workers: atomically reserve the oldest eligible image.
router.post('/api/images/claim', validate(imageClaimSchema), imageController.claim);
router.get('/api/images/:id', imageController.getOne);
router.patch('/api/images/:id', validate(imageUpdateSchema), imageController.update);
router.post('/api/images/:id/release', validate(imageReleaseSchema), imageController.release);
router.delete('/api/images/:id', imageController.remove);
router.get('/api/images/:id/download', imageController.download);

// image upscales (Real-ESRGAN derivatives — registered by GitHub Actions,
// managed from the webapp: mark used / download / delete)
router.post('/api/images/:id/upscales', validate(upscaleCreateSchema), imageController.addUpscale);
router.patch('/api/images/:id/upscales/:upscaleId', validate(upscaleUpdateSchema), imageController.updateUpscale);
router.delete('/api/images/:id/upscales/:upscaleId', imageController.removeUpscale);
router.get('/api/images/:id/upscales/:upscaleId/download', imageController.downloadUpscale);

// etsy products (digital products sold on Etsy: coloring books, invitations…)
router.get('/api/etsy-products', etsyProductController.list);
router.post('/api/etsy-products', validate(etsyProductCreateSchema), etsyProductController.create);
router.get('/api/etsy-products/:id', etsyProductController.getOne);
router.patch('/api/etsy-products/:id', validate(etsyProductUpdateSchema), etsyProductController.update);
router.post('/api/etsy-products/:id/images', validate(etsyProductAddImageSchema), etsyProductController.addImage);
router.delete('/api/etsy-products/:id', etsyProductController.remove);

module.exports = router;
