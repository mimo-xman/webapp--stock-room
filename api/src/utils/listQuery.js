/**
 * List query parser — server-enforced pagination / search / sort / order / date range.
 *
 * Controllers add their own resource-specific filters on top of this.
 * Every deviation from the contract is a 400 VALIDATION_ERROR (never a silent clamp).
 */
const { PAGE_SIZES, DEFAULT_PAGE_SIZE } = require('../constants');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {object} raw   req.query
 * @param {string[]} sortFields whitelist of sortable fields
 * @returns {{ problems: object[] } | { value: object }}
 */
function parseCommonQuery(raw, sortFields) {
  const q = raw || {};
  const problems = [];

  let page = 1;
  if (q.page !== undefined && q.page !== '') {
    page = parseInt(q.page, 10);
    if (!Number.isInteger(page) || page < 1) {
      problems.push({ path: 'page', message: 'page must be an integer ≥ 1' });
    }
  }

  let limit = DEFAULT_PAGE_SIZE;
  if (q.limit !== undefined && q.limit !== '') {
    limit = parseInt(q.limit, 10);
    if (!PAGE_SIZES.includes(limit)) {
      problems.push({ path: 'limit', message: `limit must be one of: ${PAGE_SIZES.join(', ')}` });
    }
  }

  let search = '';
  if (q.search !== undefined && q.search !== '') {
    search = String(q.search).trim().slice(0, 100);
  }

  let sort = 'createdAt';
  if (q.sort !== undefined && q.sort !== '') {
    sort = String(q.sort);
    if (!sortFields.includes(sort)) {
      problems.push({ path: 'sort', message: `sort must be one of: ${sortFields.join(', ')}` });
    }
  }

  let order = 'desc';
  if (q.order !== undefined && q.order !== '') {
    order = String(q.order).toLowerCase();
    if (order !== 'asc' && order !== 'desc') {
      problems.push({ path: 'order', message: 'order must be "asc" or "desc"' });
    }
  }

  let from;
  if (q.from !== undefined && q.from !== '') {
    from = new Date(q.from);
    if (Number.isNaN(from.getTime())) {
      problems.push({ path: 'from', message: 'from must be a valid date (ISO 8601)' });
    }
  }

  let to;
  if (q.to !== undefined && q.to !== '') {
    to = new Date(q.to);
    if (Number.isNaN(to.getTime())) {
      problems.push({ path: 'to', message: 'to must be a valid date (ISO 8601)' });
    }
  }

  if (problems.length) return { problems };

  return {
    value: {
      page,
      limit,
      skip: (page - 1) * limit,
      search,
      sort,
      order,
      from,
      to,
    },
  };
}

/**
 * Exact-match filter helper: value must be in `allowed` (optional: allowed=null → any string).
 * Returns { problem } or { value: <cleaned string|undefined> }.
 */
function exactFilter(raw, name, allowed) {
  if (raw === undefined || raw === '') return { value: undefined };
  const v = String(raw).trim();
  if (allowed && !allowed.includes(v)) {
    return { problem: { path: name, message: `${name} must be one of: ${allowed.join(', ')}` } };
  }
  return { value: v };
}

function paginationMeta({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages };
}

module.exports = { escapeRegex, parseCommonQuery, exactFilter, paginationMeta };
