import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { EnvValidationError, deploymentWarnings, loadEnv } from './config/env.js';
import { createLogger, type Logger } from './config/logger.js';
import { createCaptchaVerifier } from './providers/captcha/captcha.provider.js';
import { createMailer } from './providers/mail/mailer.js';
import { loadRuntimeSettings } from './services/runtime-settings.js';

const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    // Logger isn't configured yet; print plainly and exit non-zero.
    console.error(err instanceof EnvValidationError ? err.message : err);
    process.exit(1);
  }

  const logger = createLogger(env);
  let shuttingDown = false;

  await connectDb(env.MONGODB_URI, logger, { autoIndex: !env.isProduction });
  for (const warning of deploymentWarnings(env)) logger.warn(warning);
  await loadRuntimeSettings(logger);

  const { app } = createApp({
    env,
    logger,
    mailer: createMailer(env, logger),
    captcha: createCaptchaVerifier(env.CAPTCHA_PROVIDER),
    isShuttingDown: () => shuttingDown,
  });

  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, docs: env.API_DOCS_ENABLED ? '/api/docs' : 'disabled' },
      'API listening',
    );
  });
  // Keep idle connections open longer than the load balancer's (Render/ALB ~60s) to avoid 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: draining connections');
    const force = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    server.close((err) => {
      void (async () => {
        if (err) logger.error({ err }, 'Error while closing HTTP server');
        await disconnectDb().catch((e: unknown) => logger.error({ err: e }, 'Error closing MongoDB'));
        logger.info('Shutdown complete');
        process.exit(exitCode);
      })();
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  registerCrashHandlers(logger, shutdown);
}

function registerCrashHandlers(logger: Logger, shutdown: (signal: string, code: number) => void): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
  });
}

void main().catch((err: unknown) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
