import sharp from 'sharp';
import type { Logger } from '../config/logger.js';
import type { StorageProvider } from '../providers/storage/index.js';
import type { SettingsCache } from './settings-cache.js';

/**
 * Company images for PDFs. pdfmake embeds PNG/JPEG only, so the stored WebP logo is
 * converted once (small PNG) and kept in memory, keyed by the stored file. A missing
 * or unreadable logo never breaks a document: it is simply left out.
 */
export class CompanyAssets {
  private cache = new Map<string, string>();

  constructor(
    private readonly storage: StorageProvider,
    private readonly settings: SettingsCache,
    private readonly logger?: Logger,
  ) {}

  /** The logo as a PNG data URL, or null. */
  async logo(): Promise<string | null> {
    const file = (await this.settings.get())?.company?.logo;
    if (!file?.key) return null;
    const hit = this.cache.get(file.key);
    if (hit) return hit;
    try {
      const raw = await this.storage.read(file);
      const png = await sharp(raw, { limitInputPixels: 40_000_000 })
        .resize({ width: 480, height: 200, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      this.cache.clear(); // only the current logo is worth keeping
      this.cache.set(file.key, dataUrl);
      return dataUrl;
    } catch (err) {
      this.logger?.warn({ err, key: file.key }, 'Company logo could not be loaded for a PDF');
      return null;
    }
  }
}
