import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';

/** Connects this test file to its own database on the shared in-memory replica set. */
export function useTestDb(): void {
  beforeAll(async () => {
    const uri = new URL(inject('mongoUri'));
    uri.pathname = `/test_${randomUUID().slice(0, 8)}`;
    await mongoose.connect(uri.toString());
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export async function clearCollections(...names: string[]): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.entries(collections)
      .filter(([name]) => names.length === 0 || names.includes(name))
      .map(([, c]) => c.deleteMany({})),
  );
}
