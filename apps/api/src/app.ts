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
import { sendOk } from './utils/http.js';
import { createAuthRouter } from './routes/v1/auth.routes.js';
import { createAdminRouter } from './routes/v1/index.js';
import { createPublicRouter } from './routes/v1/public/index.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { CategoryService } from './services/catalog/category.service.js';
import { InventoryService } from './services/catalog/inventory.service.js';
import { PriceListService } from './services/catalog/price-list.service.js';
import { ProductIoService } from './services/catalog/product-io.service.js';
import { MAX_PRODUCT_IMAGES, ProductService } from './services/catalog/product.service.js';
import { SettingsCache } from './services/settings-cache.js';
import { TokenService } from './services/token.service.js';
import {
  createCategoryController,
  createInventoryController,
  createProductController,
} from './controllers/catalog.controller.js';
import { imageUpload, spreadsheetUpload } from './middlewares/upload.js';
import { LocalStorage, createStorage, type StorageProvider } from './providers/storage/index.js';
import {
  createCategoriesRouter,
  createInventoryRouter,
  createProductsRouter,
} from './routes/v1/catalog.routes.js';
import { createOrderController, createPublicOrderController } from './controllers/order.controller.js';
import { createOrdersRouters, registerPublicOrderRoutes } from './routes/v1/orders.routes.js';
import { DashboardService } from './services/orders/dashboard.service.js';
import { OrderBuilder } from './services/orders/order-builder.js';
import { OrderDocuments } from './services/orders/order-documents.js';
import { OrderService } from './services/orders/order.service.js';
import {
  createCustomerController,
  createSettingsController,
  createShippingController,
} from './controllers/admin.controller.js';
import {
  createCustomersRouter,
  createSettingsRouter,
  createShippingRouter,
} from './routes/v1/admin.routes.js';
import { createAuditRouter, createReportsRouter } from './routes/v1/insights.routes.js';
import { AuditQueryService } from './services/audit-query.service.js';
import { CompanyAssets } from './services/company-assets.js';
import { createEncryption } from './services/encryption.js';
import { StorefrontService } from './services/storefront.service.js';
import { ReportsService } from './services/reports/reports.service.js';
import { CustomerService } from './services/customer.service.js';
import { SettingsService } from './services/settings.service.js';
import { ShippingService } from './services/shipping.service.js';

export const API_VERSION = '0.1.0';

export interface AppDeps {
  env: Env;
  logger: Logger;
  mailer: Mailer;
  captcha: CaptchaVerifier;
  twoFactor?: TwoFactorProviders;
  /** Reported by /health/ready so the load balancer drains this instance during shutdown. */
  isShuttingDown?: () => boolean;
  /** Defaults to the provider selected by STORAGE_PROVIDER. */
  storage?: StorageProvider;
}

export interface AppContainer {
  app: Express;
  services: {
    auth: AuthService;
    audit: AuditService;
    tokens: TokenService;
    settings: SettingsCache;
    inventory: InventoryService;
    categories: CategoryService;
    products: ProductService;
    productIo: ProductIoService;
    priceList: PriceListService;
    orders: OrderService;
    dashboard: DashboardService;
    settingsService: SettingsService;
    shipping: ShippingService;
    customers: CustomerService;
  };
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
  const settings = new SettingsCache();
  const encryption = createEncryption(env, logger);
  const auth = new AuthService({
    env,
    logger,
    encryption,
    tokens,
    audit,
    mailer: deps.mailer,
    twoFactor: deps.twoFactor ?? {},
    storeName: async () => (await settings.get())?.company?.name || null,
  });
  const docs = new ApiDocs();
  const storage = deps.storage ?? createStorage(env);
  const inventory = new InventoryService(audit);
  const categories = new CategoryService(audit, storage);
  const products = new ProductService({ audit, inventory, storage, settings });
  const productIo = new ProductIoService({ audit, inventory, settings, maxRows: env.IMPORT_MAX_ROWS });
  const companyAssets = new CompanyAssets(storage, settings, logger);
  const priceList = new PriceListService(settings, companyAssets);
  const orderBuilder = new OrderBuilder(settings);
  const orders = new OrderService({ audit, inventory, settings, builder: orderBuilder, storage });
  const orderDocuments = new OrderDocuments(settings, companyAssets);
  const dashboard = new DashboardService();
  const settingsService = new SettingsService({ audit, cache: settings, storage });
  const shipping = new ShippingService({ audit, settings });
  const customers = new CustomerService({ audit });

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

  // ---- local uploads (development storage only; production images are on Cloudinary)
  if (storage instanceof LocalStorage) {
    app.use(
      '/uploads',
      (_req, res, next) => {
        // Let the admin app (another origin) display these images.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      },
      express.static(storage.directory, { index: false, dotfiles: 'deny', immutable: true, maxAge: '30d' }),
    );
  }

  // ---- health (no CORS / rate limit; used by Docker and the load balancer)
  app.use(createHealthRouter({ version: API_VERSION, isShuttingDown: deps.isShuttingDown ?? (() => false) }));

  // ---- API docs (relaxed CSP for Swagger UI only)
  if (env.API_DOCS_ENABLED) {
    app.get('/api/openapi.json', (_req, res) => {
      res.json(docs.toOpenApi({ title: 'Store admin API', version: API_VERSION }));
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
  const adminOrigins = { origins: env.CORS_ADMIN_ORIGINS, allowLan: env.DEV_ALLOW_LAN_ORIGINS };
  const corsForAdmin = adminCors(adminOrigins);
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
    heavyGuards: [publicWriteLimiter(env.RATE_LIMIT_PUBLIC_WRITE_PER_10MIN)],
    storefront: new StorefrontService({ builder: orderBuilder, priceList }),
    publicBaseUrl: env.PUBLIC_API_URL,
    docs,
    modules: [(r, guards, d) => registerPublicOrderRoutes(r, createPublicOrderController(orders), guards, d)],
  });
  app.use(
    '/api/v1/public',
    publicReadLimiter(env.RATE_LIMIT_PUBLIC_READ_PER_MIN),
    publicRouter,
    notFoundHandler,
  );

  // ---- branding for the admin's sign-in page and header (no auth: name and logo only)
  app.get('/api/v1/branding', async (_req, res) => {
    const s = await settings.get();
    sendOk(res, { storeName: s?.company?.name || null, logoUrl: s?.company?.logo?.url ?? null });
  });
  docs.register({
    method: 'get',
    path: '/api/v1/branding',
    tag: 'Auth',
    auth: 'none',
    summary: 'Store name and logo for the sign-in page (null until set in Settings)',
  });

  // ---- admin API
  const authController = createAuthController(auth, env);
  const authMiddleware = authenticate(tokens);
  const authRouter = createAuthRouter({
    controller: authController,
    authenticate: authMiddleware,
    authLimiter: authLimiter(env.RATE_LIMIT_AUTH_PER_15MIN),
    originGuard: requireAllowedOrigin(adminOrigins),
    docs,
  });
  const imageUploads = imageUpload({ maxMb: env.UPLOAD_MAX_IMAGE_MB, maxFiles: MAX_PRODUCT_IMAGES });
  const orderRoutes = createOrdersRouters(
    createOrderController({ orders, documents: orderDocuments, dashboard }),
    docs,
    {
      screenshot: imageUpload({ maxMb: env.UPLOAD_MAX_IMAGE_MB, maxFiles: 1 }),
    },
  );
  const inventoryRoutes = createInventoryRouter(createInventoryController(inventory, products, audit), docs);
  app.use(
    '/api/v1',
    adminApiLimiter(env.RATE_LIMIT_ADMIN_PER_MIN),
    createAdminRouter({
      authRouter,
      authenticate: authMiddleware,
      modules: [
        {
          path: '/categories',
          router: createCategoriesRouter(
            createCategoryController(categories),
            docs,
            imageUpload({ maxMb: env.UPLOAD_MAX_IMAGE_MB, maxFiles: 1 }),
          ),
        },
        { path: '/products', router: inventoryRoutes.ledger },
        {
          path: '/products',
          router: createProductsRouter(
            createProductController({ products, io: productIo, priceList }),
            docs,
            {
              images: imageUploads,
              spreadsheet: spreadsheetUpload({ maxMb: env.IMPORT_MAX_FILE_MB }),
            },
          ),
        },
        { path: '/inventory', router: inventoryRoutes.inventory },
        { path: '/orders', router: orderRoutes.orders },
        { path: '/payments', router: orderRoutes.payments },
        { path: '/', router: orderRoutes.misc },
        {
          path: '/settings',
          router: createSettingsRouter(
            createSettingsController(settingsService),
            docs,
            imageUpload({ maxMb: env.UPLOAD_MAX_IMAGE_MB, maxFiles: 1 }),
          ),
        },
        { path: '/shipping', router: createShippingRouter(createShippingController(shipping), docs) },
        { path: '/customers', router: createCustomersRouter(createCustomerController(customers), docs) },
        { path: '/audit', router: createAuditRouter(new AuditQueryService(), docs) },
        { path: '/reports', router: createReportsRouter(new ReportsService(settings), docs) },
      ],
    }),
  );

  // ---- errors
  app.use(notFoundHandler);
  app.use(errorHandler({ exposeInternalErrors: !env.isProduction }));

  return {
    app,
    services: {
      auth,
      audit,
      tokens,
      settings,
      inventory,
      categories,
      products,
      productIo,
      priceList,
      orders,
      dashboard,
      settingsService,
      shipping,
      customers,
    },
    docs,
  };
}
