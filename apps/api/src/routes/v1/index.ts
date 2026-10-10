import { Router, type RequestHandler } from 'express';

/**
 * Admin API (`/api/v1`). Auth endpoints manage their own guards; every other module
 * router is mounted behind `authenticate`, and each route adds `requirePermission(...)`.
 * Module routers (products, orders, ...) are added here phase by phase.
 */
export function createAdminRouter(deps: { authRouter: Router; authenticate: RequestHandler }): Router {
  const r = Router();
  r.use('/auth', deps.authRouter);

  const secured = Router();
  secured.use(deps.authenticate);
  // e.g. secured.use('/products', productsRouter)   — phase 3
  r.use(secured);

  return r;
}
