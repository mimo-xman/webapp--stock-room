#!/usr/bin/env node
/**
 * Backfill the `_id` of Etsy product images.
 *
 * WHY: scripts/migrate-to-multiplatform.cjs inserts products through the RAW
 * MongoDB driver — sub-documents do NOT get an automatic `_id` there (unlike
 * Mongoose). Every per-image feature keyed on `images._id` therefore failed
 * on migrated products:
 *   - POST /api/etsy-products/claim  → candidate images have no _id → nothing claimable
 *     → "Aucune Image Etsy éligible" in every upscale batch run;
 *   - PATCH/POST/DELETE …/images/:imageId (pause, upscales, download) → IMAGE_NOT_FOUND;
 *   - the webapp image-by-image viewer could not act on any image.
 *
 * WHAT: for every etsy_products doc, give each images[] entry that lacks an
 * _id a fresh ObjectId. Idempotent (safe to re-run), --dry-run supported.
 *
 * Usage:
 *   node scripts/backfill-etsy-image-ids.cjs \
 *     [--uri "mongodb+srv://…"] [--db stockroom] [--dry-run]
 */
const { MongoClient, ObjectId } = require('mongodb');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const DRY_RUN = args.includes('--dry-run');
const URI = arg('uri', process.env.MONGODB_URI || '');
const DB_NAME = arg('db', process.env.MONGO_DB_NAME || 'stockroom');

if (!URI || !DB_NAME || URI === true) {
  console.error('usage: node scripts/backfill-etsy-image-ids.cjs --uri <mongodb-uri> --db <name> [--dry-run]');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`connected → db "${DB_NAME}"${DRY_RUN ? ' (DRY RUN — nothing is written)' : ''}`);

  const productsCol = db.collection('etsy_products');
  const products = await productsCol.find({}).toArray();
  console.log(`scanning ${products.length} etsy product(s)…`);

  let fixedProducts = 0;
  let fixedImages = 0;
  let alreadyOk = 0;

  for (const p of products) {
    const images = p.images || [];
    const missing = images.filter((im) => !im._id);
    if (missing.length === 0) {
      alreadyOk += 1;
      continue;
    }

    const title = (p.metadata && p.metadata.title) || 'Untitled product';
    if (DRY_RUN) {
      console.log(`  (dry-run) product ${p._id} "${title}" → ${missing.length}/${images.length} image(s) would get an _id`);
      fixedProducts += 1;
      fixedImages += missing.length;
      continue;
    }

    // Build the positional $set map: one update per product (atomic).
    const set = {};
    images.forEach((im, i) => {
      if (!im._id) set[`images.${i}._id`] = new ObjectId();
    });
    const res = await productsCol.updateOne({ _id: p._id }, { $set: set });
    if (res.modifiedCount === 1) {
      console.log(`  product ${p._id} "${title}" → ${missing.length}/${images.length} image(s) got an _id`);
      fixedProducts += 1;
      fixedImages += missing.length;
    } else {
      console.warn(`  product ${p._id} "${title}" → update matched ${res.matchedCount}, modified ${res.modifiedCount} (unexpected)`);
    }
  }

  // Verify: no image without _id remains.
  const remaining = await productsCol
    .find({ 'images._id': { $exists: false } })
    .toArray()
    .catch(() => []);
  const badRemaining = Array.isArray(remaining) ? remaining.length : 0;

  console.log('\n══ BACKFILL SUMMARY ══');
  console.log(`products scanned   : ${products.length}`);
  console.log(`products fixed     : ${fixedProducts}`);
  console.log(`images fixed       : ${fixedImages}`);
  console.log(`products already ok: ${alreadyOk}`);
  console.log(`images still missing _id: ${badRemaining}`);
  if (badRemaining > 0 && !DRY_RUN) {
    console.error('FATAL — some images still lack an _id after the backfill; inspect manually.');
    process.exit(1);
  }
  console.log(badRemaining === 0 ? '✓ every etsy product image now carries an _id' : '(dry-run) re-run without --dry-run to apply');

  await client.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
