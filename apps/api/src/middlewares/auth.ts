import type { RequestHandler } from 'express';
import { permissionsForRole, type Permission } from '@sakthimaan/shared';
import { UserModel } from '../models/index.js';
import type { TokenService } from '../services/token.service.js';
import type { AuthContext } from '../types/express.js';
import { AppError, forbidden, unauthorized } from '../utils/app-error.js';

/**
 * Verifies the Bearer access token, then loads the user to confirm they are still active
 * and the token's version is current. The DB check (an indexed _id lookup) makes
 * deactivation, password changes and "log out everywhere" take effect immediately
 * instead of after the token's 15-minute lifetime.
 */
export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match?.[1]) throw unauthorized();

    const claims = await tokens.verifyAccess(match[1]);
    const user = await UserModel.findById(claims.userId)
      .select('name email role isActive tokenVersion')
      .lean();
    if (!user || user.tokenVersion !== claims.tokenVersion) {
      throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
    }
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');

    const auth: AuthContext = {
      userId: String(user._id),
      role: user.role, // from DB, so a role change applies immediately
      name: user.name,
      email: user.email,
      permissions: permissionsForRole(user.role),
    };
    req.auth = auth;
    req.log.setBindings({ userId: auth.userId });
    next();
  };
}

/** The request's auth context; for handlers mounted behind `authenticate`. */
export function authOf(req: Parameters<RequestHandler>[0]): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Requires ALL of the given permissions. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = authOf(req);
    const missing = required.filter((p) => !auth.permissions.has(p));
    if (missing.length > 0) throw forbidden(undefined, { missing });
    next();
  };
}

/** Requires AT LEAST ONE of the given permissions. */
export function requireAnyPermission(...options: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = authOf(req);
    if (!options.some((p) => auth.permissions.has(p))) throw forbidden(undefined, { anyOf: options });
    next();
  };
}
