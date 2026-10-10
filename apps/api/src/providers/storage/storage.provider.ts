import type { StorageProvider as StorageProviderName } from '@sakthimaan/shared';

/** A stored file, in the shape persisted on documents (`imageSchema`). */
export interface StoredFile {
  provider: StorageProviderName;
  key: string;
  url: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
}

export interface PutFileInput {
  buffer: Buffer;
  /** Logical folder, e.g. "products", "categories", "payments". */
  folder: string;
  contentType: string;
  extension: string;
  width?: number;
  height?: number;
}

/**
 * File storage behind one interface so services don't care whether files live on
 * Cloudinary (production) or local disk (development).
 */
export interface StorageProvider {
  readonly name: StorageProviderName;
  put(input: PutFileInput): Promise<StoredFile>;
  /** Idempotent: removing a missing file is not an error. */
  remove(key: string): Promise<void>;
}

export const STORAGE_FOLDERS = ['products', 'categories', 'banners', 'payments', 'company'] as const;
export type StorageFolder = (typeof STORAGE_FOLDERS)[number];
