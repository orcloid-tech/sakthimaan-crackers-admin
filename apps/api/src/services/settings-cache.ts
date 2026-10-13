import type { IndianStateCode } from '@sakthimaan/shared';
import { SETTINGS_ID, SettingsModel, type Settings } from '../models/index.js';

const TTL_MS = 30_000;

/** Store tax defaults as saved in Settings; `null` = not entered yet (no code fallback). */
export interface TaxDefaults {
  hsn: string | null;
  taxRate: number | null;
  sellerStateCode: IndianStateCode | null;
}

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

  async taxDefaults(): Promise<TaxDefaults> {
    const s = await this.get();
    return {
      hsn: s?.tax?.defaultHsn ?? null,
      taxRate: s?.tax?.defaultTaxRate ?? null,
      sellerStateCode: s?.tax?.sellerStateCode ?? null,
    };
  }

  /** Alert level for new products; null = none set (no low-stock alert until one is). */
  async lowStockDefault(): Promise<number | null> {
    return (await this.get())?.inventory?.defaultLowStockThreshold ?? null;
  }
}
