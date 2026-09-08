/**
 * Remote-image download proxy — shared by the images (images_to_bay) and the
 * Etsy product-image endpoints.
 *
 * Streams a remote URL through the API response with proper Content-Type /
 * Content-Disposition headers. The Python upscale job (GitHub Actions)
 * downloads its sources through this proxy and treats a 502 as
 * "the origin service is waking up" (Render free tier) — that behaviour is
 * part of the contract, keep it.
 */
const { Readable } = require('node:stream');

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function extFromType(type) {
  return EXT_BY_TYPE[type] || '';
}

/**
 * Fetch `url` server-side and stream it to `res` as a download.
 * Responds 502 BAD_GATEWAY (JSON) when the source is unreachable / not ok.
 *
 * The download filename is finalized once the upstream answers: the
 * extension comes from the upstream Content-Type when it is a known image
 * type, else from `fallbackExt` (usually guessed from the source URL).
 *
 * @param {import('express').Response} res
 * @param {string} url absolute http(s) source URL
 * @param {object} opts
 * @param {string} opts.filenameBase  filename WITHOUT extension
 * @param {string} opts.fallbackExt  extension when the Content-Type is unknown
 * @param {number} opts.timeoutMs    upstream fetch timeout
 * @returns {Promise<void>}
 */
async function streamRemoteImage(res, url, { filenameBase, fallbackExt, timeoutMs }) {
  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    upstream = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
  } catch (e) {
    res.status(502).json({
      error: {
        code: 'BAD_GATEWAY',
        message: `Could not fetch the image at its source — ${e.name === 'AbortError' ? 'timeout' : e.message}`,
      },
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.status(502).json({
      error: {
        code: 'BAD_GATEWAY',
        message: `The image source answered HTTP ${upstream.status} — the stored link may have expired`,
      },
    });
    return;
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = extFromType(type) || fallbackExt || 'png';
  res.setHeader('Content-Type', type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.${ext}"`);
  res.setHeader('Cache-Control', 'no-store');

  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', (e) => {
    console.error('[api] download stream error:', e.message);
    if (!res.headersSent) {
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Image stream interrupted' } });
    } else {
      res.end();
    }
  });
  nodeStream.pipe(res);
}

module.exports = { streamRemoteImage, extFromType, EXT_BY_TYPE };
