import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import type { Permission } from '@sakthimaan/shared';
import { useAuth } from '@/hooks/use-auth';
import { useSession } from '@/lib/session';
import { Spinner } from './common';

export function FullPageSpinner() {
  return (
    <div className="grid min-h-svh place-items-center" role="status" aria-label="Loading">
      <Spinner className="text-primary size-6" />
    </div>
  );
}

/** Routes that need a signed-in user; remembers where to come back after login. */
export function RequireAuth() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

/** Login-type pages: bounce signed-in users to the app. */
export function GuestOnly() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to={from} replace />;
  return <Outlet />;
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-2 py-20 text-center">
      <ShieldOff className="text-muted-foreground size-8" aria-hidden />
      <h1 className="text-lg font-semibold">You don't have access to this page</h1>
      <p className="text-muted-foreground text-sm">Ask an administrator if you need it.</p>
    </div>
  );
}

/** Page-level permission gate (any of). */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { canAny } = useAuth();
  return canAny(...anyOf) ? <>{children}</> : <Forbidden />;
}

/** Inline gate for buttons and sections (all of). */
export function Can({
  allOf,
  children,
  fallback = null,
}: {
  allOf: Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return can(...allOf) ? <>{children}</> : <>{fallback}</>;
}
