/**
 * Optional Cloudinary integration — ONLY used for destroying remote assets
 * when an upscale entry is deleted (storage hygiene).
 *
 * Upscaled images are uploaded by the GitHub Actions runner directly to
 * Cloudinary; this API never uploads. If CLOUDINARY_* env vars are not set,
 * destroyAsset() is a no-op and deletion only removes the database entry.
 */
const { CONFIG } = require('../config');

const cloudinary = require('cloudinary').v2;

let _configured = null;

function isCloudinaryConfigured() {
  if (_configured === null) {
    const { CLOUD_NAME, API_KEY, API_SECRET } = CONFIG.CLOUDINARY;
    _configured = Boolean(CLOUD_NAME && API_KEY && API_SECRET);
    if (_configured) {
      cloudinary.config({
        cloud_name: CLOUD_NAME,
        api_key: API_KEY,
        api_secret: API_SECRET,
        secure: true,
      });
    }
  }
  return _configured;
}

/**
 * Destroy a remote Cloudinary asset (best-effort).
 * @returns {Promise<{destroyed: boolean, result?: string, error?: string}>}
 */
async function destroyAsset(publicId) {
  if (!publicId) return { destroyed: false, error: 'no public_id on the entry' };
  if (!isCloudinaryConfigured()) {
    return { destroyed: false, error: 'Cloudinary not configured on the API (CLOUDINARY_* env vars) — only the database entry was removed' };
  }
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
    // result.result: 'ok' (destroyed) | 'not found' | 'unknown'
    return { destroyed: result.result === 'ok', result: result.result };
  } catch (e) {
    // Network/API error — surface it, never block the DB deletion.
    return { destroyed: false, error: e.message };
  }
}

module.exports = { isCloudinaryConfigured, destroyAsset };
