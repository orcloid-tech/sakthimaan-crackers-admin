import type { Env } from '../../config/env.js';
import { CloudinaryStorage } from './cloudinary.storage.js';
import { LocalStorage } from './local.storage.js';
import type { StorageProvider } from './storage.provider.js';

export * from './image-processing.js';
export * from './storage.provider.js';
export { LocalStorage, CloudinaryStorage };

export function createStorage(env: Env): StorageProvider {
  if (env.STORAGE_PROVIDER === 'cloudinary') {
    return new CloudinaryStorage(
      {
        cloudName: env.CLOUDINARY_CLOUD_NAME ?? '',
        apiKey: env.CLOUDINARY_API_KEY ?? '',
        apiSecret: env.CLOUDINARY_API_SECRET ?? '',
      },
      env.CLOUDINARY_FOLDER,
    );
  }
  // No PUBLIC_API_URL: relative /uploads URLs, served through the admin's dev proxy (works on a phone over Wi-Fi too).
  return new LocalStorage(env.LOCAL_UPLOAD_DIR, env.PUBLIC_API_URL ?? '');
}
