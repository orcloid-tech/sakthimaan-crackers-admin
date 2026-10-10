import { Router, type RequestHandler } from 'express';
import {
  adminOrderCreateSchema,
  commentSchema,
  dashboardQuery,
  dispatchSchema,
  orderListQuery,
  orderUpdateSchema,
  paymentVoidSchema,
  pricingPreviewSchema,
  publicOrderSchema,
  transitionSchema,
  whatsappQuery,
  type Permission,
} from '@sakthimaan/shared';
import type {
  createOrderController,
  createPublicOrderController,
} from '../../controllers/order.controller.js';
import { requireAnyPermission, requirePermission } from '../../middlewares/auth.js';
import type { ApiDocs, RouteDoc } from '../../openapi/registry.js';

type Doc = Omit<RouteDoc, 'method' | 'path' | 'auth' | 'permissions' | 'tag'>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export function createOrdersRouters(
  c: ReturnType<typeof createOrderController>,
  docs: ApiDocs,
  uploads: { screenshot: RequestHandler },
) {
  const orders = Router();
  const payments = Router();
  const misc = Router();

  const add = (
    r: Router,
    base: string,
    tag: string,
    m: Method,
    p: string,
    perms: Permission[],
    any: boolean,
    h: RequestHandler[],
    d: Doc,
  ) => {
    r[m](p, any ? requireAnyPermission(...perms) : requirePermission(...perms), ...h);
    docs.register({ ...d, method: m, path: `${base}${p}`, tag, auth: 'bearer', permissions: perms });
  };
  const o = (m: Method, p: string, perms: Permission[], h: RequestHandler[], d: Doc, any = false) =>
    add(orders, '/api/v1/orders', 'Orders', m, p, perms, any, h, d);

  o('get', '/', ['orders:read'], [c.list], {
    summary: 'List orders (status, payment, state, dates; search order no., phone, name, LR)',
    query: orderListQuery,
  });
  o('post', '/', ['orders:create'], [c.create], {
    summary: 'Create an order taken by phone / WhatsApp (starts as an enquiry)',
    body: adminOrderCreateSchema,
  });
  o('post', '/preview', ['orders:read'], [c.preview], {
    summary: 'Price a list of products for a destination (totals, GST, minimum order, serviceability, stock)',
    body: pricingPreviewSchema,
  });
  o('get', '/credit-notes/:cnId/pdf', ['orders:read'], [c.creditNotePdf], { summary: 'Credit note PDF' });
  o('get', '/:id', ['orders:read'], [c.get], { summary: 'Order with lines, payments and timeline' });
  o('patch', '/:id', ['orders:update'], [c.update], {
    summary: 'Edit an enquiry (lines, address, contact, notes); prices re-read from the catalogue',
    body: orderUpdateSchema,
    responses: { 409: 'Not an enquiry, or changed by someone else' },
  });
  o(
    'post',
    '/:id/transitions',
    ['orders:confirm', 'orders:pack', 'orders:dispatch', 'orders:cancel', 'payments:record'],
    [c.transition],
    {
      summary: 'Move the order along the workflow',
      description:
        'Permission depends on the target status. Confirm deducts stock (409 INSUFFICIENT_STOCK lists every short line). ' +
        'confirmed → packed needs orders:pack_unpaid and a credit customer. Cancel returns stock and issues a credit note if invoiced.',
      body: transitionSchema,
    },
    true,
  );
  o('post', '/:id/comments', ['orders:read'], [c.comment], {
    summary: 'Add a note or internal comment',
    body: commentSchema,
  });
  o('post', '/:id/payments', ['payments:record'], [uploads.screenshot, c.recordPayment], {
    summary:
      'Record a payment or refund (multipart: amount, method, reference, paidAt, notes, kind; file "files" = screenshot)',
  });
  o('put', '/:id/dispatch', ['orders:dispatch'], [c.dispatch], {
    summary: 'Set dispatch details (transport, LR, date, boxes)',
    body: dispatchSchema,
  });
  o('post', '/:id/invoice', ['orders:invoice'], [c.issueInvoice], {
    summary: 'Issue the GST invoice (once; numbered per financial year)',
  });
  o('get', '/:id/invoice.pdf', ['orders:read'], [c.invoicePdf], { summary: 'Invoice PDF' });
  o('get', '/:id/packing-slip.pdf', ['orders:read'], [c.packingSlipPdf], {
    summary: 'Packing slip PDF (no prices)',
  });
  o('get', '/:id/whatsapp-link', ['orders:read'], [c.whatsapp], {
    summary: 'Click-to-WhatsApp link with a prefilled status message',
    query: whatsappQuery,
  });

  add(
    payments,
    '/api/v1/payments',
    'Orders',
    'post',
    '/:id/void',
    ['payments:void'],
    false,
    [c.voidPayment],
    {
      summary: 'Void a recorded payment (with reason)',
      body: paymentVoidSchema,
    },
  );

  add(
    misc,
    '/api/v1',
    'Orders',
    'get',
    '/transport-partners',
    ['shipping:read', 'orders:dispatch'],
    true,
    [c.transportPartners],
    { summary: 'Active transport partners' },
  );
  add(
    misc,
    '/api/v1',
    'Orders',
    'get',
    '/customers/lookup',
    ['customers:read', 'orders:create'],
    true,
    [c.customerLookup],
    { summary: 'Find a customer by mobile number' },
  );
  add(misc, '/api/v1', 'Dashboard', 'get', '/dashboard/summary', ['dashboard:read'], false, [c.dashboard], {
    summary: 'Sales, collections, orders by status, trends',
    query: dashboardQuery,
  });

  return { orders, payments, misc };
}

export function registerPublicOrderRoutes(
  r: Router,
  c: ReturnType<typeof createPublicOrderController>,
  writeGuards: RequestHandler[],
  docs: ApiDocs,
): void {
  r.post('/orders', ...writeGuards, c.submit);
  r.post('/orders/preview', c.preview);
  r.get('/orders/track', c.track);
  const tag = 'Public (website)';
  docs.register({
    method: 'post',
    path: '/api/v1/public/orders',
    tag,
    auth: 'none',
    body: publicOrderSchema,
    summary: 'Submit an enquiry / order from the website (captcha header X-Captcha-Token)',
    description:
      'Prices come from the catalogue. Checks store open, blocked customers, serviceable location and the minimum order.',
    responses: {
      201: 'Created',
      400: 'NOT_SERVICEABLE / BELOW_MIN_ORDER / PRODUCT_UNAVAILABLE',
      409: 'STORE_CLOSED / INSUFFICIENT_STOCK',
    },
  });
  docs.register({
    method: 'post',
    path: '/api/v1/public/orders/preview',
    tag,
    auth: 'none',
    body: pricingPreviewSchema,
    summary: 'Cart totals, minimum order and serviceability',
  });
  docs.register({
    method: 'get',
    path: '/api/v1/public/orders/track',
    tag,
    auth: 'none',
    summary: 'Order status for the customer (order number + phone)',
  });
}
