/**
 * Central configuration — loaded once, fail-closed on missing criticals.
 * All values are environment-driven (see .env.example).
 */
require('dotenv').config();

const pkg = require('../package.json');

function intEnv(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function listEnv(name, fallback) {
  return (process.env[name] || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  VERSION: pkg.version,
  PORT: intEnv('PORT', 3333),

  // ── persistence ──
  MONGODB_URI: process.env.MONGODB_URI || '',

  // ── auth (dual credential) ──
  // X-API-Key       → for the AI agent that writes generation results
  // X-App-Password  → for the Next.js web app (password gate)
  API_KEY: process.env.API_KEY || '',
  APP_PASSWORD: process.env.APP_PASSWORD || '',

  // ── network ──
  CORS_ORIGINS: listEnv('CORS_ORIGINS', '*'),
  TRUST_PROXY: intEnv('TRUST_PROXY', 1),

  // ── rate limits (see README) ──
  RATE_LIMIT: {
    generalWindowMs: intEnv('RATE_LIMIT_GENERAL_WINDOW_MS', 60000),
    generalMax: intEnv('RATE_LIMIT_GENERAL_MAX', 300),
    authWindowMs: intEnv('RATE_LIMIT_AUTH_WINDOW_MS', 300000),
    authMax: intEnv('RATE_LIMIT_AUTH_MAX', 20),
    badAuthMax: intEnv('RATE_LIMIT_BAD_AUTH_MAX', 30),
    badAuthBlockMs: intEnv('RATE_LIMIT_BAD_AUTH_BLOCK_MS', 600000),
  },

  // ── download proxy ──
  DOWNLOAD_TIMEOUT_MS: intEnv('DOWNLOAD_TIMEOUT_MS', 25000),
};

function assertCriticals() {
  const missing = [];
  if (!CONFIG.MONGODB_URI) missing.push('MONGODB_URI');
  if (!CONFIG.API_KEY) missing.push('API_KEY');
  if (!CONFIG.APP_PASSWORD) missing.push('APP_PASSWORD');
  if (missing.length) {
    // Don't crash in test/dev scripts that inject env programmatically,
    // but make a silent misconfiguration impossible to miss in production.
    if (CONFIG.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    console.warn(`[config] WARNING — not configured: ${missing.join(', ')} (auth will fail closed)`);
  }
}

module.exports = { CONFIG, assertCriticals };
