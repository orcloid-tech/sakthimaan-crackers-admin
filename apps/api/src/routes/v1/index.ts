import { Router, type RequestHandler } from 'express';

/**
 * Admin API (`/api/v1`). Auth endpoints manage their own guards; every module router is
 * mounted behind `authenticate`, and each route adds `requirePermission(...)`.
 */
export function createAdminRouter(deps: {
  authRouter: Router;
  authenticate: RequestHandler;
  modules: readonly { path: string; router: Router }[];
}): Router {
  const r = Router();
  r.use('/auth', deps.authRouter);

  const secured = Router();
  secured.use(deps.authenticate);
  for (const m of deps.modules) secured.use(m.path, m.router);
  r.use(secured);

  return r;
}
