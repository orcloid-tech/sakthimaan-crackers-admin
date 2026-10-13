import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { deploymentWarnings, loadEnv, withVercelPreviewUrls } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createCaptchaVerifier } from './providers/captcha/captcha.provider.js';
import { createMailer } from './providers/mail/mailer.js';
import { encryptionStartupErrors } from './services/encryption.js';
import { loadRuntimeSettings } from './services/runtime-settings.js';

/**
 * Vercel Functions entrypoint (see vercel.json). Same startup as server.ts, but the
 * platform owns the HTTP server and instance lifecycle, so the app is exported instead of
 * listening, and there are no signal or crash handlers. Startup errors throw, which fails
 * the cold start and shows up in the function logs.
 */
const env = loadEnv(withVercelPreviewUrls(process.env));
const startupErrors = encryptionStartupErrors(env);
if (startupErrors.length) {
  throw new Error(`Invalid environment configuration:\n  - ${startupErrors.join('\n  - ')}`);
}

const logger = createLogger(env);
await connectDb(env.MONGODB_URI, logger, { autoIndex: !env.isProduction });
for (const warning of deploymentWarnings(env)) logger.warn(warning);
await loadRuntimeSettings(logger);

const { app } = createApp({
  env,
  logger,
  mailer: createMailer(env, logger),
  captcha: createCaptchaVerifier(env.CAPTCHA_PROVIDER),
});

export default app;
