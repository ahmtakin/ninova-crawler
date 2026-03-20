/**
 * MongoDB connection singleton.
 * Uses the official mongodb driver (infrastructure library — allowed).
 */

const { MongoClient } = require('mongodb');
const config = require('../config');
const logger = require('../utils/logger');
const { ensureIndexes } = require('./models');

let client = null;
let db = null;

/**
 * Connect to MongoDB and ensure indexes exist.
 * @returns {Promise<import('mongodb').Db>}
 */
async function connect() {
  if (client && db) {
    return db;
  }

  try {
    client = new MongoClient(config.mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000
    });

    await client.connect();
    db = client.db();

    // Ensure all indexes are created
    await ensureIndexes(db);

    logger.info('MongoDB connected successfully', { mongoUri: config.mongoUri.replace(/:([^:@]+)@/, ':****@') });

    return db;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', { error: error.message });
    throw error;
  }
}

/**
 * Get the database instance. Throws if not connected.
 * @returns {import('mongodb').Db}
 */
function getDb() {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

/**
 * Gracefully close the MongoDB connection.
 */
async function close() {
  if (client) {
    try {
      await client.close();
      logger.info('MongoDB connection closed');
    } catch (error) {
      logger.error('Error closing MongoDB connection', { error: error.message });
    } finally {
      client = null;
      db = null;
    }
  }
}

module.exports = { connect, getDb, close };
