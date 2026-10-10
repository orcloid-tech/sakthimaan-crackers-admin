import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Env } from './config/env.js';
import type { Logger } from './config/logger.js';
import { createAuthController } from './controllers/auth.controller.js';
import { authenticate } from './middlewares/auth.js';
import { requireCaptcha } from './middlewares/captcha.js';
import { adminCors, publicCors, requireAllowedOrigin } from './middlewares/cors.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import {
  adminApiLimiter,
  authLimiter,
  publicReadLimiter,
  publicWriteLimiter,
} from './middlewares/rate-limit.js';
import { genRequestId, requestIdOf } from './middlewares/request-context.js';
import { mongoSanitize } from './middlewares/sanitize.js';
import { ApiDocs } from './openapi/registry.js';
import type { CaptchaVerifier } from './providers/captcha/captcha.provider.js';
import type { Mailer } from './providers/mail/mailer.js';
import type { TwoFactorProviders } from './providers/two-factor/two-factor.provider.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createAuthRouter } from './routes/v1/auth.routes.js';
import { createAdminRouter } from './routes/v1/index.js';
import { createPublicRouter } from './routes/v1/public/index.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { TokenService } from './services/token.service.js';

export const API_VERSION = '0.1.0';

export interface AppDeps {
  env: Env;
  logger: Logger;
  mailer: Mailer;
  captcha: CaptchaVerifier;
  twoFactor?: TwoFactorProviders;
  /** Reported by /health/ready so the load balancer drains this instance during shutdown. */
  isShuttingDown?: () => boolean;
}

export interface AppContainer {
  app: Express;
  services: { auth: AuthService; audit: AuditService; tokens: TokenService };
  docs: ApiDocs;
}

/**
 * Builds the Express app. No I/O happens here (DB connection and listen are in
 * server.ts), so tests create as many isolated instances as they need.
 */
export function createApp(deps: AppDeps): AppContainer {
  const { env, logger } = deps;

  // ---- services
  const tokens = new TokenService(env);
  const audit = new AuditService(logger);
  const auth = new AuthService({
    env,
    logger,
    tokens,
    audit,
    mailer: deps.mailer,
    twoFactor: deps.twoFactor ?? {},
  });
  const docs = new ApiDocs();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple'); // no nested objects from query strings

  // ---- observability: request id + structured request log
  app.use(
    pinoHttp({
      logger,
      genReqId: genRequestId,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', requestIdOf(req));
    next();
  });

  // ---- security headers on every response (the docs route relaxes CSP for itself below)
  app.use(helmet());

  // ---- health (no CORS / rate limit; used by Docker and the load balancer)
  app.use(createHealthRouter({ version: API_VERSION, isShuttingDown: deps.isShuttingDown ?? (() => false) }));

  // ---- API docs (relaxed CSP for Swagger UI only)
  if (env.API_DOCS_ENABLED) {
    app.get('/api/openapi.json', (_req, res) => {
      res.json(docs.toOpenApi({ title: 'Sakthimaan Crackers API', version: API_VERSION }));
    });
    app.use(
      '/api/docs',
      helmet({
        contentSecurityPolicy: {
          directives: { 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'] },
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json' } }),
    );
  }

  // ---- CORS (before body parsing so error responses carry CORS headers)
  const corsForPublic = publicCors(env.CORS_PUBLIC_ORIGINS);
  const corsForAdmin = adminCors(env.CORS_ADMIN_ORIGINS);
  app.use('/api', (req, res, next) =>
    (req.path.startsWith('/v1/public') ? corsForPublic : corsForAdmin)(req, res, next),
  );

  // ---- parsing + sanitising
  app.use(compression());
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.use(mongoSanitize);

  // ---- public API (customer website)
  const publicRouter = createPublicRouter({
    writeGuards: [publicWriteLimiter(env.RATE_LIMIT_PUBLIC_WRITE_PER_10MIN), requireCaptcha(deps.captcha)],
    docs,
  });
  app.use(
    '/api/v1/public',
    publicReadLimiter(env.RATE_LIMIT_PUBLIC_READ_PER_MIN),
    publicRouter,
    notFoundHandler,
  );

  // ---- admin API
  const authController = createAuthController(auth, env);
  const authMiddleware = authenticate(tokens);
  const authRouter = createAuthRouter({
    controller: authController,
    authenticate: authMiddleware,
    authLimiter: authLimiter(env.RATE_LIMIT_AUTH_PER_15MIN),
    originGuard: requireAllowedOrigin(env.CORS_ADMIN_ORIGINS),
    docs,
  });
  app.use(
    '/api/v1',
    adminApiLimiter(env.RATE_LIMIT_ADMIN_PER_MIN),
    createAdminRouter({ authRouter, authenticate: authMiddleware }),
  );

  // ---- errors
  app.use(notFoundHandler);
  app.use(errorHandler({ exposeInternalErrors: !env.isProduction }));

  return { app, services: { auth, audit, tokens }, docs };
}
