import type { Logger } from '../config/logger.js';
import { SETTINGS_ID, SettingsModel, pricingContext } from '../models/index.js';

/**
 * Loads settings that model hooks need synchronously (net-price rounding mode).
 * Called at startup; the settings service (phase 5) calls it again after updates.
 */
export async function loadRuntimeSettings(logger: Logger): Promise<void> {
  const settings = await SettingsModel.findById(SETTINGS_ID).select('pricing').lean();
  const mode = settings?.pricing?.netPriceRounding;
  if (mode) pricingContext.setRoundingMode(mode);
  logger.info(
    { netPriceRounding: pricingContext.roundingMode, settingsFound: settings !== null },
    'Runtime settings loaded',
  );
}
