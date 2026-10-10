import type { Permission, Role } from '@sakthimaan/shared';

export interface AuthContext {
  userId: string;
  role: Role;
  name: string;
  email: string;
  permissions: ReadonlySet<Permission>;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` on admin routes. */
      auth?: AuthContext;
    }
  }
}
