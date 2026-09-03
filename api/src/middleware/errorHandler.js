/**
 * Central error handling — every failure leaves as a consistent JSON envelope.
 */

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}`,
    },
  });
}

function errorHandler(err, req, res, _next) {
  // Mongoose duplicate key (unique session title)
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const value = field in (err.keyValue || {}) ? err.keyValue[field] : '';
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: `Duplicate value for "${field}"${value ? `: "${value}"` : ''} — it must be unique`,
      },
    });
  }

  // Mongoose validation on update operators
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: Object.values(err.errors || {}).map((e) => ({ path: e.path, message: e.message })),
      },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' },
    });
  }

  console.error('[api] unhandled error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}

module.exports = { HttpError, notFound, errorHandler };
