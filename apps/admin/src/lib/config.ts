/**
 * API base URL. Empty in development (Vite proxies /api to the API on :4000, so the
 * admin and API are same-origin). In production set VITE_API_URL=https://api.<domain>.
 */
const origin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const API_BASE = `${origin}/api/v1`;
