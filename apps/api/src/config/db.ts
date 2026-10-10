import mongoose from 'mongoose';
import type { Logger } from './logger.js';

mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB. The deployment must be a replica set (Atlas, local docker `rs0`,
 * or mongodb-memory-server) because stock and order operations use transactions.
 */
export async function connectDb(
  uri: string,
  logger: Logger,
  opts: { autoIndex: boolean },
): Promise<typeof mongoose> {
  const conn = mongoose.connection;
  conn.on('disconnected', () => logger.warn('MongoDB disconnected'));
  conn.on('reconnected', () => logger.info('MongoDB reconnected'));
  conn.on('error', (err: unknown) => logger.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(uri, {
    autoIndex: opts.autoIndex, // off in production: run `npm run db:indexes` on deploy instead
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });

  const hello = await conn.db?.admin().command({ hello: 1 });
  if (!hello?.setName) {
    logger.warn('MongoDB is not a replica set: transactions will fail. See docker-compose.yml.');
  }
  logger.info({ db: conn.name, replicaSet: hello?.setName ?? null }, 'MongoDB connected');
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/** Readiness: connected and answering a ping. */
export async function isDbReady(): Promise<boolean> {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) return false;
  try {
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}
