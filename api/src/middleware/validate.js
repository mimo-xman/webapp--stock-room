/**
 * Validation middleware factory — parses req[source] through a zod schema
 * and stores the parsed value on req.validated. Failures become clean 400s.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const raw = source === 'query' ? req.query : req.body;
    const result = schema.safeParse(raw ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      }));
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid data — ${details[0] ? details[0].message : 'check the payload'}`,
          details,
        },
      });
    }
    req.validated = result.data;
    next();
  };
}

module.exports = { validate };
