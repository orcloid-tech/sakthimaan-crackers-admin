import type { ClientSession, HydratedDocument, Types } from 'mongoose';
import {
  STOCK_COMMITTED_STATUSES,
  buildUpiUri,
  buildWhatsAppLink,
  formatINR,
  gstStateCodeOf,
  renderTemplate,
  rupeesInWords,
  transitionRequirements,
  type AddressInput,
  type AdminOrderCreateInput,
  type CommentInput,
  type CustomerInput,
  type DeliveryChargeMode,
  type DispatchInput,
  type OrderActivityType,
  type OrderDto,
  type OrderListItem,
  type OrderListQuery,
  type OrderSource,
  type OrderStatus,
  type OrderUpdateInput,
  type PaymentCreateInput,
  type Permission,
  type PricingPreview,
  type PricingPreviewInput,
  type PublicOrderInput,
  type PublicOrderResult,
  type ShortageItem,
  type TransitionInput,
  type WhatsAppEvent,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../../middlewares/request-context.js';
import {
  CreditNoteModel,
  CustomerModel,
  InvoiceModel,
  OrderActivityModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  TransportPartnerModel,
  type Order,
  type Settings,
} from '../../models/index.js';
import { processImage, type StorageProvider } from '../../providers/storage/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/app-error.js';
import { containsRegex, escapeRegex, oid } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import type { AuditActor, AuditService } from '../audit.service.js';
import type { InventoryService } from '../catalog/inventory.service.js';
import type { SettingsCache } from '../settings-cache.js';
import { assertCanInvoice } from '../setup.js';
import { nextCreditNoteNo, nextInvoiceNo, nextOrderNo } from './numbering.js';
import type { BuiltOrder, OrderBuilder } from './order-builder.js';

type OrderDoc = HydratedDocument<Order>;

/** Who is acting: audit identity plus the permissions the workflow checks. */
export interface Actor extends AuditActor {
  permissions: ReadonlySet<Permission>;
}

const INVOICEABLE: readonly OrderStatus[] = [
  'confirmed',
  'payment_received',
  'packed',
  'dispatched',
  'delivered',
];
const DISPATCHABLE: readonly OrderStatus[] = [
  'confirmed',
  'payment_received',
  'packed',
  'dispatched',
  'delivered',
];

export interface OrderServiceDeps {
  audit: AuditService;
  inventory: InventoryService;
  settings: SettingsCache;
  builder: OrderBuilder;
  storage: StorageProvider;
}

export class OrderService {
  constructor(private readonly deps: OrderServiceDeps) {}

  // ================================================================== create

  async preview(input: PricingPreviewInput): Promise<PricingPreview> {
    const built = await this.deps.builder.build(
      input.items,
      { stateCode: input.stateCode, city: input.city },
      {
        deliveryCharge: input.deliveryCharge,
      },
    );
    return {
      items: built.lines.map((l) => ({
        productId: String(l.product),
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        mrp: l.mrp,
        discountPct: l.discountPct,
        netPrice: l.netPrice,
        qty: l.qty,
        lineTotal: l.lineTotal,
      })),
      pricing: pricingDto(built.pricing),
      serviceability: built.serviceability,
      meetsMinimum: built.meetsMinimum,
      unavailable: built.unavailable,
      shortages: built.shortages,
    };
  }

  /** Website enquiry/order. Enquiry mode: status `enquiry`. Checkout mode: confirmed at once (stock committed). */
  async createFromWebsite(input: PublicOrderInput, meta: RequestMeta): Promise<PublicOrderResult> {
    const settings = await this.deps.settings.get();
    if (settings && settings.storefront?.isOpen === false) {
      throw new AppError(
        409,
        'STORE_CLOSED',
        settings.storefront.closedMessage || 'The store is not taking orders right now.',
      );
    }
    const mode = settings?.storefront?.orderMode ?? 'enquiry';
    const order = await this.create(
      { customer: input.customer, address: input.address, items: input.items, notes: input.notes },
      { source: 'storefront', mode, enforceMinimum: true, actor: null, meta },
    );
    const upiId = settings?.payment?.upiId ?? null;
    return {
      orderNo: order.orderNo,
      status: order.status,
      grandTotal: order.pricing.grandTotal,
      message:
        (mode === 'enquiry'
          ? settings?.storefront?.messages?.enquiryReceived
          : settings?.storefront?.messages?.checkoutConfirmed) || null,
      payment:
        mode === 'checkout' && upiId
          ? {
              upiId,
              upiUri: buildUpiUri({
                vpa: upiId,
                payeeName: settings?.payment?.upiPayeeName || settings?.company?.name || upiId,
                amount: order.pricing.grandTotal,
                note: order.orderNo,
              }),
            }
          : null,
    };
  }

  /** Order taken by staff (phone/WhatsApp): always an enquiry first; the minimum is a warning, not a block. */
  async createByStaff(input: AdminOrderCreateInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
    const order = await this.create(input, {
      source: input.source,
      mode: 'enquiry',
      enforceMinimum: false,
      actor,
      meta,
    });
    return this.get(String(order._id));
  }

  private async create(
    input: {
      customer: CustomerInput;
      address: AddressInput;
      items: { productId: string; qty: number }[];
      notes?: string;
      deliveryCharge?: number;
      deliveryChargeMode?: DeliveryChargeMode;
    },
    opts: {
      source: OrderSource;
      mode: 'enquiry' | 'checkout';
      enforceMinimum: boolean;
      actor: Actor | null;
      meta: RequestMeta;
    },
  ): Promise<OrderDoc> {
    const built = await this.deps.builder.build(
      input.items,
      { stateCode: input.address.stateCode, city: input.address.city },
      {
        deliveryCharge: input.deliveryCharge,
        deliveryChargeMode: input.deliveryChargeMode,
      },
    );
    assertOrderable(built, opts.enforceMinimum);
    const blocked = await CustomerModel.findOne({ phone: input.customer.phone, isBlocked: true }).lean();
    if (blocked) {
      throw new AppError(
        403,
        'CUSTOMER_BLOCKED',
        opts.actor
          ? 'This customer is blocked. Unblock them first.'
          : 'We are unable to accept orders from this number. Please call us.',
      );
    }
    const settings = await this.deps.settings.get();
    const actorSnapshot = opts.actor
      ? auditActor(opts.actor)
      : { name: opts.source === 'storefront' ? 'Website' : 'System' };

    const id = await withTransaction(async (session) => {
      const customer = await this.upsertCustomer(input.customer, input.address, session);
      const orderNo = await nextOrderNo(settings, session);
      const [order] = await OrderModel.create(
        [
          {
            orderNo,
            status: 'enquiry',
            mode: opts.mode,
            source: opts.source,
            customer: customer._id,
            customerSnapshot: {
              name: input.customer.name,
              phone: input.customer.phone,
              altPhone: input.customer.altPhone,
              email: input.customer.email,
              gstin: input.customer.gstin,
            },
            shippingAddress: input.address,
            zoneName: built.serviceability.zoneName ?? undefined,
            items: built.lines,
            pricing: built.pricing,
            customerNotes: input.notes,
            createdBy: opts.actor?.user ? oid(opts.actor.user) : undefined,
          },
        ],
        { session },
      );
      if (!order) throw new Error('Order not created');
      await this.activity(
        order._id,
        { type: 'status_change', toStatus: 'enquiry', message: `Received via ${opts.source}` },
        actorSnapshot,
        session,
      );
      await CustomerModel.updateOne(
        { _id: customer._id },
        { $max: { 'stats.lastOrderAt': new Date() } },
        { session },
      );
      if (opts.mode === 'checkout') await this.confirmInTxn(order, actorSnapshot, session);
      await this.deps.audit.record(
        {
          actor: actorSnapshot,
          action: 'create',
          entity: 'order',
          entityId: String(order._id),
          entityLabel: orderNo,
          meta: { source: opts.source, grandTotal: order.pricing.grandTotal },
        },
        opts.meta,
        session,
      );
      return order._id;
    });
    const created = await OrderModel.findById(id);
    if (!created) throw notFound('Order');
    return created;
  }

  // ================================================================== read

  async list(q: OrderListQuery): Promise<{ items: OrderListItem[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
    if (q.stateCode) filter['shippingAddress.stateCode'] = q.stateCode;
    if (q.customerId) filter.customer = oid(q.customerId);
    if (q.from || q.to)
      filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: endOfDay(q.to) } : {}) };
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const rx = containsRegex(q.q);
      filter.$or = [
        { orderNo: rx },
        { 'customerSnapshot.name': rx },
        { 'dispatch.lrNumber': rx },
        ...(digits.length >= 3 ? [{ 'customerSnapshot.phone': new RegExp(escapeRegex(digits)) }] : []),
      ];
    }
    const [docs, total] = await Promise.all([
      OrderModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .select(
          'orderNo status paymentStatus mode source customer customerSnapshot shippingAddress items.qty pricing.grandTotal amountPaid dispatch.lrNumber invoice.number createdAt',
        )
        .lean(),
      OrderModel.countDocuments(filter),
    ]);
    return {
      total,
      items: docs.map((o) => ({
        id: String(o._id),
        orderNo: o.orderNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        mode: o.mode,
        source: o.source,
        customer: { id: String(o.customer), name: o.customerSnapshot.name, phone: o.customerSnapshot.phone },
        city: o.shippingAddress.city,
        stateCode: o.shippingAddress.stateCode,
        itemCount: o.items.length,
        totalQty: o.items.reduce((s, i) => s + i.qty, 0),
        grandTotal: o.pricing.grandTotal,
        amountPaid: o.amountPaid,
        lrNumber: o.dispatch?.lrNumber ?? null,
        invoiceNumber: o.invoice?.number ?? null,
        createdAt: (o.createdAt ?? new Date()).toISOString(),
      })),
    };
  }

  async get(id: string): Promise<OrderDto> {
    const order = await OrderModel.findById(id).lean();
    if (!order) throw notFound('Order');
    const [customer, payments, activity] = await Promise.all([
      CustomerModel.findById(
        order.customer,
        { creditAllowed: 1, isBlocked: 1 },
        { withDeleted: true },
      ).lean(),
      PaymentModel.find({ order: order._id }).sort({ paidAt: -1, _id: -1 }).lean(),
      OrderActivityModel.find({ order: order._id }).sort({ createdAt: -1, _id: -1 }).limit(200).lean(),
    ]);
    const o = order;
    return {
      id: String(o._id),
      version: o.__v ?? 0,
      orderNo: o.orderNo,
      status: o.status,
      mode: o.mode,
      source: o.source,
      paymentStatus: o.paymentStatus,
      amountPaid: o.amountPaid,
      balanceDue: Math.max(0, o.pricing.grandTotal - o.amountPaid),
      packedOnCredit: o.packedOnCredit,
      customer: {
        id: String(o.customer),
        name: o.customerSnapshot.name,
        phone: o.customerSnapshot.phone,
        altPhone: o.customerSnapshot.altPhone ?? null,
        email: o.customerSnapshot.email ?? null,
        gstin: o.customerSnapshot.gstin ?? null,
        creditAllowed: customer?.creditAllowed ?? false,
        isBlocked: customer?.isBlocked ?? false,
      },
      shippingAddress: {
        line1: o.shippingAddress.line1,
        line2: o.shippingAddress.line2 ?? null,
        landmark: o.shippingAddress.landmark ?? null,
        city: o.shippingAddress.city,
        district: o.shippingAddress.district ?? null,
        stateCode: o.shippingAddress.stateCode,
        pincode: o.shippingAddress.pincode,
      },
      zoneName: o.zoneName ?? null,
      items: o.items.map((i) => ({
        id: String(i._id),
        productId: String(i.product),
        sku: i.sku,
        name: i.name,
        type: i.type,
        categoryName: i.categoryName,
        unit: i.unit,
        contentsCount: i.contentsCount ?? 1,
        isGreen: i.isGreen ?? false,
        hsn: i.hsn,
        taxRate: i.taxRate,
        mrp: i.mrp,
        discountPct: i.discountPct,
        netPrice: i.netPrice,
        qty: i.qty,
        lineTotal: i.lineTotal,
        taxableValue: i.taxableValue,
        cgst: i.cgst,
        sgst: i.sgst,
        igst: i.igst,
      })),
      pricing: pricingDto(o.pricing),
      customerNotes: o.customerNotes ?? null,
      dispatch: {
        transportPartnerId: o.dispatch?.transportPartner ? String(o.dispatch.transportPartner) : null,
        transportName: o.dispatch?.transportName ?? null,
        lrNumber: o.dispatch?.lrNumber ?? null,
        dispatchDate: o.dispatch?.dispatchDate?.toISOString() ?? null,
        boxes: o.dispatch?.boxes ?? null,
        weightKg: o.dispatch?.weightKg ?? null,
        destination: o.dispatch?.destination ?? null,
        trackingUrl: o.dispatch?.trackingUrl ?? null,
        deliveredAt: o.dispatch?.deliveredAt?.toISOString() ?? null,
      },
      invoice:
        o.invoice?.id && o.invoice.number
          ? {
              id: String(o.invoice.id),
              number: o.invoice.number,
              issuedAt: (o.invoice.issuedAt ?? new Date()).toISOString(),
            }
          : null,
      creditNotes: o.creditNotes.map((c) => ({
        id: String(c.id),
        number: c.number,
        issuedAt: c.issuedAt.toISOString(),
      })),
      cancelReason: o.cancelReason ?? null,
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      createdAt: (o.createdAt ?? new Date()).toISOString(),
      updatedAt: (o.updatedAt ?? new Date()).toISOString(),
      payments: payments.map((p) => ({
        id: String(p._id),
        kind: p.kind,
        amount: p.amount,
        method: p.method,
        reference: p.reference ?? null,
        paidAt: p.paidAt.toISOString(),
        status: p.status,
        source: p.source,
        notes: p.notes ?? null,
        screenshotUrl: p.screenshot?.url ?? null,
        recordedBy: p.recordedBy?.name ?? null,
        voidReason: p.voidReason ?? null,
        createdAt: (p.createdAt ?? new Date()).toISOString(),
      })),
      activity: activity.map((a) => ({
        id: String(a._id),
        type: a.type,
        fromStatus: a.fromStatus ?? null,
        toStatus: a.toStatus ?? null,
        message: a.message ?? null,
        isInternal: a.isInternal,
        actor: a.actor?.name ?? null,
        createdAt: (a.createdAt ?? new Date()).toISOString(),
      })),
    };
  }

  async trackForCustomer(orderNo: string, phone: string) {
    const o = await OrderModel.findOne({ orderNo, 'customerSnapshot.phone': phone }).lean();
    if (!o) throw notFound('Order');
    return {
      orderNo: o.orderNo,
      status: o.status,
      paymentStatus: o.paymentStatus,
      grandTotal: o.pricing.grandTotal,
      amountPaid: o.amountPaid,
      createdAt: (o.createdAt ?? new Date()).toISOString(),
      dispatch: o.dispatch?.lrNumber
        ? {
            transportName: o.dispatch.transportName ?? null,
            lrNumber: o.dispatch.lrNumber,
            dispatchDate: o.dispatch.dispatchDate?.toISOString() ?? null,
            trackingUrl: o.dispatch.trackingUrl ?? null,
          }
        : null,
    };
  }

  // ================================================================== edit enquiry

  /** Lines, address, contact and notes can change only while the order is an enquiry (prices re-read from the catalogue). */
  async updateEnquiry(
    id: string,
    input: OrderUpdateInput,
    actor: Actor,
    meta: RequestMeta,
  ): Promise<OrderDto> {
    const order = await this.load(id, input.version);
    if (order.status !== 'enquiry') {
      throw conflict(
        'INVALID_TRANSITION',
        'Only enquiries can be edited. Cancel and re-create a confirmed order if the list changes.',
      );
    }
    const changes: string[] = [];
    const address = input.address ?? order.shippingAddress;
    const itemsChanged = input.items !== undefined;
    if (
      itemsChanged ||
      input.address ||
      input.deliveryCharge !== undefined ||
      input.deliveryChargeMode !== undefined
    ) {
      const items = input.items ?? order.items.map((i) => ({ productId: String(i.product), qty: i.qty }));
      const built = await this.deps.builder.build(
        items,
        { stateCode: address.stateCode, city: address.city },
        {
          deliveryCharge: input.deliveryCharge ?? (order.pricing.deliveryCharge || undefined),
          deliveryChargeMode: input.deliveryChargeMode ?? order.pricing.deliveryChargeMode ?? undefined,
        },
      );
      assertOrderable(built, false);
      if (itemsChanged) changes.push(...describeLineChanges(order.items, built.lines));
      if (input.address) changes.push(`Address: ${input.address.city}, ${input.address.stateCode}`);
      order.set('items', built.lines);
      order.set('pricing', built.pricing);
      order.set('shippingAddress', address);
      order.zoneName = built.serviceability.zoneName ?? undefined;
    }
    if (input.customer) {
      for (const [k, v] of Object.entries(input.customer)) {
        if (v !== undefined) order.set(`customerSnapshot.${k}`, v);
      }
      changes.push('Contact details updated');
    }
    if (input.notes !== undefined) {
      order.customerNotes = input.notes;
      changes.push('Notes updated');
    }
    order.updatedBy = actor.user ? oid(actor.user) : order.updatedBy;
    await withTransaction(async (session) => {
      await order.save({ session });
      await this.activity(
        order._id,
        { type: 'items_edited', message: changes.join('; ') || 'Updated' },
        auditActor(actor),
        session,
      );
      await this.deps.audit.record(
        {
          actor: auditActor(actor),
          action: 'update',
          entity: 'order',
          entityId: id,
          entityLabel: order.orderNo,
          summary: changes.join('; '),
        },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  // ================================================================== workflow

  async transition(id: string, input: TransitionInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
    const order = await this.load(id, input.version);
    const from = order.status;
    const to = input.to;
    const req = transitionRequirements(from, to);
    if (!req)
      throw conflict('INVALID_TRANSITION', `An order that is ${label(from)} can't be moved to ${label(to)}.`);
    const missing = req.permissions.filter((p) => !actor.permissions.has(p));
    if (missing.length > 0) throw forbidden(undefined, { missing });

    if (req.requiresCustomerCredit) {
      const customer = await CustomerModel.findById(order.customer).lean();
      if (!customer?.creditAllowed) {
        throw conflict(
          'CREDIT_NOT_ALLOWED',
          'This customer is not allowed credit. Record the payment first, or enable credit for them.',
        );
      }
    }
    if (to === 'payment_received' && order.amountPaid < order.pricing.grandTotal) {
      throw conflict(
        'PAYMENT_REQUIRED',
        `Record the payment first: ${formatINR(order.pricing.grandTotal - order.amountPaid)} is still due.`,
      );
    }
    if (to === 'dispatched' && (!order.dispatch?.lrNumber || !order.dispatch.transportName)) {
      throw conflict(
        'DISPATCH_DETAILS_REQUIRED',
        'Add the transport name and LR number before marking it dispatched.',
      );
    }
    if (to === 'cancelled' && !input.reason)
      throw badRequest('VALIDATION_ERROR', 'Give a reason for cancelling', [
        { location: 'body', path: 'reason', message: 'Required', code: 'custom' },
      ]);
    if (to === 'confirmed') await this.assertStockFor(order);

    const who = auditActor(actor);
    await withTransaction(async (session) => {
      if (to === 'confirmed') {
        await this.confirmInTxn(order, who, session);
      } else if (to === 'cancelled') {
        await this.cancelInTxn(order, input.reason ?? '', who, session);
      } else {
        order.status = to;
        if (to === 'packed' && from === 'confirmed') order.packedOnCredit = true;
        if (to === 'delivered') order.set('dispatch.deliveredAt', new Date());
        order.updatedBy = actor.user ? oid(actor.user) : order.updatedBy;
        await order.save({ session });
        await this.activity(
          order._id,
          {
            type: req.auditAction === 'pack_unpaid' ? 'packed_on_credit' : 'status_change',
            fromStatus: from,
            toStatus: to,
            message:
              req.auditAction === 'pack_unpaid'
                ? `Packed before payment on customer credit (${formatINR(order.pricing.grandTotal - order.amountPaid)} due)`
                : input.reason,
          },
          who,
          session,
        );
      }
      await this.deps.audit.record(
        {
          actor: who,
          action: req.auditAction,
          entity: 'order',
          entityId: id,
          entityLabel: order.orderNo,
          changes: [{ path: 'status', from, to }],
          ...(input.reason ? { summary: input.reason } : {}),
        },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  /** Lists every line that can't be covered, before touching stock (the transaction re-checks atomically). */
  private async assertStockFor(order: OrderDoc): Promise<void> {
    const products = await ProductModel.find(
      { _id: { $in: order.items.map((i) => i.product) } },
      { stock: 1, isActive: 1, name: 1, sku: 1 },
      { withDeleted: true },
    ).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const shortages: ShortageItem[] = [];
    for (const item of order.items) {
      const p = byId.get(String(item.product));
      const available = p?.stock ?? 0;
      if (item.qty > available) {
        shortages.push({
          productId: String(item.product),
          sku: item.sku,
          name: item.name,
          requested: item.qty,
          available,
          shortBy: item.qty - available,
        });
      }
    }
    if (shortages.length > 0) {
      throw conflict(
        'INSUFFICIENT_STOCK',
        `Not enough stock for ${shortages.length} item(s). Edit or substitute the lines, or add stock.`,
        { items: shortages },
      );
    }
  }

  private async confirmInTxn(order: OrderDoc, actor: AuditActor, session: ClientSession): Promise<void> {
    if (order.stockCommitted) return;
    for (const item of order.items) {
      const outcome = await this.deps.inventory.apply(
        {
          productId: item.product,
          type: 'order_deduct',
          qty: item.qty,
          reason: 'Order confirmed',
          refType: 'order',
          refId: order._id,
          refLabel: order.orderNo,
        },
        actor,
        session,
      );
      item.set('allocations', outcome.allocations);
    }
    const from = order.status;
    order.status = 'confirmed';
    order.stockCommitted = true;
    order.confirmedAt = new Date();
    order.confirmedBy = actor.user ? oid(actor.user) : undefined;
    await order.save({ session });
    await CustomerModel.updateOne({ _id: order.customer }, { $inc: { 'stats.orderCount': 1 } }, { session });
    await this.activity(
      order._id,
      {
        type: 'status_change',
        fromStatus: from,
        toStatus: 'confirmed',
        message: 'Stock reserved for this order',
      },
      actor,
      session,
    );
  }

  private async cancelInTxn(
    order: OrderDoc,
    reason: string,
    actor: AuditActor,
    session: ClientSession,
  ): Promise<void> {
    const from = order.status;
    const wasCommitted = order.stockCommitted;
    if (wasCommitted) {
      for (const item of order.items) {
        await this.deps.inventory.apply(
          {
            productId: item.product,
            type: 'order_restock',
            qty: item.qty,
            reason: 'Order cancelled',
            refType: 'order',
            refId: order._id,
            refLabel: order.orderNo,
            restoreAllocations: (item.allocations ?? [])
              .filter((a) => a.batchId && a.qty)
              .map((a) => ({ batchId: a.batchId as Types.ObjectId, qty: a.qty ?? 0 })),
          },
          actor,
          session,
        );
      }
      await CustomerModel.updateOne(
        { _id: order.customer },
        { $inc: { 'stats.orderCount': -1 } },
        { session },
      );
    }
    if (order.invoice?.id) await this.issueCreditNote(order, reason, actor, session);
    order.status = 'cancelled';
    order.stockCommitted = false;
    order.cancelledAt = new Date();
    order.cancelledBy = actor.user ? oid(actor.user) : undefined;
    order.cancelReason = reason;
    await order.save({ session });
    await this.activity(
      order._id,
      {
        type: 'status_change',
        fromStatus: from,
        toStatus: 'cancelled',
        message: `${reason}${wasCommitted ? ' · Stock returned' : ''}${order.amountPaid > 0 ? ` · ${formatINR(order.amountPaid)} was paid: record the refund` : ''}`,
      },
      actor,
      session,
    );
  }

  async addComment(id: string, input: CommentInput, actor: Actor): Promise<OrderDto> {
    const order = await OrderModel.findById(id).select('_id').lean();
    if (!order) throw notFound('Order');
    await this.activity(
      order._id,
      {
        type: input.isInternal ? 'internal_comment' : 'note',
        message: input.message,
        isInternal: input.isInternal,
      },
      auditActor(actor),
    );
    return this.get(id);
  }

  // ================================================================== payments

  async recordPayment(
    orderId: string,
    input: PaymentCreateInput,
    screenshot: Buffer | undefined,
    actor: Actor,
    meta: RequestMeta,
  ): Promise<{ order: OrderDto; warnings: string[] }> {
    const order = await OrderModel.findById(orderId);
    if (!order) throw notFound('Order');
    if (order.status === 'cancelled' && input.kind === 'payment') {
      throw conflict('INVALID_TRANSITION', 'This order is cancelled. Record a refund instead.');
    }
    const warnings: string[] = [];
    if (input.reference) {
      const dup = await PaymentModel.findOne({
        reference: input.reference.toUpperCase(),
        status: 'recorded',
      }).lean();
      if (dup)
        warnings.push(
          `Reference ${input.reference} was already used on order ${dup.orderNo}. Check it isn't the same payment twice.`,
        );
    }
    const stored = screenshot
      ? await this.deps.storage.put({ ...(await processImage(screenshot)), folder: 'payments' })
      : undefined;
    const who = auditActor(actor);
    try {
      await withTransaction(async (session) => {
        const [payment] = await PaymentModel.create(
          [
            {
              order: order._id,
              orderNo: order.orderNo,
              customer: order.customer,
              kind: input.kind,
              amount: input.amount,
              method: input.method,
              reference: input.reference,
              paidAt: input.paidAt,
              notes: input.notes,
              screenshot: stored,
              source: 'staff',
              status: 'recorded',
              recordedBy: who,
              recordedAt: new Date(),
            },
          ],
          { session },
        );
        if (!payment) throw new Error('Payment not created');
        const sign = input.kind === 'refund' ? -1 : 1;
        await CustomerModel.updateOne(
          { _id: order.customer },
          { $inc: { 'stats.totalSpent': sign * input.amount } },
          { session },
        );
        await this.activity(
          order._id,
          {
            type: 'payment_recorded',
            message: `${input.kind === 'refund' ? 'Refund' : 'Payment'} ${formatINR(input.amount)} via ${input.method.replace('_', ' ')}${input.reference ? ` (ref ${input.reference.toUpperCase()})` : ''}`,
          },
          who,
          session,
        );
        await this.recalculatePayments(order, who, session);
        await this.deps.audit.record(
          {
            actor: who,
            action: 'create',
            entity: 'payment',
            entityId: String(payment._id),
            entityLabel: order.orderNo,
            meta: { amount: input.amount, method: input.method, kind: input.kind },
          },
          meta,
          session,
        );
      });
    } catch (err) {
      if (stored) await this.deps.storage.remove(stored.key).catch(() => undefined);
      throw err;
    }
    const after = await this.get(orderId);
    if (after.amountPaid > after.pricing.grandTotal)
      warnings.push(
        `Received ${formatINR(after.amountPaid - after.pricing.grandTotal)} more than the order total.`,
      );
    return { order: after, warnings };
  }

  async voidPayment(paymentId: string, reason: string, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'recorded') throw conflict('CONFLICT', 'Only recorded payments can be voided.');
    const order = await OrderModel.findById(payment.order);
    if (!order) throw notFound('Order');
    const who = auditActor(actor);
    await withTransaction(async (session) => {
      payment.status = 'voided';
      payment.voidedAt = new Date();
      payment.voidReason = reason;
      payment.set('voidedBy', who);
      await payment.save({ session });
      const sign = payment.kind === 'refund' ? -1 : 1;
      await CustomerModel.updateOne(
        { _id: order.customer },
        { $inc: { 'stats.totalSpent': -sign * payment.amount } },
        { session },
      );
      await this.activity(
        order._id,
        {
          type: 'payment_voided',
          message: `${formatINR(payment.amount)} ${payment.method} voided: ${reason}`,
        },
        who,
        session,
      );
      await this.recalculatePayments(order, who, session);
      await this.deps.audit.record(
        {
          actor: who,
          action: 'update',
          entity: 'payment',
          entityId: paymentId,
          entityLabel: order.orderNo,
          summary: `Voided: ${reason}`,
          changes: [{ path: 'status', from: 'recorded', to: 'voided' }],
        },
        meta,
        session,
      );
    });
    return this.get(String(order._id));
  }

  /** amountPaid/paymentStatus from recorded payments; a fully paid confirmed order moves to payment_received. */
  private async recalculatePayments(
    order: OrderDoc,
    actor: AuditActor,
    session: ClientSession,
  ): Promise<void> {
    const rows = await PaymentModel.find({ order: order._id, status: 'recorded' }).session(session).lean();
    const paid = rows.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);
    const hadRefund = rows.some((p) => p.kind === 'refund');
    order.amountPaid = paid;
    order.paymentStatus =
      paid <= 0 ? (hadRefund ? 'refunded' : 'unpaid') : paid >= order.pricing.grandTotal ? 'paid' : 'partial';
    if (order.status === 'confirmed' && order.paymentStatus === 'paid') {
      order.status = 'payment_received';
      await this.activity(
        order._id,
        {
          type: 'status_change',
          fromStatus: 'confirmed',
          toStatus: 'payment_received',
          message: 'Fully paid',
        },
        actor,
        session,
      );
    }
    await order.save({ session });
  }

  // ================================================================== dispatch

  async setDispatch(id: string, input: DispatchInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
    const order = await OrderModel.findById(id);
    if (!order) throw notFound('Order');
    if (!DISPATCHABLE.includes(order.status))
      throw conflict('INVALID_TRANSITION', 'Confirm the order before adding dispatch details.');
    const partner = input.transportPartnerId
      ? await TransportPartnerModel.findById(input.transportPartnerId).lean()
      : null;
    const lr = input.lrNumber.toUpperCase();
    order.set('dispatch', {
      ...(order.dispatch ?? {}),
      transportPartner: partner?._id ?? null,
      transportName: input.transportName,
      lrNumber: lr,
      dispatchDate: input.dispatchDate,
      boxes: input.boxes,
      weightKg: input.weightKg,
      destination: input.destination,
      trackingUrl: partner?.trackingUrlTemplate
        ? partner.trackingUrlTemplate.replace('{lr}', encodeURIComponent(lr))
        : undefined,
      deliveredAt: order.dispatch?.deliveredAt,
    });
    const who = auditActor(actor);
    await withTransaction(async (session) => {
      await order.save({ session });
      await this.activity(
        order._id,
        { type: 'dispatch_updated', message: `${input.transportName} · LR ${lr} · ${input.boxes} box(es)` },
        who,
        session,
      );
      await this.deps.audit.record(
        {
          actor: who,
          action: 'update',
          entity: 'order',
          entityId: id,
          entityLabel: order.orderNo,
          summary: `Dispatch: ${input.transportName} LR ${lr}`,
        },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  // ================================================================== documents

  /** Issues the GST invoice once (numbered in the same transaction); later calls return the same invoice. */
  async issueInvoice(id: string, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
    const order = await OrderModel.findById(id);
    if (!order) throw notFound('Order');
    if (order.invoice?.id) return this.get(id);
    if (!INVOICEABLE.includes(order.status))
      throw conflict('INVALID_TRANSITION', 'Confirm the order before issuing the invoice.');
    const settings = await this.deps.settings.get();
    assertCanInvoice(settings);
    const who = auditActor(actor);
    await withTransaction(async (session) => {
      const { number, seq, financialYear } = await nextInvoiceNo(settings, session);
      const now = new Date();
      const [invoice] = await InvoiceModel.create(
        [
          {
            ...documentSnapshot(order, settings),
            number,
            seq,
            financialYear,
            issuedAt: now,
            issuedBy: who,
            terms: settings?.invoice?.terms,
            footerNote: settings?.invoice?.footerNote,
          },
        ],
        { session },
      );
      if (!invoice) throw new Error('Invoice not created');
      order.set('invoice', { id: invoice._id, number, issuedAt: now });
      await order.save({ session });
      await this.activity(
        order._id,
        { type: 'invoice_generated', message: `Invoice ${number}` },
        who,
        session,
      );
      await this.deps.audit.record(
        {
          actor: who,
          action: 'issue',
          entity: 'invoice',
          entityId: String(invoice._id),
          entityLabel: number,
          meta: { orderNo: order.orderNo, grandTotal: order.pricing.grandTotal },
        },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  /** Cancelling an invoiced order: full credit note (own series), invoice marked cancelled, never edited or deleted. */
  private async issueCreditNote(
    order: OrderDoc,
    reason: string,
    actor: AuditActor,
    session: ClientSession,
  ): Promise<void> {
    const invoice = await InvoiceModel.findById(order.invoice?.id).session(session);
    if (!invoice || invoice.status === 'cancelled') return;
    const settings = await this.deps.settings.get();
    const { number, seq, financialYear } = await nextCreditNoteNo(settings, session);
    const now = new Date();
    const base = invoice.toObject();
    const [cn] = await CreditNoteModel.create(
      [
        {
          number,
          seq,
          financialYear,
          issuedAt: now,
          order: base.order,
          orderNo: base.orderNo,
          seller: base.seller,
          buyer: base.buyer,
          placeOfSupply: base.placeOfSupply,
          isInterState: base.isInterState,
          items: base.items,
          hsnSummary: base.hsnSummary,
          totals: base.totals,
          issuedBy: actor,
          invoice: invoice._id,
          invoiceNumber: invoice.number,
          invoiceDate: invoice.issuedAt,
          reasonCode: 'order_cancelled',
          reason,
        },
      ],
      { session },
    );
    if (!cn) throw new Error('Credit note not created');
    invoice.status = 'cancelled';
    invoice.set('cancelledBy', { creditNote: cn._id, number, at: now });
    await invoice.save({ session });
    order.creditNotes.push({ id: cn._id, number, issuedAt: now });
    await this.activity(
      order._id,
      { type: 'credit_note_issued', message: `Credit note ${number} against invoice ${invoice.number}` },
      actor,
      session,
    );
    await this.deps.audit.record(
      {
        actor,
        action: 'issue',
        entity: 'credit_note',
        entityId: String(cn._id),
        entityLabel: number,
        meta: { invoice: invoice.number, orderNo: order.orderNo },
      },
      undefined,
      session,
    );
  }

  // ================================================================== WhatsApp

  async whatsappLink(
    id: string,
    event: WhatsAppEvent,
  ): Promise<{ url: string; message: string; phone: string; warnings: string[] }> {
    const order = await OrderModel.findById(id).lean();
    if (!order) throw notFound('Order');
    const settings = await this.deps.settings.get();
    const due = Math.max(0, order.pricing.grandTotal - order.amountPaid);
    const template = settings?.whatsappTemplates?.find((t) => t.event === event)?.message;
    if (!template) {
      throw new AppError(
        409,
        'SETUP_INCOMPLETE',
        'There is no WhatsApp message for this yet. Add it in Settings → WhatsApp.',
      );
    }
    // Tell staff when the message mentions something Settings doesn't have yet.
    const warnings: string[] = [];
    if (template.includes('{{upiId}}') && !settings?.payment?.upiId)
      warnings.push('UPI ID is not set in Settings, so it is left out of the message.');
    if (template.includes('{{store}}') && !settings?.company?.name)
      warnings.push('Store name is not set in Settings, so it is left out of the message.');
    const message = renderTemplate(template, {
      name: order.customerSnapshot.name.split(' ')[0] ?? order.customerSnapshot.name,
      orderNo: order.orderNo,
      total: formatINR(order.pricing.grandTotal),
      due: formatINR(due),
      upiId: settings?.payment?.upiId ?? '',
      transport: order.dispatch?.transportName ?? '',
      lr: order.dispatch?.lrNumber ?? '',
      boxes: order.dispatch?.boxes ?? '',
      store: settings?.company?.name ?? '',
      reason: order.cancelReason ? `Reason: ${order.cancelReason}.` : '',
    })
      // Keep line breaks staff put in custom messages; tidy spaces left by empty fields.
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      url: buildWhatsAppLink(order.customerSnapshot.phone, message),
      message,
      phone: order.customerSnapshot.phone,
      warnings,
    };
  }

  // ================================================================== helpers

  private async load(id: string, version: number): Promise<OrderDoc> {
    const order = await OrderModel.findById(id);
    if (!order) throw notFound('Order');
    if ((order.__v ?? 0) !== version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        `${order.orderNo} was changed by someone else. Reload to see the latest.`,
        { currentVersion: order.__v ?? 0 },
      );
    }
    return order;
  }

  private async upsertCustomer(input: CustomerInput, address: AddressInput, session: ClientSession) {
    const existing = await CustomerModel.findOne({ phone: input.phone }).session(session);
    if (!existing) {
      const [created] = await CustomerModel.create(
        [{ ...input, addresses: [{ label: 'Home', isDefault: true, address }] }],
        { session },
      );
      if (!created) throw new Error('Customer not created');
      return created;
    }
    existing.name = input.name;
    if (input.email) existing.email = input.email;
    if (input.altPhone) existing.altPhone = input.altPhone;
    if (input.gstin) existing.gstin = input.gstin;
    const known = existing.addresses.some(
      (a) => a.address.line1 === address.line1 && a.address.pincode === address.pincode,
    );
    if (!known)
      existing.addresses.push({ label: 'Address', isDefault: existing.addresses.length === 0, address });
    await existing.save({ session });
    return existing;
  }

  private async activity(
    orderId: Types.ObjectId,
    entry: {
      type: OrderActivityType;
      fromStatus?: OrderStatus;
      toStatus?: OrderStatus;
      message?: string;
      isInternal?: boolean;
    },
    actor: AuditActor,
    session?: ClientSession,
  ): Promise<void> {
    await OrderActivityModel.create(
      [
        {
          order: orderId,
          ...entry,
          isInternal: entry.isInternal ?? false,
          actor: { user: actor.user ? oid(actor.user) : undefined, name: actor.name, role: actor.role },
        },
      ],
      session ? { session } : {},
    );
  }
}

// ------------------------------------------------------------------ module helpers

function auditActor(actor: AuditActor): AuditActor {
  return { user: actor.user, name: actor.name, role: actor.role };
}

const label = (s: OrderStatus) => s.replace('_', ' ');

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function assertOrderable(built: BuiltOrder, enforceMinimum: boolean): void {
  if (built.unavailable.length > 0) {
    throw new AppError(
      400,
      'PRODUCT_UNAVAILABLE',
      'Some products are no longer available. Remove them and try again.',
      { items: built.unavailable },
    );
  }
  if (built.lines.length === 0) throw badRequest('VALIDATION_ERROR', 'Add at least one product');
  if (!built.serviceability.serviceable) {
    throw new AppError(
      400,
      'NOT_SERVICEABLE',
      built.serviceability.reason ?? 'We do not deliver to this location.',
    );
  }
  if (enforceMinimum && !built.meetsMinimum) {
    throw new AppError(
      400,
      'BELOW_MIN_ORDER',
      `The minimum order for this location is ${formatINR(built.serviceability.minOrderValue)}.`,
      {
        minOrderValue: built.serviceability.minOrderValue,
        subtotal: built.pricing.subtotal,
      },
    );
  }
}

function describeLineChanges(
  before: readonly { product: Types.ObjectId; name: string; qty: number }[],
  after: readonly { product: Types.ObjectId; name: string; qty: number }[],
): string[] {
  const b = new Map(before.map((l) => [String(l.product), l]));
  const a = new Map(after.map((l) => [String(l.product), l]));
  const out: string[] = [];
  for (const [id, l] of a) {
    const prev = b.get(id);
    if (!prev) out.push(`+ ${l.name} × ${l.qty}`);
    else if (prev.qty !== l.qty) out.push(`${l.name} ${prev.qty} → ${l.qty}`);
  }
  for (const [id, l] of b) if (!a.has(id)) out.push(`− ${l.name}`);
  return out;
}

function pricingDto(p: Order['pricing'] | BuiltOrder['pricing']) {
  return {
    mrpTotal: p.mrpTotal,
    productDiscount: p.productDiscount,
    subtotal: p.subtotal,
    couponCode: ('couponCode' in p ? p.couponCode : null) ?? null,
    couponDiscount: p.couponDiscount ?? 0,
    deliveryCharge: p.deliveryCharge ?? 0,
    deliveryChargeMode: p.deliveryChargeMode ?? 'to_pay',
    packingCharge: p.packingCharge ?? 0,
    taxableValue: p.taxableValue,
    cgst: p.cgst ?? 0,
    sgst: p.sgst ?? 0,
    igst: p.igst ?? 0,
    totalTax: p.totalTax,
    grossTotal: p.grossTotal,
    roundOff: p.roundOff ?? 0,
    grandTotal: p.grandTotal,
    isInterState: p.isInterState,
    placeOfSupply: p.placeOfSupply,
  };
}

/** Seller, buyer, lines, HSN summary and totals, frozen onto the invoice / credit note. */
function documentSnapshot(order: OrderDoc, settings: Settings | null) {
  const company = settings?.company;
  const sellerState = order.pricing.sellerStateCode;
  const items = order.items.map((i) => ({
    sku: i.sku,
    name: i.name,
    hsn: i.hsn,
    unit: i.unit,
    qty: i.qty,
    mrp: i.mrp,
    discountPct: i.discountPct,
    netPrice: i.netPrice,
    lineTotal: i.lineTotal,
    couponShare: i.couponShare ?? 0,
    taxRate: i.taxRate,
    taxableValue: i.taxableValue,
    cgst: i.cgst ?? 0,
    sgst: i.sgst ?? 0,
    igst: i.igst ?? 0,
  }));
  const summary = new Map<
    string,
    { hsn: string; taxRate: number; taxableValue: number; cgst: number; sgst: number; igst: number }
  >();
  const add = (
    hsn: string,
    taxRate: number,
    t: { taxableValue: number; cgst: number; sgst: number; igst: number },
  ) => {
    const key = `${hsn}|${taxRate}`;
    const row = summary.get(key) ?? { hsn, taxRate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxableValue += t.taxableValue;
    row.cgst += t.cgst;
    row.sgst += t.sgst;
    row.igst += t.igst;
    summary.set(key, row);
  };
  items.forEach((i) => add(i.hsn, i.taxRate, i));
  const ch = order.pricing.charges;
  if (ch && (ch.taxableValue ?? 0) > 0) {
    // The order saved the HSN / rate its charges were taxed at (from Settings at the time).
    add(ch.hsn ?? '', ch.taxRate ?? 0, {
      taxableValue: ch.taxableValue ?? 0,
      cgst: ch.cgst ?? 0,
      sgst: ch.sgst ?? 0,
      igst: ch.igst ?? 0,
    });
  }
  const p = order.pricing;
  return {
    order: order._id,
    orderNo: order.orderNo,
    seller: {
      name: company?.legalName || company?.name || '', // assertCanInvoice ensures a name
      legalName: company?.legalName,
      gstin: company?.gstin,
      licenseNumber: company?.licenseNumber,
      address: company?.address,
      phone: company?.phones?.[0],
      email: company?.email,
      stateCode: sellerState,
      gstStateCode: gstStateCodeOf(sellerState),
    },
    buyer: {
      name: order.customerSnapshot.name,
      phone: order.customerSnapshot.phone,
      gstin: order.customerSnapshot.gstin,
      address: order.shippingAddress,
    },
    placeOfSupply: order.pricing.placeOfSupply,
    isInterState: order.pricing.isInterState,
    items,
    hsnSummary: [...summary.values()],
    totals: {
      mrpTotal: p.mrpTotal,
      productDiscount: p.productDiscount,
      subtotal: p.subtotal,
      couponDiscount: p.couponDiscount ?? 0,
      deliveryCharge: p.deliveryCharge ?? 0,
      packingCharge: p.packingCharge ?? 0,
      taxableValue: p.taxableValue,
      cgst: p.cgst ?? 0,
      sgst: p.sgst ?? 0,
      igst: p.igst ?? 0,
      totalTax: p.totalTax,
      grossTotal: p.grossTotal,
      roundOff: p.roundOff ?? 0,
      grandTotal: p.grandTotal,
      amountInWords: rupeesInWords(p.grandTotal),
    },
  };
}

export { STOCK_COMMITTED_STATUSES };
