/**
 * Writes the files the website developer needs (no database or server required):
 *   docs/storefront-client.ts       typed client + all public types (copy into the website repo)
 *   docs/public-api.openapi.json    OpenAPI 3 spec of /api/v1/public only
 *
 *   npm run storefront:export -w @sakthimaan/api
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { NoopCaptchaVerifier } from '../providers/captcha/captcha.provider.js';
import { ConsoleMailer } from '../providers/mail/mailer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const docsDir = path.join(root, 'docs');

// createApp only builds routes (no I/O), so placeholder settings are enough here.
const env = loadEnv({
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  MONGODB_URI: 'mongodb://unused/export',
  ADMIN_APP_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'export-only-'.padEnd(48, 'x'),
  ENCRYPTION_KEY: 'export-only-encryption-'.padEnd(48, 'y'),
});
const logger = pino({ level: 'silent' });
const { docs } = createApp({
  env,
  logger,
  mailer: new ConsoleMailer(logger),
  captcha: new NoopCaptchaVerifier(),
});

const spec = docs.toOpenApi({ title: 'Storefront API', version: API_VERSION }) as {
  paths: Record<string, unknown>;
  [k: string]: unknown;
};
spec.paths = Object.fromEntries(Object.entries(spec.paths).filter(([p]) => p.startsWith('/api/v1/public')));
spec.info = {
  title: 'Storefront API (/api/v1/public)',
  version: API_VERSION,
  description:
    'Public endpoints for the customer website. Response types: docs/storefront-client.ts. Guide: docs/PUBLIC_API.md.',
};
writeFileSync(path.join(docsDir, 'public-api.openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);

copyFileSync(
  path.join(root, 'packages/shared/src/storefront-api.ts'),
  path.join(docsDir, 'storefront-client.ts'),
);
console.log(
  `Wrote docs/public-api.openapi.json (${Object.keys(spec.paths).length} paths) and docs/storefront-client.ts`,
);
