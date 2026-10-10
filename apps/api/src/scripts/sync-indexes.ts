/**
 * Builds/updates MongoDB indexes to match the schemas. Production runs with autoIndex
 * off, so run this on each deploy (before the new version takes traffic):
 *
 *   npm run db:indexes -w @sakthimaan/api
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import '../models/index.js';

async function run(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ ...env, LOG_LEVEL: 'info' });
  await connectDb(env.MONGODB_URI, logger, { autoIndex: false });
  try {
    for (const model of Object.values(mongoose.models)) {
      const dropped = await model.syncIndexes();
      logger.info({ model: model.modelName, dropped }, 'Indexes in sync');
    }
  } finally {
    await disconnectDb();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
