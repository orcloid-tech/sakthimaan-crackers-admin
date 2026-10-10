import { useCallback } from 'react';
import type { Permission } from '@sakthimaan/shared';
import { useSession } from '@/lib/session';

/** Current user and a permission check bound to it (UI gating only; the API enforces). */
export function useAuth() {
  const user = useSession((s) => s.user);
  const permissions = useSession((s) => s.permissions);
  const can = useCallback(
    (...required: Permission[]) => required.every((p) => permissions.has(p)),
    [permissions],
  );
  const canAny = useCallback(
    (...options: Permission[]) => options.some((p) => permissions.has(p)),
    [permissions],
  );
  return { user, can, canAny };
}
