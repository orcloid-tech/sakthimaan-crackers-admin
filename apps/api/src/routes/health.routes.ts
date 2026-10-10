import { Router } from 'express';
import { isDbReady } from '../config/db.js';

/**
 * Liveness (`/health`): the process is up — never touches dependencies, so a DB blip
 * doesn't get the container restarted. Readiness (`/health/ready`): DB reachable, so
 * the load balancer only routes traffic to instances that can serve it.
 */
export function createHealthRouter(opts: { version: string; isShuttingDown: () => boolean }): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: opts.version, uptimeSeconds: Math.round(process.uptime()) });
  });

  r.get('/health/ready', async (_req, res) => {
    const db = await isDbReady();
    const ready = db && !opts.isShuttingDown();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: { database: db ? 'up' : 'down', shuttingDown: opts.isShuttingDown() },
    });
  });

  return r;
}
