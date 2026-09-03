/**
 * Rate limiting (express-rate-limit v7).
 *  - generalLimiter → all /api routes
 *  - authLimiter    → POST /auth/verify (strict, anti brute-force)
 */
const { rateLimit } = require('express-rate-limit');
const { CONFIG } = require('../config');

function jsonMessage(message) {
  return { error: { code: 'RATE_LIMITED', message } };
}

const generalLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.generalWindowMs,
  limit: CONFIG.RATE_LIMIT.generalMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many requests — slow down'),
});

const authLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.authWindowMs,
  limit: CONFIG.RATE_LIMIT.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many password attempts — try again later'),
});

module.exports = { generalLimiter, authLimiter };
