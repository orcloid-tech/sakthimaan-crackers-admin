import { describe, expect, it } from 'vitest';
import { buildUpiUri, buildWhatsAppLink, renderTemplate } from './links.js';
import { ORDER_STATUSES, canTransition, transitionRequirements } from './order-workflow.js';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, hasPermission } from './permissions.js';

describe('order workflow', () => {
  it('follows the happy path and allows cancel only before dispatch', () => {
    expect(canTransition('enquiry', 'confirmed')).toBe(true);
    expect(canTransition('enquiry', 'packed')).toBe(false);
    expect(canTransition('packed', 'cancelled')).toBe(true);
    expect(canTransition('dispatched', 'cancelled')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
  });

  it('packing before payment needs pack_unpaid, customer credit, and is audited', () => {
    expect(transitionRequirements('confirmed', 'packed')).toEqual({
      permissions: ['orders:pack', 'orders:pack_unpaid'],
      requiresCustomerCredit: true,
      auditAction: 'pack_unpaid',
    });
    expect(transitionRequirements('payment_received', 'packed')).toEqual({
      permissions: ['orders:pack'],
      requiresCustomerCredit: false,
      auditAction: 'status_change',
    });
    expect(transitionRequirements('dispatched', 'cancelled')).toBeNull();
  });

  it('every allowed transition maps to known permissions', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const req = transitionRequirements(from, to);
        if (req) req.permissions.forEach((p) => expect(PERMISSIONS).toContain(p));
      }
    }
  });
});

describe('RBAC matrix', () => {
  it('only super admin and admin may pack unpaid orders or grant credit', () => {
    for (const role of ROLES) {
      const expected = role === 'super_admin' || role === 'admin';
      expect(hasPermission(role, 'orders:pack_unpaid')).toBe(expected);
      expect(hasPermission(role, 'customers:credit')).toBe(expected);
    }
  });

  it('viewer is read-only and cannot see users, audit or settings', () => {
    const viewer = [...ROLE_PERMISSIONS.viewer];
    expect(viewer.every((p) => p.endsWith(':read'))).toBe(true);
    expect(viewer).not.toContain('users:read');
    expect(viewer).not.toContain('audit:read');
  });

  it('admin cannot change company/tax/invoice settings', () => {
    expect(hasPermission('admin', 'settings:update')).toBe(false);
    expect(hasPermission('super_admin', 'settings:update')).toBe(true);
  });
});

describe('links', () => {
  it('builds a click-to-WhatsApp link with an encoded, rendered message', () => {
    const msg = renderTemplate('Hi {{name}}, order {{orderNo}} total {{total}}{{missing}}', {
      name: 'Ravi',
      orderNo: 'ORD-26-27-00012',
      total: '₹3,500',
    });
    expect(msg).toBe('Hi Ravi, order ORD-26-27-00012 total ₹3,500');
    expect(buildWhatsAppLink('9876543210', msg)).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(msg)}`);
    expect(() => buildWhatsAppLink('12345', 'x')).toThrow(RangeError);
  });

  it('builds a UPI payment URI for the QR code', () => {
    const uri = buildUpiUri({ vpa: 'sakthimaan@okaxis', payeeName: 'Sakthimaan Crackers', amount: 3_500, note: 'ORD-1' });
    expect(uri).toBe('upi://pay?pa=sakthimaan%40okaxis&pn=Sakthimaan+Crackers&cu=INR&am=35.00&tn=ORD-1');
  });
});
