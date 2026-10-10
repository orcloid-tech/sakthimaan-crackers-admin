import type { Permission } from './permissions.js';

export const ORDER_STATUSES = [
  'enquiry',
  'confirmed',
  'payment_received',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed status transitions. Anything not listed is rejected by the API (409).
 * Cancellation is allowed up to (but not after) dispatch; stock is restocked if the
 * order was confirmed, and a credit note is issued if an invoice exists.
 *
 * `confirmed → packed` skips payment and is a guarded transition: see
 * {@link transitionRequirements}.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  enquiry: ['confirmed', 'cancelled'],
  confirmed: ['payment_received', 'packed', 'cancelled'],
  payment_received: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Permission required to move an order INTO the given status (normal path). */
const TARGET_PERMISSION: Readonly<Record<OrderStatus, Permission | null>> = {
  enquiry: null, // initial state only
  confirmed: 'orders:confirm',
  payment_received: 'payments:record',
  packed: 'orders:pack',
  dispatched: 'orders:dispatch',
  delivered: 'orders:dispatch',
  cancelled: 'orders:cancel',
};

export interface TransitionRequirements {
  /** The actor needs ALL of these permissions. */
  permissions: Permission[];
  /** Business preconditions the service must check (and report in a 409 if unmet). */
  requiresCustomerCredit: boolean;
  /** The transition must be written to the audit log with this action. */
  auditAction: 'status_change' | 'pack_unpaid';
}

/**
 * What a transition needs. Packing before payment (confirmed → packed) needs both
 * `orders:pack` and `orders:pack_unpaid`, plus `customer.creditAllowed`, and every use
 * is audited as `pack_unpaid`.
 */
export function transitionRequirements(from: OrderStatus, to: OrderStatus): TransitionRequirements | null {
  if (!canTransition(from, to)) return null;
  const target = TARGET_PERMISSION[to];
  const permissions: Permission[] = target ? [target] : [];
  if (from === 'confirmed' && to === 'packed') {
    return {
      permissions: [...permissions, 'orders:pack_unpaid'],
      requiresCustomerCredit: true,
      auditAction: 'pack_unpaid',
    };
  }
  return { permissions, requiresCustomerCredit: false, auditAction: 'status_change' };
}

/** Statuses in which stock has been deducted for the order. */
export const STOCK_COMMITTED_STATUSES: readonly OrderStatus[] = [
  'confirmed',
  'payment_received',
  'packed',
  'dispatched',
  'delivered',
];

/** Order items (and address/pricing) are editable only while still an enquiry. */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = ['enquiry'];

/** Statuses that count as "pending enquiry demand" on the inventory screen. */
export const DEMAND_STATUSES: readonly OrderStatus[] = ['enquiry'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
