import { create } from 'zustand';
import type { AuthUser, Permission, RefreshResult } from '@sakthimaan/shared';
import { API_BASE } from './config';

/**
 * Session state. The access token lives only in memory (never localStorage), so an XSS
 * bug can't read a long-lived credential; the long-lived part is the httpOnly refresh cookie.
 */
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  user: AuthUser | null;
  permissions: ReadonlySet<Permission>;
}

export const useSession = create<SessionState>(() => ({
  status: 'loading',
  accessToken: null,
  user: null,
  permissions: new Set(),
}));

// ------------------------------------------------------------------ cross-tab sync

type TabMessage = { type: 'session'; session: RefreshResult } | { type: 'logout' };

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('smc-auth') : null;

channel?.addEventListener('message', (e: MessageEvent<TabMessage>) => {
  if (e.data.type === 'session') applySession(e.data.session, false);
  if (e.data.type === 'logout') clearSession(false);
});

export function applySession(session: RefreshResult, broadcast = true): void {
  useSession.setState({
    status: 'authenticated',
    accessToken: session.accessToken,
    user: session.user,
    permissions: new Set(session.user.permissions),
  });
  if (broadcast) channel?.postMessage({ type: 'session', session } satisfies TabMessage);
}

export function clearSession(broadcast = true): void {
  useSession.setState({ status: 'anonymous', accessToken: null, user: null, permissions: new Set() });
  if (broadcast) channel?.postMessage({ type: 'logout' } satisfies TabMessage);
}

export function updateUser(user: AuthUser): void {
  useSession.setState({ user, permissions: new Set(user.permissions) });
}

// ------------------------------------------------------------------ single-flight refresh

let inflight: Promise<string | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Single-flight at two levels:
 * - within this tab: concurrent 401s share one promise;
 * - across tabs: a Web Lock serialises refreshes, and a tab that waited checks whether
 *   another tab already refreshed (the new token arrives over BroadcastChannel) before
 *   calling the API. The server's 30 s grace window covers any remaining overlap.
 *
 * @param failedToken the token that just got a 401; if the current token differs,
 *   someone else already refreshed and we reuse theirs.
 */
export function refreshAccessToken(failedToken?: string | null): Promise<string | null> {
  inflight ??= (async () => {
    const run = async (): Promise<string | null> => {
      const current = useSession.getState().accessToken;
      if (failedToken !== undefined && current && current !== failedToken) return current;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) {
          clearSession(res.status === 401);
          return null;
        }
        const body = (await res.json()) as { data: RefreshResult };
        applySession(body.data);
        return body.data.accessToken;
      } catch {
        // Network error: keep the current state; the request will surface the failure.
        if (useSession.getState().status === 'loading') useSession.setState({ status: 'anonymous' });
        return null;
      }
    };
    return typeof navigator !== 'undefined' && 'locks' in navigator
      ? navigator.locks.request('smc-auth-refresh', run)
      : run();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** On app start: restore the session from the refresh cookie, if any. */
export async function bootstrapSession(): Promise<void> {
  await refreshAccessToken();
  if (useSession.getState().status === 'loading') useSession.setState({ status: 'anonymous' });
}
