import type { ApiFailure, ErrorCode, ValidationIssue } from '@sakthimaan/shared';
import { API_BASE } from './config';
import { clearSession, refreshAccessToken, useSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level problems for VALIDATION_ERROR responses. */
  get issues(): ValidationIssue[] {
    return this.code === 'VALIDATION_ERROR' && Array.isArray(this.details)
      ? (this.details as ValidationIssue[])
      : [];
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

const REFRESHABLE: readonly string[] = ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED'];

function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'include',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiFailure;
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    return new ApiError(res.status, 'INTERNAL_ERROR', `Request failed (${res.status})`);
  }
}

/**
 * Authenticated fetch: adds the access token, and on a 401 refreshes once (single-flight,
 * across tabs) and retries. If the refresh fails the session ends and the UI goes to login.
 */
async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  const token = useSession.getState().accessToken;
  let res = await send(path, opts, token);
  if (res.status === 401 && token) {
    const err = await toError(res.clone());
    if (REFRESHABLE.includes(err.code)) {
      const fresh = await refreshAccessToken(token);
      if (!fresh) {
        clearSession(false);
        throw err;
      }
      res = await send(path, opts, fresh);
    }
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export interface Envelope<T, M = unknown> {
  data: T;
  meta?: M;
}

async function json<T, M = unknown>(path: string, opts: RequestOptions): Promise<Envelope<T, M>> {
  const res = await request(path, opts);
  if (res.status === 204) return { data: undefined as T };
  return (await res.json()) as Envelope<T, M>;
}

export const api = {
  get: <T, M = unknown>(path: string, query?: Query, signal?: AbortSignal) =>
    json<T, M>(path, { query, signal }),
  post: <T, M = unknown>(path: string, body?: unknown, query?: Query) =>
    json<T, M>(path, { method: 'POST', body, query }),
  patch: <T>(path: string, body?: unknown) => json<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => json<T>(path, { method: 'PUT', body }),
  delete: <T = void>(path: string) => json<T>(path, { method: 'DELETE' }),
  upload: <T, M = unknown>(path: string, form: FormData, query?: Query) =>
    json<T, M>(path, { method: 'POST', form, query }),
  /** Binary downloads (PDF, CSV, XLSX) with the auth header. */
  async blob(path: string, query?: Query): Promise<{ blob: Blob; filename: string | null }> {
    const res = await request(path, { query });
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1] ?? match[2] ?? '') : null;
    return { blob: await res.blob(), filename };
  },
};

/** Calls an auth endpoint without the retry logic (login, logout, password reset). */
export async function authCall<T>(path: string, body?: unknown): Promise<T> {
  const res = await send(path, { method: 'POST', body }, null);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return ((await res.json()) as Envelope<T>).data;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
