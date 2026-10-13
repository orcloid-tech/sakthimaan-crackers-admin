import { Router, type Request, type Response } from 'express';
import { auditListQuery, idParams, reportParams, reportQuery, type ReportKind } from '@sakthimaan/shared';
import { authOf, requirePermission } from '../../middlewares/auth.js';
import { validated } from '../../middlewares/validate.js';
import type { ApiDocs } from '../../openapi/registry.js';
import type { AuditQueryService } from '../../services/audit-query.service.js';
import { reportWorkbook } from '../../services/reports/report-export.js';
import type { ReportsService } from '../../services/reports/reports.service.js';
import { forbidden } from '../../utils/app-error.js';
import { sendFile, sendOk } from '../../utils/http.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Audit log (read-only) at /api/v1/audit. */
export function createAuditRouter(audit: AuditQueryService, docs: ApiDocs): Router {
  const r = Router();
  const guard = requirePermission('audit:read');
  r.get(
    '/',
    guard,
    validated({ query: auditListQuery }, async ({ query }, _req, res) => {
      const { items, total } = await audit.list(query);
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total });
    }),
  );
  r.get('/actors', guard, async (_req: Request, res: Response) => sendOk(res, await audit.actors()));
  r.get(
    '/:id',
    guard,
    validated({ params: idParams }, async ({ params }, _req, res) => sendOk(res, await audit.get(params.id))),
  );
  const base = { tag: 'Audit log', auth: 'bearer' as const, permissions: ['audit:read' as const] };
  docs.register({
    ...base,
    method: 'get',
    path: '/api/v1/audit',
    query: auditListQuery,
    summary: 'Audit entries (user, action, record type, dates, text)',
  });
  docs.register({
    ...base,
    method: 'get',
    path: '/api/v1/audit/actors',
    summary: 'People who appear in the audit log (for the user filter)',
  });
  docs.register({
    ...base,
    method: 'get',
    path: '/api/v1/audit/{id}',
    summary: 'One entry with every field change (before → after)',
  });
  return r;
}

/** Reports at /api/v1/reports/:kind (JSON, or ?format=xlsx with reports:export). */
export function createReportsRouter(reports: ReportsService, docs: ApiDocs): Router {
  const r = Router();
  const run: Record<ReportKind, (q: { from?: string; to?: string }) => Promise<unknown>> = {
    sales: (q) => reports.sales(q),
    products: (q) => reports.products(q),
    states: (q) => reports.states(q),
    gst: (q) => reports.gst(q),
    payments: (q) => reports.payments(q),
    dispatch: (q) => reports.dispatch(q),
    stock: (q) => reports.stock(q),
  };
  r.get(
    '/:kind',
    requirePermission('reports:read'),
    validated({ params: reportParams, query: reportQuery }, async ({ params, query }, req, res) => {
      if (query.format === 'xlsx' && !authOf(req).permissions.has('reports:export')) {
        throw forbidden('You can view reports but not export them');
      }
      const data = await run[params.kind](query);
      if (query.format === 'xlsx') {
        const { buffer, filename } = await reportWorkbook(params.kind, data);
        sendFile(res, { buffer, filename, contentType: XLSX });
      } else sendOk(res, data);
    }),
  );
  docs.register({
    method: 'get',
    path: '/api/v1/reports/{kind}',
    tag: 'Reports',
    auth: 'bearer',
    permissions: ['reports:read'],
    query: reportQuery,
    summary:
      'sales | products | states | gst | payments | dispatch | stock. Default period: financial year to date. format=xlsx needs reports:export.',
  });
  return r;
}
