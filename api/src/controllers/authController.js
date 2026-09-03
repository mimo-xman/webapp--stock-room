/**
 * Auth controller — password gate verification for the web app.
 * Strict rate-limited (see routes) to resist brute force.
 */
const crypto = require('crypto');
const { CONFIG } = require('../config');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function verify(req, res) {
  const { password } = req.validated;

  if (!CONFIG.APP_PASSWORD) {
    return res.status(503).json({
      error: { code: 'AUTH_NOT_CONFIGURED', message: 'Server has no APP_PASSWORD configured' },
    });
  }

  if (typeof password === 'string' && safeEqual(password, CONFIG.APP_PASSWORD)) {
    return res.json({ ok: true, role: 'app' });
  }

  // Small constant-ish delay to blunt timing/enumeration.
  await new Promise((r) => setTimeout(r, 250));
  return res.status(401).json({
    error: { code: 'AUTH_REQUIRED', message: 'Wrong password' },
  });
}

module.exports = { verify };
