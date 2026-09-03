/**
 * Express app factory (no listen — keeps the app testable).
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { CONFIG } = require('./config');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', CONFIG.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false })); // docs page ships inline styles
  app.use(
    cors({
      origin: CONFIG.CORS_ORIGINS.includes('*') ? true : CONFIG.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'Origin', 'X-API-Key', 'X-App-Password'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: '256kb' }));

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
