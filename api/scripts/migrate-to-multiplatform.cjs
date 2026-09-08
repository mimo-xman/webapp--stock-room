#!/usr/bin/env node
/**
 * Migrate the Stock Room MongoDB to the multi-platform schema.
 *
 * BEFORE                          AFTER
 * ─────────────────────────────   ─────────────────────────────────────────
 * images (flat Adobe metadata)    images_to_bay (per-platform metadata +
 *                                 per-platform used flags + used_count)
 *                                 etsy_products (NEW — Etsy sessions become
 *                                 products: images[] + listing metadata)
 * sessions                        sessions (unchanged — counts adapt)
 *
 * Steps:
 *  1. Backup: copy `images` → `images_pre_multiplatform_backup` (kept forever
 *     unless --drop-backup is passed — the owner can drop it manually later).
 *  2. Rename `images` → `images_to_bay` (rename keeps every document).
 *  3. Transform every image doc: flat title/category/keywords →
 *     metadata.adobe_stock + derive the 7 other platforms; used_in_adobe_stock
 *     → used.adobe_stock + used_count; remove the flat fields.
 *  4. Etsy sessions (title matches /^etsy\b/i or /coloring book/i, or their
 *     images are coloring pages): each session's images leave images_to_bay
 *     and become ONE EtsyProduct (cover + pages, listing metadata derived
 *     from the cover, tags from the cover keywords).
 *  5. Verify + print a summary.
 *
 * Usage:
 *   node scripts/migrate-to-multiplatform.cjs \
 *     [--uri "mongodb+srv://…"] [--db stockroom] [--dry-run] [--drop-backup]
 *
 * Defaults: --uri from MONGODB_URI env, --db from MONGO_DB_NAME env or
 * "stockroom".
 */
const { MongoClient, ObjectId } = require('mongodb');

const { STOCK_PLATFORM_IDS, ADOBE_TO_SHUTTERSTOCK_CATEGORY } =
  require('../src/constants');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const DRY_RUN = args.includes('--dry-run');
const DROP_BACKUP = args.includes('--drop-backup');
const URI = arg('uri', process.env.MONGODB_URI || '');
const DB_NAME = arg('db', process.env.MONGO_DB_NAME || 'stockroom');

if (!URI || !DB_NAME || URI === true) {
  console.error('usage: node scripts/migrate-to-multiplatform.cjs --uri <mongodb-uri> --db <name> [--dry-run] [--drop-backup]');
  process.exit(1);
}

// ── derivation helpers (mirror api/src/utils/derivePlatformMetadata.js) ──────

const POND5_DEFAULT_PRICE = 5;

function asciiFold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function clip(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function derivePlatformMetadata(adobe) {
  const title = String(adobe.title || '').trim();
  const keywordsAll = (adobe.keywords || []).map((k) => String(k || '').trim()).filter(Boolean);
  const ssCategory = ADOBE_TO_SHUTTERSTOCK_CATEGORY[adobe.category] || 'Objects';
  const kw = (max) => keywordsAll.slice(0, max);
  return {
    adobe_stock: { title, category: adobe.category || '', keywords: kw(49) },
    shutterstock: { description: clip(title, 200), categories: [ssCategory], keywords: kw(50) },
    istock: { title: clip(title, 120), description: title, keywords: kw(50) },
    wirestock: { title: clip(title, 200), description: title, keywords: kw(50) },
    pond5: {
      title: asciiFold(clip(title, 80)),
      description: asciiFold(title),
      keywords: kw(50).map(asciiFold),
      price: POND5_DEFAULT_PRICE,
    },
    depositphotos: { description: asciiFold(clip(title, 250)), keywords: kw(50).map(asciiFold) },
    '123rf': { description: asciiFold(clip(title, 180)), keywords: kw(50).map(asciiFold) },
    dreamstime: { title: clip(title, 250) || title.slice(0, 250), description: title, keywords: kw(50) },
  };
}

function emptyUsed() {
  return Object.fromEntries(STOCK_PLATFORM_IDS.map((id) => [id, false]));
}

function usedCount(used) {
  return STOCK_PLATFORM_IDS.filter((id) => used[id] === true).length;
}

// ── Etsy session detection + product derivation ─────────────────────────────

function isEtsySession(session, imageCount) {
  const t = String(session.title || '').toLowerCase();
  return (
    /^etsy\b/.test(t) ||
    /coloring book/.test(t) ||
    (t.includes('etsy') && imageCount > 0)
  );
}

function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Derive the product's listing metadata from the session + its images. */
function deriveEtsyMetadata(session, images) {
  const sessionTitle = String(session.title || '');
  // "Etsy coloring book — big machines and work vehicles — 2026-09-08"
  const parts = sessionTitle.split(/\s+—\s+|\s+-\s+/);
  let theme = '';
  for (const p of parts.slice(1)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.trim())) theme = p.trim();
  }
  theme = theme || parts[0] || 'Digital product';

  const cover = images.find((im) => /cover/i.test(String(im.title || '')));
  const coverTitle = cover ? String(cover.title || '').replace(/\s*[—-]\s*cover\s*$/i, '').trim() : '';
  const bookTitle = coverTitle || `${titleCase(theme)} Coloring Book`;

  // tags: cover keywords clipped to Etsy's 13 × 20 chars, lowercase, deduped
  const tagSource = (cover && cover.keywords) || (images[0] && images[0].keywords) || [];
  const tags = [...new Set(
    tagSource
      .map((k) => String(k || '').trim().toLowerCase())
      .filter((k) => k && k.length <= 20)
  )].slice(0, 13);

  const pages = images.filter((im) => im !== cover).length;
  const description =
    `${bookTitle} — printable digital download with ${pages || images.length} coloring page${pages === 1 ? '' : 's'} (plus cover). ` +
    `Instant download: print at home and color. High-resolution black and white line art, standard letter size. ` +
    `All original artwork, made with care for hours of relaxing coloring.`;

  return {
    title: clip(bookTitle, 140),
    description,
    tags,
    category: 'Toys & Games > Games > Coloring Books',
    price: 4.99,
  };
}

function imageToProductEntry(im) {
  const title = String(im.title || '');
  const isCover = /cover/i.test(title);
  return {
    // REQUIRED: the raw driver does NOT auto-generate sub-document _ids
    // (Mongoose does). Without it every per-image feature keyed on
    // images._id breaks — claim, upscales, pause, download (fixed
    // retroactively by backfill-etsy-image-ids.cjs, never again here).
    _id: new ObjectId(),
    image_link: im.image_link,
    role: isCover ? 'cover' : 'page',
    caption: clip(title, 200),
    ratio: im.ratio || '',
    quality: im.quality || '',
    upscales: (im.upscales || []).map((u) => ({
      // the migrated upscale entries keep their ORIGINAL _id: they already
      // exist in the DB history and stay addressable.
      ...(u._id ? { _id: u._id } : { _id: new ObjectId() }),
      url: u.url,
      public_id: u.public_id || '',
      scale: u.scale,
      model: u.model,
      width: u.width,
      height: u.height,
      size_bytes: u.size_bytes,
      source: u.source || 'github-actions',
      run_id: u.run_id || '',
      used_in_adobe_stock: !!u.used_in_adobe_stock,
      created_at: u.created_at || im.updatedAt || im.createdAt,
    })),
  };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`connected → db "${DB_NAME}"${DRY_RUN ? ' (DRY RUN — nothing is written)' : ''}`);

  const imagesCol = db.collection('images');
  const bayCol = db.collection('images_to_bay');
  const productsCol = db.collection('etsy_products');
  const sessionsCol = db.collection('sessions');

  // Idempotency guard
  const alreadyBay = await bayCol.countDocuments({});
  const legacy = await imagesCol.countDocuments({});
  if (alreadyBay > 0 && legacy === 0) {
    console.log('images_to_bay already exists and images is gone — migration already ran.');
    await client.close();
    return;
  }
  if (alreadyBay > 0 && legacy > 0) {
    console.error('BOTH images and images_to_bay exist — refusing to run. Resolve manually first.');
    process.exit(1);
  }
  if (legacy === 0) {
    console.error('collection "images" is empty/missing — nothing to migrate.');
    process.exit(1);
  }

  // 1. backup
  if (DROP_BACKUP) {
    await db.collection('images_pre_multiplatform_backup').drop().catch(() => {});
  }
  const backupExists = await db.listCollections({ name: 'images_pre_multiplatform_backup' }).hasNext();
  if (backupExists) {
    console.log('backup collection images_pre_multiplatform_backup already exists — keeping it.');
  } else {
    await imagesCol.aggregate([{ $match: {} }, { $out: 'images_pre_multiplatform_backup' }]).toArray();
    console.log(`backup: images → images_pre_multiplatform_backup (${legacy} docs)`);
  }

  // 2. rename images → images_to_bay
  if (!DRY_RUN) {
    await db.admin().command({ renameCollection: `${DB_NAME}.images`, to: `${DB_NAME}.images_to_bay` });
    console.log('renamed: images → images_to_bay');
  } else {
    console.log('(dry-run) would rename: images → images_to_bay');
  }

  const workingCol = DRY_RUN ? imagesCol : bayCol;

  // 3. load sessions + images, detect Etsy sessions
  const sessions = await sessionsCol.find({}).sort({ createdAt: 1 }).toArray();
  const allImages = await workingCol.find({}).sort({ createdAt: 1 }).toArray();
  console.log(`loaded ${sessions.length} sessions / ${allImages.length} images`);

  const imagesBySession = new Map();
  for (const im of allImages) {
    const key = String(im.session_id);
    if (!imagesBySession.has(key)) imagesBySession.set(key, []);
    imagesBySession.get(key).push(im);
  }

  const etsySessions = sessions.filter((s) => isEtsySession(s, (imagesBySession.get(String(s._id)) || []).length));
  const etsyImageIds = new Set();
  for (const s of etsySessions) {
    for (const im of imagesBySession.get(String(s._id)) || []) etsyImageIds.add(String(im._id));
  }
  console.log(`Etsy sessions detected: ${etsySessions.length} (${etsySessions.map((s) => `"${s.title}"`).join(', ')})`);
  console.log(`→ ${etsyImageIds.size} images will become Etsy products; ${allImages.length - etsyImageIds.size} stay in images_to_bay`);

  // 4. transform the stock images (everything EXCEPT the Etsy product images)
  let transformed = 0;
  for (const im of allImages) {
    if (etsyImageIds.has(String(im._id))) continue;
    const derived = derivePlatformMetadata({
      title: im.title,
      category: im.category,
      keywords: im.keywords,
    });
    const used = emptyUsed();
    used.adobe_stock = im.used_in_adobe_stock === true;
    const update = {
      $set: {
        metadata: derived,
        used,
        used_count: usedCount(used),
      },
      $unset: { title: '', category: '', keywords: '', used_in_adobe_stock: '' },
    };
    if (!DRY_RUN) await workingCol.updateOne({ _id: im._id }, update);
    transformed += 1;
  }
  console.log(`transformed ${transformed} images_to_bay docs (metadata + used + used_count, flat fields removed)`);

  // 5. Etsy sessions → products
  let createdProducts = 0;
  for (const s of etsySessions) {
    const imgs = imagesBySession.get(String(s._id)) || [];
    if (!imgs.length) continue;
    // cover first, then pages in creation order
    const ordered = [...imgs].sort((a, b) => {
      const ac = /cover/i.test(a.title || '') ? 0 : 1;
      const bc = /cover/i.test(b.title || '') ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const metadata = deriveEtsyMetadata(s, ordered);
    const product = {
      session_id: s._id,
      product_type: /coloring/i.test(s.title || '') ? 'coloring_book' : 'digital_download',
      images: ordered.map(imageToProductEntry),
      metadata,
      file_link: '',
      used_in_etsy: false,
      createdAt: s.createdAt || new Date(),
      updatedAt: new Date(),
    };
    if (!DRY_RUN) {
      const res = await productsCol.insertOne(product);
      console.log(`  product ${res.insertedId} ← session "${s.title}" (${product.images.length} images, tags: ${metadata.tags.slice(0, 5).join(', ')}…)`);
    } else {
      console.log(`  (dry-run) product ← session "${s.title}" (${product.images.length} images)`);
    }
    createdProducts += 1;
  }
  console.log(`created ${createdProducts} etsy_products docs`);

  // 6. remove the Etsy images from images_to_bay (they now live in products)
  if (!DRY_RUN && etsyImageIds.size > 0) {
    const ids = [...etsyImageIds].map((id) => {
      try { return ObjectId.createFromHexString(id); } catch { return id; }
    });
    const { deletedCount } = await bayCol.deleteMany({ _id: { $in: ids } });
    console.log(`removed ${deletedCount} product images from images_to_bay`);
  }

  // 7. verification
  const finalBay = DRY_RUN ? legacy - etsyImageIds.size : await bayCol.countDocuments({});
  const finalProducts = DRY_RUN ? createdProducts : await productsCol.countDocuments({});
  const check = await (DRY_RUN ? workingCol : bayCol).find({}).limit(1).toArray();
  if (check.length && !DRY_RUN) {
    const bad = await bayCol.countDocuments({ metadata: { $exists: false } });
    console.log(`sanity: docs without metadata in images_to_bay → ${bad}`);
  }
  console.log('\n══ MIGRATION SUMMARY ══');
  console.log(`images_to_bay : ${finalBay} docs (was ${legacy})`);
  console.log(`etsy_products : ${finalProducts} docs`);
  console.log(`sessions      : ${sessions.length} (unchanged)`);
  console.log('backup        : images_pre_multiplatform_backup (drop it manually once satisfied)');

  await client.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
