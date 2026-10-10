import {
  DEFAULT_HSN,
  DEFAULT_SELLER_STATE_CODE,
  DEFAULT_TAX_RATE,
  type IndianStateCode,
} from '@sakthimaan/shared';
import { SETTINGS_ID, SettingsModel, type Settings } from '../models/index.js';

const TTL_MS = 30_000;

/**
 * Short-lived in-process cache of the settings singleton (read on most catalogue and
 * order requests). The settings service calls `invalidate()` after every update.
 */
export class SettingsCache {
  private value: Settings | null = null;
  private loadedAt = 0;
  private pending: Promise<Settings | null> | null = null;

  async get(): Promise<Settings | null> {
    if (this.loadedAt > 0 && Date.now() - this.loadedAt < TTL_MS) return this.value;
    this.pending ??= SettingsModel.findById(SETTINGS_ID)
      .lean<Settings>()
      .then((doc) => {
        this.value = doc;
        this.loadedAt = Date.now();
        return doc;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  invalidate(): void {
    this.loadedAt = 0;
  }

  async taxDefaults(): Promise<{ hsn: string; taxRate: number; sellerStateCode: IndianStateCode }> {
    const s = await this.get();
    return {
      hsn: s?.tax?.defaultHsn ?? DEFAULT_HSN,
      taxRate: s?.tax?.defaultTaxRate ?? DEFAULT_TAX_RATE,
      sellerStateCode: s?.tax?.sellerStateCode ?? DEFAULT_SELLER_STATE_CODE,
    };
  }

  async lowStockDefault(): Promise<number> {
    return (await this.get())?.inventory?.defaultLowStockThreshold ?? 10;
  }
}
