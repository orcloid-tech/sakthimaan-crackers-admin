import type { Response } from 'express';
import type { ApiSuccess } from '@sakthimaan/shared';

export function sendOk<T, M = undefined>(res: Response, data: T, meta?: M, status = 200): void {
  const body: ApiSuccess<T, M> = meta === undefined ? { success: true, data } : { success: true, data, meta };
  res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendOk(res, data, undefined, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
