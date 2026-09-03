/**
 * Server bootstrap — connect MongoDB, then listen. Graceful shutdown included
 * (Render sends SIGTERM on deploys / spin-down).
 */
const { CONFIG, assertCriticals } = require('./config');
const { connectDb, disconnectDb, dbState, mongoose } = require('./db');
const { createApp } = require('./app');
const { cleanupBadAuth } = require('./middleware/auth');

async function main() {
  assertCriticals();
  await connectDb();

  const app = createApp();
  const server = app.listen(CONFIG.PORT, () => {
    console.log(`[api] adobe-stock-images-generator-api v${CONFIG.VERSION} listening on :${CONFIG.PORT} (${CONFIG.NODE_ENV})`);
  });

  // Periodic cleanup of the brute-force tracker
  const cleaner = setInterval(cleanupBadAuth, 60_000);
  cleaner.unref();

  const shutdown = async (signal) => {
    console.log(`[api] ${signal} received — shutting down`);
    server.close();
    try {
      await disconnectDb();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, app, dbState, mongoose };
}

// Only auto-start when executed directly (not when required by tests).
if (require.main === module) {
  main().catch((e) => {
    console.error('[api] fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { main };
