/**
 * RBAC: permissions are `resource:action` strings. Roles are fixed in code and
 * map to permission sets; the API enforces them in middleware and the admin UI
 * uses the same map to hide/disable navigation and actions.
 */

export const PERMISSIONS = [
  'dashboard:read',

  'products:read',
  'products:create',
  'products:update', // non-price fields
  'products:update_price', // MRP, discount %, bulk price updates
  'products:delete',
  'products:import',
  'products:export', // CSV/Excel export + price list PDF

  'categories:read',
  'categories:manage',

  'inventory:read',
  'inventory:adjust', // stock in/out/adjustment, batches

  'orders:read',
  'orders:create',
  'orders:update', // edit items/address/notes while in enquiry; comments
  'orders:confirm',
  'orders:pack',
  'orders:pack_unpaid', // confirmed → packed before payment; customer must have creditAllowed
  'orders:dispatch', // dispatch details + dispatched/delivered transitions
  'orders:cancel',
  'orders:delete',
  'orders:invoice', // generate GST invoice / packing slip
  'orders:export',

  'payments:read',
  'payments:record',
  'payments:void',

  'customers:read',
  'customers:update',
  'customers:block',
  'customers:credit', // toggle creditAllowed (pack-before-payment eligibility)
  'customers:delete',
  'customers:export',

  'coupons:read',
  'coupons:manage',

  'shipping:read',
  'shipping:manage', // zones, states, cities, transport partners, delivery rules

  'cms:read',
  'cms:manage', // banners, FAQ, pages, announcement, store open/closed

  'reports:read',
  'reports:export',

  'users:read',
  'users:manage',

  'audit:read',

  'settings:read',
  'settings:update',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionResource = Permission extends `${infer R}:${string}` ? R : never;

export const ROLES = ['super_admin', 'admin', 'staff_orders', 'staff_inventory', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff_orders: 'Staff (Orders)',
  staff_inventory: 'Staff (Inventory)',
  viewer: 'Viewer',
};

const allExcept = (...excluded: Permission[]): Permission[] =>
  PERMISSIONS.filter((p) => !excluded.includes(p));

const READ_ONLY: Permission[] = PERMISSIONS.filter(
  (p) => p.endsWith(':read') && !['users:read', 'audit:read', 'settings:read'].includes(p),
);

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  super_admin: new Set(PERMISSIONS),

  // Everything except company/tax/invoice-numbering settings and order deletion.
  // Includes orders:pack_unpaid and customers:credit, which no staff role has.
  // Admins can manage users but cannot create/modify super_admin or admin accounts
  // (enforced in the users service, not expressible as a flat permission).
  admin: new Set(allExcept('settings:update', 'orders:delete')),

  staff_orders: new Set<Permission>([
    'dashboard:read',
    'products:read',
    'categories:read',
    'inventory:read',
    'orders:read',
    'orders:create',
    'orders:update',
    'orders:confirm',
    'orders:pack',
    'orders:dispatch',
    'orders:cancel',
    'orders:invoice',
    'payments:read',
    'payments:record',
    'customers:read',
    'customers:update',
    'coupons:read',
    'shipping:read',
  ]),

  staff_inventory: new Set<Permission>([
    'dashboard:read',
    'products:read',
    'products:create',
    'products:update',
    'products:export',
    'categories:read',
    'categories:manage',
    'inventory:read',
    'inventory:adjust',
    'orders:read',
    'orders:pack',
    'orders:dispatch',
    'orders:invoice',
    'shipping:read',
  ]),

  viewer: new Set(READ_ONLY),
};

export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function hasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => ROLE_PERMISSIONS[role].has(p));
}

/** Roles a given role is allowed to assign when creating/updating admin users. */
export const ASSIGNABLE_ROLES: Readonly<Record<Role, readonly Role[]>> = {
  super_admin: ROLES,
  admin: ['staff_orders', 'staff_inventory', 'viewer'],
  staff_orders: [],
  staff_inventory: [],
  viewer: [],
};
