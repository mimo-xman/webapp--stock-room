/**
 * MongoDB connection (mongoose 8).
 */
const mongoose = require('mongoose');
const { CONFIG } = require('./config');

const logger = console;

async function connectDb() {
  if (!CONFIG.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured — set it in the environment (see .env.example)');
  }
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => logger.log('[db] connected'));
  mongoose.connection.on('error', (e) => logger.error('[db] error:', e.message));
  mongoose.connection.on('disconnected', () => logger.warn('[db] disconnected'));

  await mongoose.connect(CONFIG.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: true, // keep indexes in sync on free tier without migrations
  });
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.connection.close();
}

function dbState() {
  return mongoose.connection.readyState === 1 ? 'up' : 'down';
}

module.exports = { connectDb, disconnectDb, dbState, mongoose };
