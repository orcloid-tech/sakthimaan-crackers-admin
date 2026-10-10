import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` in a MongoDB transaction. The driver retries on transient errors
 * (write conflicts between concurrent stock updates), so `fn` must be safe to re-run:
 * only DB work with the given session, no external side effects.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
