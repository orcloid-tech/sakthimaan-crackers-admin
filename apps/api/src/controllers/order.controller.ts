import type { Request } from 'express';
import { z } from 'zod';
import {
  adminOrderCreateSchema,
  commentSchema,
  dashboardQuery,
  dispatchSchema,
  idParams,
  mobileSchema,
  objectIdSchema,
  orderListQuery,
  orderUpdateSchema,
  paymentCreateSchema,
  paymentVoidSchema,
  pricingPreviewSchema,
  publicOrderSchema,
  transitionSchema,
  whatsappQuery,
} from '@sakthimaan/shared';
import { authOf } from '../middlewares/auth.js';
import { requestMeta } from '../middlewares/request-context.js';
import { validated } from '../middlewares/validate.js';
import { CustomerModel, TransportPartnerModel } from '../models/index.js';
import type { DashboardService } from '../services/orders/dashboard.service.js';
import type { OrderDocuments } from '../services/orders/order-documents.js';
import type { Actor, OrderService } from '../services/orders/order.service.js';
import { sendCreated, sendFile, sendOk } from '../utils/http.js';

function actorOf(req: Request): Actor {
  const a = authOf(req);
  return { user: a.userId, name: a.name, role: a.role, permissions: a.permissions };
}

export function createOrderController(deps: {
  orders: OrderService;
  documents: OrderDocuments;
  dashboard: DashboardService;
}) {
  const { orders, documents, dashboard } = deps;
  const pdf = 'application/pdf';
  return {
    list: validated({ query: orderListQuery }, async ({ query }, _req, res) => {
      const { items, total } = await orders.list(query);
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total });
    }),
    get: validated({ params: idParams }, async ({ params }, _req, res) => {
      sendOk(res, await orders.get(params.id));
    }),
    preview: validated({ body: pricingPreviewSchema }, async ({ body }, _req, res) => {
      sendOk(res, await orders.preview(body));
    }),
    create: validated({ body: adminOrderCreateSchema }, async ({ body }, req, res) => {
      sendCreated(res, await orders.createByStaff(body, actorOf(req), requestMeta(req)));
    }),
    update: validated({ params: idParams, body: orderUpdateSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await orders.updateEnquiry(params.id, body, actorOf(req), requestMeta(req)));
    }),
    transition: validated(
      { params: idParams, body: transitionSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await orders.transition(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    comment: validated({ params: idParams, body: commentSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await orders.addComment(params.id, body, actorOf(req)));
    }),
    recordPayment: validated(
      { params: idParams, body: paymentCreateSchema },
      async ({ params, body }, req, res) => {
        const files = Array.isArray(req.files) ? req.files : [];
        const result = await orders.recordPayment(
          params.id,
          body,
          files[0]?.buffer,
          actorOf(req),
          requestMeta(req),
        );
        sendCreated(res, result);
      },
    ),
    voidPayment: validated(
      { params: idParams, body: paymentVoidSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await orders.voidPayment(params.id, body.reason, actorOf(req), requestMeta(req)));
      },
    ),
    dispatch: validated({ params: idParams, body: dispatchSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await orders.setDispatch(params.id, body, actorOf(req), requestMeta(req)));
    }),
    issueInvoice: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await orders.issueInvoice(params.id, actorOf(req), requestMeta(req)));
    }),
    invoicePdf: validated({ params: idParams }, async ({ params }, _req, res) => {
      const { buffer, filename } = await documents.invoicePdf(params.id);
      sendFile(res, { buffer, filename, contentType: pdf }, 'inline');
    }),
    packingSlipPdf: validated({ params: idParams }, async ({ params }, _req, res) => {
      const { buffer, filename } = await documents.packingSlipPdf(params.id);
      sendFile(res, { buffer, filename, contentType: pdf }, 'inline');
    }),
    creditNotePdf: validated(
      { params: z.strictObject({ cnId: objectIdSchema }) },
      async ({ params }, _req, res) => {
        const { buffer, filename } = await documents.creditNotePdf(params.cnId);
        sendFile(res, { buffer, filename, contentType: pdf }, 'inline');
      },
    ),
    whatsapp: validated({ params: idParams, query: whatsappQuery }, async ({ params, query }, _req, res) => {
      sendOk(res, await orders.whatsappLink(params.id, query.event));
    }),
    transportPartners: async (_req: Request, res: Parameters<typeof sendOk>[0]) => {
      const rows = await TransportPartnerModel.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
      sendOk(
        res,
        rows.map((t) => ({
          id: String(t._id),
          name: t.name,
          phones: t.phones,
          servedStates: t.servedStates,
        })),
      );
    },
    customerLookup: validated({ query: z.object({ phone: mobileSchema }) }, async ({ query }, _req, res) => {
      const c = await CustomerModel.findOne({ phone: query.phone }).lean();
      sendOk(
        res,
        c
          ? {
              id: String(c._id),
              name: c.name,
              phone: c.phone,
              altPhone: c.altPhone ?? null,
              email: c.email ?? null,
              gstin: c.gstin ?? null,
              isBlocked: c.isBlocked,
              creditAllowed: c.creditAllowed,
              orderCount: c.stats?.orderCount ?? 0,
              addresses: c.addresses.map((a) => a.address),
            }
          : null,
      );
    }),
    dashboard: validated({ query: dashboardQuery }, async ({ query }, _req, res) => {
      sendOk(res, await dashboard.summary(query.days, query.refresh ?? false));
    }),
  };
}

export function createPublicOrderController(orders: OrderService) {
  return {
    submit: validated({ body: publicOrderSchema }, async ({ body }, req, res) => {
      sendCreated(res, await orders.createFromWebsite(body, requestMeta(req)));
    }),
    preview: validated({ body: pricingPreviewSchema }, async ({ body }, _req, res) => {
      const p = await orders.preview(body);
      // Website view: no stock figures.
      sendOk(res, {
        items: p.items,
        pricing: p.pricing,
        serviceability: p.serviceability,
        meetsMinimum: p.meetsMinimum,
        unavailable: p.unavailable,
      });
    }),
    track: validated(
      { query: z.object({ orderNo: z.string().trim().min(5).max(40), phone: mobileSchema }) },
      async ({ query }, _req, res) => {
        sendOk(res, await orders.trackForCustomer(query.orderNo.toUpperCase(), query.phone));
      },
    ),
  };
}
