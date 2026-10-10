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

/** Sends a generated file as a download (or inline for PDFs). Never cached. */
export function sendFile(
  res: Response,
  file: { buffer: Buffer; filename: string; contentType: string },
  disposition: 'attachment' | 'inline' = 'attachment',
): void {
  const ascii = file.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res
    .status(200)
    .set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.buffer.length),
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control': 'no-store',
    })
    .end(file.buffer);
}
