import type { ClientSession, Types } from 'mongoose';
import {
  computeNetPrice,
  priceOrder,
  resolveTaxIfSet,
  type DeliveryChargeMode,
  type IndianStateCode,
  type NetPriceRounding,
  type PricingResult,
  type Serviceability,
  type ShortageItem,
} from '@sakthimaan/shared';
import { CityModel, ProductModel, ServiceStateModel, ZoneModel, pricingContext } from '../../models/index.js';
import { categoryLookup } from '../../repositories/catalog.repository.js';
import type { SettingsCache } from '../settings-cache.js';
import { assertCanPrice, setupIncomplete } from '../setup.js';

/** Snapshot of one order line, exactly as stored on the order. */
export interface LineSnapshot {
  product: Types.ObjectId;
  sku: string;
  name: string;
  type: 'single' | 'combo';
  categoryId: Types.ObjectId;
  categoryName: string;
  unit: 'box' | 'pkt' | 'piece';
  contentsCount: number;
  isGreen: boolean;
  hsn: string;
  taxRate: number;
  mrp: number;
  discountPct: number;
  netPrice: number;
  qty: number;
  lineMrpTotal: number;
  lineTotal: number;
  couponShare: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  comboContents: { sku: string; name: string; qty: number }[];
}

export interface BuiltOrder {
  lines: LineSnapshot[];
  pricing: PricingResult & {
    sellerStateCode: IndianStateCode;
    placeOfSupply: IndianStateCode;
    deliveryChargeMode: DeliveryChargeMode;
    netPriceRounding: NetPriceRounding;
    charges: PricingResult['charges'] & { hsn: string };
  };
  serviceability: Serviceability;
  unavailable: { productId: string; reason: string }[];
  /** Lines whose quantity exceeds current stock (informational for enquiries). */
  shortages: ShortageItem[];
  meetsMinimum: boolean;
}

/**
 * Builds order lines from the live catalogue: only active products, prices and tax
 * resolved now (product → sub-category → category → settings) and snapshotted, then
 * priced with the shared engine (GST-inclusive, CGST+SGST vs IGST, round-off).
 * Client-sent prices are never used.
 */
export class OrderBuilder {
  constructor(private readonly settings: SettingsCache) {}

  async build(
    items: readonly { productId: string; qty: number }[],
    destination: { stateCode: IndianStateCode; city?: string },
    opts: { deliveryCharge?: number; deliveryChargeMode?: DeliveryChargeMode; session?: ClientSession } = {},
  ): Promise<BuiltOrder> {
    const [settings, taxDefaults, categories, serviceability] = await Promise.all([
      this.settings.get(),
      this.settings.taxDefaults(),
      categoryLookup(),
      this.serviceability(destination.stateCode, destination.city),
    ]);
    assertCanPrice(settings);
    const sellerStateCode = taxDefaults.sellerStateCode;
    if (!sellerStateCode) throw new Error('unreachable: checked by assertCanPrice');
    const products = await ProductModel.find({ _id: { $in: items.map((i) => i.productId) } })
      .session(opts.session ?? null)
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const comboIds = products.flatMap((p) => p.comboItems.map((c) => c.product));
    const comboNames = new Map(
      (
        await ProductModel.find({ _id: { $in: comboIds } }, { sku: 1, name: 1 }, { withDeleted: true }).lean()
      ).map((p) => [String(p._id), p]),
    );

    const unavailable: BuiltOrder['unavailable'] = [];
    const shortages: ShortageItem[] = [];
    const usable: { product: (typeof products)[number]; qty: number; hsn: string; taxRate: number }[] = [];
    const noTax: string[] = [];
    for (const item of items) {
      const p = byId.get(item.productId);
      if (!p) {
        unavailable.push({ productId: item.productId, reason: 'Product no longer exists' });
        continue;
      }
      if (!p.isActive) {
        unavailable.push({ productId: item.productId, reason: `${p.name} is not available for sale` });
        continue;
      }
      const cat = categories.get(String(p.category));
      const sub = p.subCategory ? categories.get(String(p.subCategory)) : undefined;
      const inherited =
        sub && (sub.hsn != null || sub.taxRate != null)
          ? { hsn: sub.hsn ?? cat?.hsn, taxRate: sub.taxRate ?? cat?.taxRate }
          : cat;
      const tax = resolveTaxIfSet(p, inherited, taxDefaults);
      if (tax.hsn === null || tax.taxRate === null) {
        noTax.push(p.name);
        continue;
      }
      usable.push({ product: p, qty: item.qty, hsn: tax.hsn, taxRate: tax.taxRate });
      if (item.qty > p.stock) {
        shortages.push({
          productId: String(p._id),
          sku: p.sku,
          name: p.name,
          requested: item.qty,
          available: p.stock,
          shortBy: item.qty - p.stock,
        });
      }
    }

    if (noTax.length) {
      throw setupIncomplete(`No GST rate / HSN for ${noTax.join(', ')}`, [
        {
          key: 'defaultTaxRate',
          label: 'Default GST rate and HSN (or set them on the product or its category)',
          tab: 'billing',
          blocks: 'orders',
        },
      ]);
    }

    const subtotalEstimate = usable.reduce((s, u) => s + u.product.netPrice * u.qty, 0);
    const deliveryChargeMode = opts.deliveryChargeMode ?? serviceability.deliveryChargeMode;
    const deliveryCharge =
      deliveryChargeMode === 'to_pay'
        ? 0
        : (opts.deliveryCharge ?? (await this.zoneDeliveryCharge(destination.stateCode, subtotalEstimate)));
    const packingPct = settings?.order?.packingChargePct ?? 0;
    const packingCharge = packingPct > 0 ? Math.round((subtotalEstimate * packingPct) / 100) : 0;

    if (deliveryCharge + packingCharge > 0 && (taxDefaults.hsn === null || taxDefaults.taxRate === null)) {
      throw setupIncomplete('Delivery / packing charges need a GST rate', [
        { key: 'defaultTaxRate', label: 'Default GST rate and HSN', tab: 'billing', blocks: 'orders' },
      ]);
    }
    const priced = priceOrder({
      lines: usable.map((u) => ({
        mrp: u.product.mrp,
        netPrice: u.product.netPrice,
        qty: u.qty,
        hsn: u.hsn,
        taxRate: u.taxRate,
      })),
      deliveryCharge,
      packingCharge,
      // Only used when there are charges (checked above).
      chargesHsn: taxDefaults.hsn ?? '',
      chargesTaxRate: taxDefaults.taxRate ?? 0,
      sellerStateCode,
      buyerStateCode: destination.stateCode,
    });

    const lines: LineSnapshot[] = usable.map((u, i) => {
      const p = u.product;
      const priceLine = priced.lines[i];
      if (!priceLine) throw new Error('Pricing line missing');
      return {
        product: p._id,
        sku: p.sku,
        name: p.name,
        type: p.type,
        categoryId: p.category,
        categoryName: categories.get(String(p.category))?.name ?? '—',
        unit: p.unit,
        contentsCount: p.contentsCount ?? 1,
        isGreen: p.isGreen,
        hsn: u.hsn,
        taxRate: u.taxRate,
        mrp: p.mrp,
        discountPct: p.discountPct,
        netPrice: p.netPrice,
        qty: u.qty,
        ...priceLine,
        comboContents: p.comboItems.map((c) => ({
          sku: comboNames.get(String(c.product))?.sku ?? '',
          name: comboNames.get(String(c.product))?.name ?? '',
          qty: c.qty,
        })),
      };
    });

    return {
      lines,
      pricing: {
        ...priced,
        charges: { ...priced.charges, hsn: taxDefaults.hsn ?? '' },
        sellerStateCode,
        placeOfSupply: destination.stateCode,
        deliveryChargeMode,
        netPriceRounding: pricingContext.roundingMode,
      },
      serviceability,
      unavailable,
      shortages,
      meetsMinimum: priced.subtotal >= serviceability.minOrderValue,
    };
  }

  /**
   * Where we deliver and the minimum order: city override → state → zone → store default.
   * With no shipping data set up yet, everything is serviceable.
   */
  async serviceability(stateCode: IndianStateCode, city?: string): Promise<Serviceability> {
    const [settings, state, cityDoc] = await Promise.all([
      this.settings.get(),
      ServiceStateModel.findOne({ code: stateCode }).lean(),
      city
        ? CityModel.findOne({ stateCode, nameKey: city.trim().toLowerCase().replace(/\s+/g, ' ') }).lean()
        : null,
    ]);
    const zone = state?.zone ? await ZoneModel.findOne({ _id: state.zone, isActive: true }).lean() : null;
    // Delivery is switched on per state in Delivery & zones; nothing is assumed.
    const serviceable = cityDoc ? cityDoc.isServiceable : (state?.isServiceable ?? false);
    const reason = serviceable
      ? null
      : (cityDoc?.restrictionNote ??
        state?.restrictionNote ??
        `Sorry, we don't deliver to ${cityDoc?.name ?? state?.name ?? stateCode} yet.`);
    const minOrderValue =
      cityDoc?.minOrderValue ??
      state?.minOrderValue ??
      zone?.minOrderValue ??
      settings?.order?.defaultMinOrderValue ??
      0;
    return {
      serviceable,
      reason,
      minOrderValue,
      zoneName: zone?.name ?? null,
      deliveryChargeMode: zone?.deliveryChargeMode ?? 'to_pay',
      estimatedDays:
        zone?.estimatedDeliveryDays?.min != null && zone.estimatedDeliveryDays.max != null
          ? { min: zone.estimatedDeliveryDays.min, max: zone.estimatedDeliveryDays.max }
          : null,
    };
  }

  /** Prepaid delivery: first matching band of the zone's rules (flat ₹ / % of subtotal / free). */
  private async zoneDeliveryCharge(stateCode: IndianStateCode, subtotal: number): Promise<number> {
    const state = await ServiceStateModel.findOne({ code: stateCode }).lean();
    const zone = state?.zone ? await ZoneModel.findById(state.zone).lean() : null;
    const rule = zone?.deliveryRules.find(
      (r) => subtotal >= (r.minOrderValue ?? 0) && (r.maxOrderValue == null || subtotal < r.maxOrderValue),
    );
    if (!rule || rule.type === 'free') return 0;
    return rule.type === 'flat'
      ? Math.round(rule.value ?? 0)
      : computeNetPrice(subtotal, 100 - (rule.value ?? 0), 'nearest_paisa');
  }
}
