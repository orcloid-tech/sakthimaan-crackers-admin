import { Router, type RequestHandler } from 'express';
import {
  cityInputSchema,
  customerBlockSchema,
  customerCreditSchema,
  customerListQuery,
  customerUpdateSchema,
  seasonSchema,
  settingsUpdateSchema,
  stateUpdateSchema,
  transportPartnerInputSchema,
  zoneInputSchema,
  type Permission,
} from '@sakthimaan/shared';
import type {
  createCustomerController,
  createSettingsController,
  createShippingController,
} from '../../controllers/admin.controller.js';
import { requireAnyPermission, requirePermission } from '../../middlewares/auth.js';
import type { ApiDocs, RouteDoc } from '../../openapi/registry.js';

type Doc = Omit<RouteDoc, 'method' | 'path' | 'auth' | 'permissions' | 'tag'>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Route + permission + OpenAPI entry in one call. `any`: the user needs one of the permissions. */
function adder(r: Router, docs: ApiDocs, base: string, tag: string) {
  return (m: Method, p: string, perms: Permission[], h: RequestHandler[], d: Doc, any = false) => {
    const guard =
      perms.length === 0 ? [] : [any ? requireAnyPermission(...perms) : requirePermission(...perms)];
    r[m](p, ...guard, ...h);
    docs.register({ ...d, method: m, path: `${base}${p}`, tag, auth: 'bearer', permissions: perms });
  };
}

export function createSettingsRouter(
  c: ReturnType<typeof createSettingsController>,
  docs: ApiDocs,
  upload: RequestHandler,
): Router {
  const r = Router();
  const add = adder(r, docs, '/api/v1/settings', 'Settings');
  add('get', '/', ['settings:read'], [c.get], { summary: 'All store settings' });
  add('get', '/runtime', [], [c.runtime], {
    summary: 'Settings every signed-in user needs (rounding, tax defaults, store open)',
  });
  add(
    'patch',
    '/',
    ['settings:update', 'cms:manage'],
    [c.update],
    {
      summary: 'Update one or more sections (version-checked; storefront also allowed with cms:manage)',
      body: settingsUpdateSchema,
      responses: { 409: 'VERSION_CONFLICT: changed by someone else' },
    },
    true,
  );
  add('post', '/images/:kind', ['settings:update'], [upload, c.setImage], {
    summary: 'Upload the logo or UPI QR (multipart file "files"; kind = logo | upi-qr)',
  });
  add('delete', '/images/:kind', ['settings:update'], [c.removeImage], {
    summary: 'Remove the logo or UPI QR',
  });
  add(
    'get',
    '/seasons',
    ['settings:read', 'dashboard:read'],
    [c.seasons],
    { summary: 'Sales seasons' },
    true,
  );
  add('post', '/seasons', ['settings:update'], [c.createSeason], {
    summary: 'Add a season',
    body: seasonSchema,
  });
  add('put', '/seasons/:id', ['settings:update'], [c.updateSeason], {
    summary: 'Edit a season',
    body: seasonSchema,
  });
  add('delete', '/seasons/:id', ['settings:update'], [c.deleteSeason], { summary: 'Delete a season' });
  return r;
}

export function createShippingRouter(c: ReturnType<typeof createShippingController>, docs: ApiDocs): Router {
  const r = Router();
  const add = adder(r, docs, '/api/v1/shipping', 'Shipping');
  const read: Permission[] = ['shipping:read'];
  const manage: Permission[] = ['shipping:manage'];
  add('get', '/zones', read, [c.zones], {
    summary: 'Zones with their states, minimum order and delivery rules',
  });
  add('post', '/zones', manage, [c.createZone], { summary: 'Add a zone', body: zoneInputSchema });
  add('put', '/zones/:id', manage, [c.updateZone], { summary: 'Edit a zone', body: zoneInputSchema });
  add('delete', '/zones/:id', manage, [c.deleteZone], { summary: 'Delete an unused zone' });
  add('get', '/states', read, [c.states], { summary: 'All states/UTs: serviceable, zone, minimum order' });
  add('patch', '/states', manage, [c.updateStates], {
    summary: 'Update one or many states (serviceable, zone, minimum override, note)',
    body: stateUpdateSchema,
  });
  add('get', '/cities', read, [c.cities], { summary: 'City exceptions (optionally ?stateCode=)' });
  add('post', '/cities', manage, [c.createCity], { summary: 'Add a city exception', body: cityInputSchema });
  add('put', '/cities/:id', manage, [c.updateCity], {
    summary: 'Edit a city exception',
    body: cityInputSchema,
  });
  add('delete', '/cities/:id', manage, [c.deleteCity], { summary: 'Remove a city exception' });
  add('get', '/transport-partners', read, [c.partners], {
    summary: 'Transport partners (active and inactive)',
  });
  add('post', '/transport-partners', manage, [c.createPartner], {
    summary: 'Add a transport partner',
    body: transportPartnerInputSchema,
  });
  add('put', '/transport-partners/:id', manage, [c.updatePartner], {
    summary: 'Edit a transport partner',
    body: transportPartnerInputSchema,
  });
  add('delete', '/transport-partners/:id', manage, [c.deletePartner], {
    summary: 'Delete a transport partner',
  });
  return r;
}

export function createCustomersRouter(c: ReturnType<typeof createCustomerController>, docs: ApiDocs): Router {
  const r = Router();
  const add = adder(r, docs, '/api/v1/customers', 'Customers');
  add('get', '/', ['customers:read'], [c.list], {
    summary: 'Customers (search name / phone / email / GSTIN / tag; blocked or credit filter)',
    query: customerListQuery,
  });
  add('get', '/:id', ['customers:read'], [c.get], { summary: 'Customer profile with totals' });
  add('patch', '/:id', ['customers:update'], [c.update], {
    summary: 'Edit contact details, notes, tags, addresses',
    body: customerUpdateSchema,
  });
  add('post', '/:id/block', ['customers:block'], [c.block], {
    summary: 'Block or unblock',
    body: customerBlockSchema,
  });
  add('post', '/:id/credit', ['customers:credit'], [c.credit], {
    summary: 'Allow or withdraw credit (pack before payment)',
    body: customerCreditSchema,
  });
  return r;
}
