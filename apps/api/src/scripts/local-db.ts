/**
 * Offline fallback for local development without Docker or Atlas: a single-node
 * MongoDB replica set (transactions work) using the binary that mongodb-memory-server
 * downloads. Data persists in apps/api/.local-db between runs.
 *
 *   npm run db:local -w @sakthimaan/api      # keep this terminal open
 *   MONGODB_URI=mongodb://127.0.0.1:27017/sakthimaan?replicaSet=rs0&directConnection=true
 *
 * The recommended setup is the shared Atlas dev cluster (see README).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.LOCAL_DB_PORT ?? 27017);
const dbPath = fileURLToPath(new URL('../../.local-db', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});

console.log(`Local MongoDB replica set ready (data: ${dbPath})`);
console.log(`MONGODB_URI=mongodb://127.0.0.1:${port}/sakthimaan?replicaSet=rs0&directConnection=true`);
console.log('Press Ctrl+C to stop.');

const stop = () => {
  // doCleanup: false keeps the data directory.
  void replSet.stop({ doCleanup: false }).then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
