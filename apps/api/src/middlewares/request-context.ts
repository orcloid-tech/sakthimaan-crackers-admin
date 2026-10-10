import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Request } from 'express';

const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Request id: reuse a well-formed `X-Request-Id` from the proxy/client (so logs can be
 * correlated end to end), otherwise generate one. Used as pino-http's `genReqId`.
 */
export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : randomUUID();
}

/** Who/where/which-request details recorded with audit entries. */
export interface RequestMeta {
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 500),
    requestId: requestIdOf(req),
  };
}

/** The request id assigned by pino-http (always a string here, see genRequestId). */
export function requestIdOf(req: { id?: unknown }): string {
  return typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : '';
}
