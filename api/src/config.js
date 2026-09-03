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

// Database name in the URI path (e.g. mongodb+srv://…/<db>?…) — may be empty.
function dbNameFromUri(uri) {
  if (!uri) return '';
  try {
    const p = decodeURIComponent(new URL(uri).pathname || '');
    return p.replace(/^\/+/, '').split('/')[0] || '';
  } catch {
    return '';
  }
}

// The DB name is fully SEPARATE from MONGODB_URI (Atlas link without any db works).
// Priority: MONGO_DB_NAME > MONGODB_DB_NAME (alias) > db in URI path > 'adobe-stock'.
const MONGO_DB_NAME =
  process.env.MONGO_DB_NAME ||
  process.env.MONGODB_DB_NAME ||
  dbNameFromUri(process.env.MONGODB_URI) ||
  'adobe-stock';

const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  VERSION: pkg.version,
  PORT: intEnv('PORT', 3333),

  // ── persistence ──
  MONGODB_URI: process.env.MONGODB_URI || '',
  // DB name, separate from the URI — set MONGO_DB_NAME if needed (see .env.example).
  MONGO_DB_NAME,

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

  // ── upscales ──
  // Default server-side policy: how many upscale entries an image may hold.
  // Callers (GitHub Actions) pass their own max_upscales in the POST body —
  // it applies when lower than this ceiling. Hard safety cap: UPSCALE_HARD_MAX.
  MAX_UPSCALES_PER_IMAGE: intEnv('MAX_UPSCALES_PER_IMAGE', 10),

  // ── Cloudinary (optional) ──
  // Upscaled images are uploaded by the GitHub Actions runner, not here.
  // These credentials are ONLY used to destroy the remote asset when an
  // upscale entry is deleted from the webapp (storage hygiene).
  // If unset, deletion only removes the database entry (documented behavior).
  CLOUDINARY: {
    CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
    API_KEY: process.env.CLOUDINARY_API_KEY || '',
    API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  },
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
