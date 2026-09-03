/**
 * Authentication — dual credential, fail-closed.
 *
 *   X-API-Key       → role "agent"  (the AI agent that writes generation results)
 *   X-App-Password  → role "app"    (the Next.js web app behind the password gate)
 *
 * Both credentials grant the same CRUD access; they exist so the web app
 * password and the agent key can be rotated independently.
 *
 * A brute-force guard counts failed authentications per IP and blocks
 * repeat offenders (in-memory — the service is single-instance).
 */
const crypto = require('crypto');
const { CONFIG } = require('../config');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const badAuth = new Map(); // ip → { count, resetAt, blockedUntil }

function recordBadAuth(ip) {
  const now = Date.now();
  const { authWindowMs, badAuthMax, badAuthBlockMs } = CONFIG.RATE_LIMIT;
  let entry = badAuth.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + authWindowMs, blockedUntil: 0 };
    badAuth.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count >= badAuthMax) {
    entry.blockedUntil = now + badAuthBlockMs;
  }
}

function cleanupBadAuth() {
  const now = Date.now();
  for (const [ip, entry] of badAuth) {
    if (entry.blockedUntil < now && entry.resetAt < now) badAuth.delete(ip);
  }
}

/** Global pre-route guard: reject IPs currently blocked for auth abuse. */
function badAuthGuard(req, res, next) {
  const ip = req.ip || 'unknown';
  const entry = badAuth.get(ip);
  if (entry && entry.blockedUntil > Date.now()) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many failed authentication attempts — try again later',
      },
    });
  }
  next();
}

function requireAuth(req, res, next) {
  // Fail closed: with no credential configured, nobody gets in.
  if (!CONFIG.API_KEY && !CONFIG.APP_PASSWORD) {
    return res.status(503).json({
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server has no API_KEY / APP_PASSWORD configured — set them in the environment',
      },
    });
  }

  const key = req.headers['x-api-key'];
  const pass = req.headers['x-app-password'];

  if (typeof key === 'string' && CONFIG.API_KEY && safeEqual(key, CONFIG.API_KEY)) {
    req.auth = { role: 'agent' };
    return next();
  }
  if (typeof pass === 'string' && CONFIG.APP_PASSWORD && safeEqual(pass, CONFIG.APP_PASSWORD)) {
    req.auth = { role: 'app' };
    return next();
  }

  recordBadAuth(req.ip || 'unknown');
  return res.status(401).json({
    error: {
      code: 'AUTH_REQUIRED',
      message: 'Authentication required — send header X-API-Key (agent) or X-App-Password (web app)',
    },
  });
}

module.exports = { requireAuth, badAuthGuard, cleanupBadAuth };
