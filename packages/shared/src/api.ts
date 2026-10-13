/**
 * HTTP contract shared by API and admin UI. Every response uses one envelope:
 *   success: { success: true,  data, meta? }
 *   failure: { success: false, error: { code, message, details? } }
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'INVALID_ID',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'TOKEN_REUSED',
  'TWO_FACTOR_INVALID',
  'TWO_FACTOR_UNAVAILABLE',
  'INVALID_RESET_TOKEN',
  'FORBIDDEN',
  'ORIGIN_NOT_ALLOWED',
  'CAPTCHA_FAILED',
  'NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'CONFLICT',
  'DUPLICATE',
  'VERSION_CONFLICT',
  'INSUFFICIENT_STOCK',
  'CREDIT_NOT_ALLOWED',
  'INVALID_TRANSITION',
  'STORE_CLOSED',
  'NOT_SERVICEABLE',
  'BELOW_MIN_ORDER',
  'PRODUCT_UNAVAILABLE',
  'CUSTOMER_BLOCKED',
  'PAYMENT_REQUIRED',
  'DISPATCH_DETAILS_REQUIRED',
  'SETUP_INCOMPLETE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T, M = undefined> {
  success: true;
  data: T;
  meta?: M;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T, M = undefined> = ApiSuccess<T, M> | ApiFailure;

/** `details` for VALIDATION_ERROR. */
export interface ValidationIssue {
  location: 'body' | 'query' | 'params';
  path: string;
  message: string;
  code: string;
}

export interface CursorPageMeta {
  nextCursor: string | null;
}

export interface OffsetPageMeta {
  page: number;
  pageSize: number;
  total: number;
}
