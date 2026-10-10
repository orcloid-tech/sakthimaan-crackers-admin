import { DEFAULT_NET_PRICE_ROUNDING, type NetPriceRounding } from '@sakthimaan/shared';

/**
 * Process-wide net-price rounding mode used by the Product validate hook.
 * Loaded from settings at startup and updated by the settings service; when the mode
 * changes, the settings service also recomputes netPrice for every product.
 */
let roundingMode: NetPriceRounding = DEFAULT_NET_PRICE_ROUNDING;

export const pricingContext = {
  get roundingMode(): NetPriceRounding {
    return roundingMode;
  },
  setRoundingMode(mode: NetPriceRounding): void {
    roundingMode = mode;
  },
};
