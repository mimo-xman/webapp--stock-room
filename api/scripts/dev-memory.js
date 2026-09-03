/**
 * Local development: in-memory MongoDB + sane defaults, zero setup.
 *   npm run dev   →  http://localhost:3333
 *
 * Data is wiped on every restart (that's the point — dev only).
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'adobe_stock_dev' } });

  process.env.MONGODB_URI = process.env.MONGODB_URI || mongod.getUri('adobe_stock_dev');
  process.env.API_KEY = process.env.API_KEY || 'dev-agent-key';
  process.env.APP_PASSWORD = process.env.APP_PASSWORD || 'dev-app-password';
  process.env.PORT = process.env.PORT || '3333';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  console.log('[dev] in-memory MongoDB:', process.env.MONGODB_URI);
  console.log('[dev] agent key:', process.env.API_KEY, '| app password:', process.env.APP_PASSWORD);

  // server.js only auto-starts when it is the entry point (require.main
  // guard added for the e2e suite) — start it explicitly here.
  const { main } = require('../src/server');
  await main();

  const shutdown = () => {
    mongod.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((e) => {
  console.error('[dev] fatal:', e);
  process.exit(1);
});
