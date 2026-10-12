import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  INDIAN_STATE_CODES,
  cityInputSchema,
  customerBlockSchema,
  customerCreditSchema,
  customerListQuery,
  customerUpdateSchema,
  idParams,
  seasonSchema,
  settingsUpdateSchema,
  stateUpdateSchema,
  transportPartnerInputSchema,
  zoneInputSchema,
} from '@sakthimaan/shared';
import { authOf } from '../middlewares/auth.js';
import { requestMeta } from '../middlewares/request-context.js';
import { validated } from '../middlewares/validate.js';
import type { CustomerService } from '../services/customer.service.js';
import type { SettingsActor, SettingsService } from '../services/settings.service.js';
import type { ShippingService } from '../services/shipping.service.js';
import { badRequest } from '../utils/app-error.js';
import { sendCreated, sendOk } from '../utils/http.js';

function actorOf(req: Request): SettingsActor {
  const a = authOf(req);
  return { user: a.userId, name: a.name, role: a.role, permissions: a.permissions };
}

function uploadedFile(req: Request): Buffer {
  const files = Array.isArray(req.files) ? req.files : [];
  const file = files[0];
  if (!file) throw badRequest('VALIDATION_ERROR', 'Choose an image to upload');
  return file.buffer;
}

export function createSettingsController(settings: SettingsService) {
  const imageKind = z.strictObject({ kind: z.enum(['logo', 'upi-qr']) });
  const kindOf = (k: 'logo' | 'upi-qr'): 'logo' | 'upiQr' => (k === 'logo' ? 'logo' : 'upiQr');
  return {
    get: async (_req: Request, res: Response) => sendOk(res, await settings.get()),
    runtime: async (_req: Request, res: Response) => sendOk(res, await settings.runtime()),
    update: validated({ body: settingsUpdateSchema }, async ({ body }, req, res) => {
      sendOk(res, await settings.update(body, actorOf(req), requestMeta(req)));
    }),
    setImage: validated({ params: imageKind }, async ({ params }, req, res) => {
      sendOk(
        res,
        await settings.setImage(kindOf(params.kind), uploadedFile(req), actorOf(req), requestMeta(req)),
      );
    }),
    removeImage: validated({ params: imageKind }, async ({ params }, req, res) => {
      sendOk(res, await settings.removeImage(kindOf(params.kind), actorOf(req), requestMeta(req)));
    }),
    seasons: async (_req: Request, res: Response) => sendOk(res, await settings.listSeasons()),
    createSeason: validated({ body: seasonSchema }, async ({ body }, req, res) => {
      sendCreated(res, await settings.saveSeason(null, body, actorOf(req), requestMeta(req)));
    }),
    updateSeason: validated({ params: idParams, body: seasonSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await settings.saveSeason(params.id, body, actorOf(req), requestMeta(req)));
    }),
    deleteSeason: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await settings.deleteSeason(params.id, actorOf(req), requestMeta(req)));
    }),
  };
}

export function createShippingController(shipping: ShippingService) {
  return {
    zones: async (_req: Request, res: Response) => sendOk(res, await shipping.listZones()),
    createZone: validated({ body: zoneInputSchema }, async ({ body }, req, res) => {
      sendCreated(res, await shipping.saveZone(null, body, actorOf(req), requestMeta(req)));
    }),
    updateZone: validated({ params: idParams, body: zoneInputSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await shipping.saveZone(params.id, body, actorOf(req), requestMeta(req)));
    }),
    deleteZone: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await shipping.deleteZone(params.id, actorOf(req), requestMeta(req)));
    }),
    states: async (_req: Request, res: Response) => sendOk(res, await shipping.listStates()),
    updateStates: validated({ body: stateUpdateSchema }, async ({ body }, req, res) => {
      sendOk(res, await shipping.updateStates(body, actorOf(req), requestMeta(req)));
    }),
    cities: validated(
      { query: z.object({ stateCode: z.enum(INDIAN_STATE_CODES).optional() }) },
      async ({ query }, _req, res) => {
        sendOk(res, await shipping.listCities(query.stateCode));
      },
    ),
    createCity: validated({ body: cityInputSchema }, async ({ body }, req, res) => {
      sendCreated(res, await shipping.saveCity(null, body, actorOf(req), requestMeta(req)));
    }),
    updateCity: validated({ params: idParams, body: cityInputSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await shipping.saveCity(params.id, body, actorOf(req), requestMeta(req)));
    }),
    deleteCity: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await shipping.deleteCity(params.id, actorOf(req), requestMeta(req)));
    }),
    partners: async (_req: Request, res: Response) => sendOk(res, await shipping.listPartners()),
    createPartner: validated({ body: transportPartnerInputSchema }, async ({ body }, req, res) => {
      sendCreated(res, await shipping.savePartner(null, body, actorOf(req), requestMeta(req)));
    }),
    updatePartner: validated(
      { params: idParams, body: transportPartnerInputSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await shipping.savePartner(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    deletePartner: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await shipping.deletePartner(params.id, actorOf(req), requestMeta(req)));
    }),
  };
}

export function createCustomerController(customers: CustomerService) {
  return {
    list: validated({ query: customerListQuery }, async ({ query }, _req, res) => {
      const { items, total } = await customers.list(query);
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total });
    }),
    get: validated({ params: idParams }, async ({ params }, _req, res) => {
      sendOk(res, await customers.get(params.id));
    }),
    update: validated(
      { params: idParams, body: customerUpdateSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await customers.update(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    block: validated({ params: idParams, body: customerBlockSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await customers.setBlocked(params.id, body, actorOf(req), requestMeta(req)));
    }),
    credit: validated(
      { params: idParams, body: customerCreditSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await customers.setCredit(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
  };
}
