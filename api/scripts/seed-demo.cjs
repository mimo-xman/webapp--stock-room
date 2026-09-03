/**
 * Demo seed — starts the API on an in-memory MongoDB (:3333) and loads
 * two sessions + 16 images (reusing the 3 real image URLs generated on Render)
 * so the web app can be exercised end-to-end in the browser.
 *
 * Credentials: X-API-Key demo-agent-key | app password demo-app-password
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

const API = 'http://127.0.0.1:3333';
const AGENT_KEY = 'demo-agent-key';
const APP_PASSWORD = 'demo-app-password';

const ZKEY = 'ZL5aJw0Xxj6JeqfojWldkqtWglyCMMSDTZsWdEZ';
const IMG = {
  coffee: `http://zazogptimage2api.onrender.com/files/easemate-ba465c140a56.png?apiKey=${ZKEY}`,
  mountains: `http://zazogptimage2api.onrender.com/files/easemate-3bb077d73953.png?apiKey=${ZKEY}`,
  graded: `http://zazogptimage2api.onrender.com/files/easemate-fb81b94d226e.png?apiKey=${ZKEY}`,
};

const kw = (...k) => k;

const sessions = [
  {
    title: 'Adobe Stock batch — ceramic still life — 2026-09-03',
    images: [
      {
        prompt:
          'Professional stock photograph of a minimalist ceramic pour-over coffee setup on a warm linen cloth, soft diffused morning window light from the left, shallow depth of field, 50mm lens, muted earthy palette with one terracotta accent, clean negative space, no people, no text, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Minimal ceramic pour-over coffee set on linen, top view',
        category: 'Food',
        keywords: kw('coffee', 'pour over', 'ceramic', 'minimal', 'still life', 'linen', 'top view', 'morning light', 'handmade', 'artisan', 'beige', 'terracotta', 'flat lay', 'breakfast', 'cafe', 'slow living', 'natural light', 'tabletop', 'cozy', 'warm tones', 'organic', 'rustic', 'simplicity', 'negative space', 'commercial'),
        used_in_adobe_stock: true,
      },
      {
        prompt:
          'Close-up of stacked matte ceramic bowls on a concrete surface, soft directional studio light, subtle shadows, monochrome warm grey palette, minimal composition, no text, photorealistic stock photography',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Stacked matte ceramic bowls on concrete, minimal still life',
        category: 'Food',
        keywords: kw('ceramic bowls', 'stacked', 'matte', 'concrete', 'minimalism', 'still life', 'studio light', 'grey', 'tableware', 'handmade pottery', 'shadows', 'texture', 'neutral', 'kitchenware', 'dining', 'simple', 'composition', 'soft light', 'commercial', 'product photo', 'homeware', 'craft', 'artisan', 'neutral background'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Warm flat lay of a linen table setting with hand-thrown ceramics and dried botanicals, golden hour window light, 35mm lens, earthy palette, generous negative space for text, no people, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Linen table setting with hand-thrown ceramics and dried plants',
        category: 'Lifestyle',
        keywords: kw('linen', 'table setting', 'ceramics', 'handmade', 'dried plants', 'botanicals', 'flat lay', 'golden hour', 'earthy', 'neutral', 'warm', 'tableware', 'dining', 'rustic', 'natural', 'organic', 'text space', 'lifestyle', 'cozy', 'slow living', 'craft', 'simplicity', 'homeware', 'minimal', 'window light'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Abstract close-up of water sliding on a terracotta-glazed ceramic surface, macro photography, glossy vs matte texture contrast, warm orange and cream palette, no text, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Macro texture of glazed terracotta ceramic with water drops',
        category: 'Graphic Resources',
        keywords: kw('terracotta', 'glaze', 'macro', 'texture', 'water drops', 'ceramic', 'orange', 'cream', 'abstract background', 'glossy', 'matte', 'pattern', 'surface', 'craft', 'handmade', 'warm background', 'detail', 'close up', 'material', 'natural texture', 'background image', 'copy space', 'design resource', 'texture background'),
        used_in_adobe_stock: true,
      },
      {
        prompt:
          'Overhead composition of a modern kitchen corner with ceramic utensil holder, wooden spoons and a linen towel, soft daylight, clean scandinavian styling, muted palette, no people, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Modern kitchen corner with ceramic holder and wooden spoons',
        category: 'Lifestyle',
        keywords: kw('kitchen', 'ceramic', 'utensil holder', 'wooden spoons', 'linen towel', 'scandinavian', 'minimal', 'daylight', 'modern home', 'interior', 'neutral', 'beige', 'home decor', 'household', 'clean', 'styling', 'domestic', 'cooking', 'tabletop', 'natural', 'hygge', 'simple', 'organized', 'shelf', 'counter'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Studio product shot of a single artisan espresso cup on a stone coaster, dramatic side light, deep shadows, charcoal and cream palette, premium commercial photography, no text, no people',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Artisan espresso cup on stone coaster, dramatic side light',
        category: 'Business',
        keywords: kw('espresso cup', 'artisan', 'stone coaster', 'product photography', 'side light', 'dramatic light', 'shadows', 'charcoal', 'cream', 'commercial', 'premium', 'coffee', 'cafe', 'menu background', 'branding', 'minimal', 'elegant', 'single object', 'still life', 'studio', 'dark background', 'contrast', 'marketing', 'beverage', 'barista'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Deconstructed flat lay of ceramic dinnerware pieces separated by generous white space, top view, even softbox lighting, catalog style, white and clay palette, no people, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Deconstructed ceramic dinnerware flat lay on white, catalog style',
        category: 'Graphic Resources',
        keywords: kw('dinnerware', 'flat lay', 'deconstructed', 'white background', 'catalog', 'ceramic', 'tableware', 'plate', 'bowl', 'cup', 'top view', 'product layout', 'menu design', 'restaurant', 'copy space', 'clean', 'minimal', 'white space', 'commercial', 'layout', 'graphic design', 'template', 'neutral', 'e-commerce'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Rustic potter workshop corner with raw clay vessels on a wooden shelf, dust in warm window light, documentary style, 35mm, muted browns, no people, no faces, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.coffee,
        title: 'Raw clay vessels on wooden shelf in a potter workshop',
        category: 'Lifestyle',
        keywords: kw('pottery', 'workshop', 'raw clay', 'wooden shelf', 'rustic', 'craft', 'artisan', 'window light', 'dust', 'warm', 'brown', 'documentary', 'handmade', 'studio', 'ceramics', 'terracotta', 'work in progress', 'traditional', 'atmosphere', 'moody', 'texture', 'shelf', 'interior', 'authentic', 'craftsmanship'),
        used_in_adobe_stock: false,
      },
    ],
  },
  {
    title: 'Adobe Stock batch — alpine landscapes — 2026-09-03',
    images: [
      {
        prompt:
          'Wide cinematic photograph of misty mountain ridges at sunrise, layered blue-grey tones fading into warm gold haze, lone pine silhouettes in the foreground, atmospheric perspective, no people, photorealistic',
        ratio: '16:9', quality: '2K', image_link: IMG.mountains,
        title: 'Misty mountain ridges at sunrise, layered blue-grey haze',
        category: 'Landscapes',
        keywords: kw('mountains', 'mist', 'sunrise', 'ridges', 'layers', 'atmosphere', 'blue grey', 'golden haze', 'pine silhouettes', 'cinematic', 'wide angle', 'moody', 'fog', 'peak', 'dawn', 'valley', 'outdoors', 'nature', 'scenic', 'panorama', 'tranquil', 'majestic', 'epic landscape', 'morning', 'wilderness'),
        used_in_adobe_stock: true,
      },
      {
        prompt:
          'Minimalist winter mountain scene, single dark ridge line against a pale gradient sky, negative space composition, fine art landscape photography, no people, photorealistic',
        ratio: '16:9', quality: '2K', image_link: IMG.mountains,
        title: 'Minimalist winter ridge line under pale gradient sky',
        category: 'Landscapes',
        keywords: kw('winter', 'mountain', 'ridge', 'minimalist', 'gradient sky', 'negative space', 'fine art', 'pale', 'cold', 'snow line', 'horizon', 'calm', 'simple', 'monochrome', 'landscape', 'dark ridge', 'polar', 'quiet', 'serene', 'conceptual background', 'wall art', 'print', 'nature', 'sky'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Aerial drone view of a winding alpine road through pine forest in autumn, warm orange foliage against dark green, morning shadows, no vehicles, no people, photorealistic',
        ratio: '16:9', quality: '2K', image_link: IMG.mountains,
        title: 'Aerial view of alpine road through autumn pine forest',
        category: 'Landscapes',
        keywords: kw('aerial', 'drone view', 'alpine road', 'pine forest', 'autumn', 'orange foliage', 'winding road', 'mountains', 'forest', 'birds eye', 'top down', 'travel', 'adventure', 'road trip', 'scenic route', 'nature', 'morning shadows', 'green', 'orange', 'wilderness', 'journey', 'remote', 'highland', 'serpentine'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Golden hour graded landscape, warm cinematic tones over rolling hills, gentle mist in valleys, depth layers, film photography aesthetic, no people, no text',
        ratio: '4:3', quality: '1K', image_link: IMG.graded,
        title: 'Rolling hills in golden hour light with valley mist',
        category: 'Landscapes',
        keywords: kw('golden hour', 'rolling hills', 'valley mist', 'cinematic', 'warm tones', 'film aesthetic', 'layers', 'depth', 'countryside', 'sunrise', 'nature', 'atmosphere', 'soft light', 'golden', 'landscape', 'pastoral', 'calm', 'idyllic', 'rural', 'morning', 'haze', 'grain', 'vintage', 'warm'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Dramatic storm light over a mountain valley, god rays breaking through dark clouds, vivid contrast between warm light and cool shadow, epic nature photography, no people',
        ratio: '16:9', quality: '2K', image_link: IMG.mountains,
        title: 'Storm light with god rays over a mountain valley',
        category: 'Landscapes',
        keywords: kw('storm light', 'god rays', 'dark clouds', 'mountain valley', 'dramatic', 'epic', 'contrast', 'light beams', 'weather', 'moody', 'wilderness', 'nature power', 'sunbeams', 'clouds', 'atmosphere', 'majestic', 'adventure', 'outdoors', 'scenic', 'stormy sky', 'vivid', 'landscape photography', 'dynamic', 'raw nature'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Serene lake reflection of mountain peaks at dawn, perfectly still water, symmetrical composition, pastel pink and blue tones, fine art print style, no people, photorealistic',
        ratio: '16:9', quality: '2K', image_link: IMG.graded,
        title: 'Mountain peaks reflected in a still lake at dawn',
        category: 'Landscapes',
        keywords: kw('lake reflection', 'mountain peaks', 'dawn', 'still water', 'symmetry', 'pastel', 'pink', 'fine art print', 'serene', 'mirror', 'calm water', 'peaceful', 'nature', 'symmetrical', 'water surface', 'morning', 'soft colors', 'wall art', 'decor', 'tranquil', 'pristine', 'crystal clear', 'scenery', 'wilderness'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Coastal cliff at blue hour, long exposure ocean smoothing into mist, distant lighthouse light, deep blue and slate palette, travel photography, no people, no text',
        ratio: '16:9', quality: '2K', image_link: IMG.graded,
        title: 'Long exposure coastal cliff at blue hour with lighthouse',
        category: 'Travel',
        keywords: kw('coastal cliff', 'blue hour', 'long exposure', 'ocean', 'lighthouse', 'sea', 'dusk', 'travel', 'deep blue', 'slate', 'smooth water', 'seascape', 'shore', 'rocks', 'night edge', 'twilight', 'beacon', 'coastline', 'dramatic coast', 'destination', 'nautical', 'maritime', 'travel photography', 'scenic', 'vacation'),
        used_in_adobe_stock: false,
      },
      {
        prompt:
          'Environmental concept image of a young pine sapling growing on a mossy fallen trunk, foggy forest background, bokeh, symbol of sustainability and renewal, no people, photorealistic',
        ratio: '4:3', quality: '1K', image_link: IMG.graded,
        title: 'Pine sapling growing on mossy fallen trunk in fog',
        category: 'The Environment',
        keywords: kw('pine sapling', 'moss', 'fallen trunk', 'renewal', 'sustainability', 'growth', 'fog', 'forest', 'green', 'ecology', 'concept', 'new life', 'regeneration', 'nature cycle', 'environment', 'bokeh', 'soft focus', 'moody forest', 'conservation', 'biodiversity', 'natural habitat', 'woodland', 'life', 'fresh', 'environmental concept', 'climate'),
        used_in_adobe_stock: false,
      },
    ],
  },
];

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AGENT_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'adobe_stock_demo' } });
  process.env.MONGODB_URI = mongod.getUri('adobe_stock_demo');
  process.env.NODE_ENV = 'demo';
  process.env.PORT = '3333';
  process.env.API_KEY = AGENT_KEY;
  process.env.APP_PASSWORD = APP_PASSWORD;
  process.env.RATE_LIMIT_AUTH_MAX = '200';

  const { main } = require('../src/server');
  const { server } = await main();

  for (const s of sessions) {
    const r = await call('POST', '/api/sessions', { title: s.title });
    if (r.status !== 201) {
      console.error('[seed] session failed:', r.status, JSON.stringify(r.json).slice(0, 200));
      continue;
    }
    const id = r.json.data._id;
    for (const img of s.images) {
      const ir = await call('POST', '/api/images', { session_id: id, ...img });
      if (ir.status !== 201) console.error('[seed] image failed:', ir.status, JSON.stringify(ir.json).slice(0, 200));
    }
    console.log(`[seed] session "${s.title}" → ${s.images.length} images`);
  }

  const total = await call('GET', '/api/images?limit=100');
  console.log(`[seed] total images in DB: ${total.json.pagination.total}`);
  console.log('[seed] READY — api on :3333 · app password "demo-app-password"');

  const shutdown = () => {
    server.close();
    mongod.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  setInterval(() => {}, 10000); // keep alive
})().catch((e) => {
  console.error('[seed] fatal:', e);
  process.exit(1);
});
