import { Router, type Request, type RequestHandler } from 'express';
import {
  storefrontPriceListQuery,
  storefrontProductQuery,
  storefrontServiceabilityQuery,
  storefrontSlugParams,
  type StorefrontPage,
} from '@sakthimaan/shared';
import { validated } from '../../../middlewares/validate.js';
import type { ApiDocs } from '../../../openapi/registry.js';
import type { AbsoluteUrl, StorefrontService } from '../../../services/storefront.service.js';
import { sendFile, sendOk } from '../../../utils/http.js';

/**
 * Public API for the customer website (`sakthimaan-crackers` repo): no admin auth,
 * own CORS allowlist and rate limits (applied in app.ts). Write endpoints use
 * `writeGuards` (strict per-IP limit + captcha). Responses expose storefront-safe
 * fields only; their types are in shared `storefront-api.ts` (see docs/PUBLIC_API.md).
 */
export function createPublicRouter(deps: {
  writeGuards: RequestHandler[];
  /** Strict per-IP limit for heavy reads (price list PDF). */
  heavyGuards: RequestHandler[];
  docs: ApiDocs;
  storefront: StorefrontService;
  /** Base for relative file URLs (local uploads); defaults to the request's own origin. */
  publicBaseUrl?: string;
  /** Feature modules add their public routes here (orders, …). */
  modules?: readonly ((r: Router, writeGuards: RequestHandler[], docs: ApiDocs) => void)[];
}): Router {
  const r = Router();
  const { storefront: sf } = deps;
  const absFor =
    (req: Request): AbsoluteUrl =>
    (url) =>
      /^https?:\/\//.test(url)
        ? url
        : new URL(url, deps.publicBaseUrl ?? `${req.protocol}://${req.get('host')}`).toString();

  r.get('/store', async (req, res) => sendOk(res, await sf.store(absFor(req))));
  r.get('/categories', async (req, res) => sendOk(res, await sf.categories(absFor(req))));
  r.get(
    '/products',
    validated({ query: storefrontProductQuery }, async ({ query }, req, res) => {
      const { items, total } = await sf.products(query, absFor(req));
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total } satisfies StorefrontPage);
    }),
  );
  r.get(
    '/products/:slug',
    validated({ params: storefrontSlugParams }, async ({ params }, req, res) => {
      sendOk(res, await sf.product(params.slug, absFor(req)));
    }),
  );
  r.get(
    '/gift-boxes',
    validated({ query: storefrontProductQuery }, async ({ query }, req, res) => {
      const { items, total } = await sf.products({ ...query, type: 'combo' }, absFor(req));
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total } satisfies StorefrontPage);
    }),
  );
  r.get('/delivery', async (_req, res) => sendOk(res, await sf.delivery()));
  r.get(
    '/serviceability',
    validated({ query: storefrontServiceabilityQuery }, async ({ query }, _req, res) => {
      sendOk(res, await sf.serviceability(query.stateCode, query.city));
    }),
  );
  r.get(
    '/price-list.pdf',
    ...deps.heavyGuards,
    validated({ query: storefrontPriceListQuery }, async ({ query }, _req, res) => {
      const buffer = await sf.priceList(query.category);
      sendFile(
        res,
        {
          buffer,
          filename: `price-list${query.category ? `-${query.category}` : ''}.pdf`,
          contentType: 'application/pdf',
        },
        'inline',
      );
    }),
  );

  for (const register of deps.modules ?? []) register(r, deps.writeGuards, deps.docs);

  const tag = 'Public (website)';
  const doc = (
    method: 'get',
    path: string,
    summary: string,
    query?: Parameters<ApiDocs['register']>[0]['query'],
  ) =>
    deps.docs.register({
      method,
      path: `/api/v1/public${path}`,
      tag,
      auth: 'none',
      summary,
      ...(query ? { query } : {}),
    });
  doc(
    'get',
    '/store',
    'Store details: name, logo, contact, licence, open/closed, order mode, minimum order, payment details',
  );
  doc('get', '/categories', 'Active categories with sub-categories and product counts');
  doc(
    'get',
    '/products',
    'Active products (filter by category slug, text, type, green, featured, in stock; sort; paginate)',
    storefrontProductQuery,
  );
  doc('get', '/products/{slug}', 'One product: images, description, safety, gift box contents');
  doc('get', '/gift-boxes', 'Active gift boxes (same filters as /products)', storefrontProductQuery);
  doc(
    'get',
    '/delivery',
    'Where the store delivers: states, zones, delivery charges, minimum orders, city exceptions',
  );
  doc(
    'get',
    '/serviceability',
    'Can we deliver to this state/city, and the minimum order there',
    storefrontServiceabilityQuery,
  );
  doc(
    'get',
    '/price-list.pdf',
    'Printable price list (PDF; optional ?category=slug). Strict rate limit.',
    storefrontPriceListQuery,
  );
  return r;
}
