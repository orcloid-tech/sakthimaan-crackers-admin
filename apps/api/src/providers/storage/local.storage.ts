import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PutFileInput, StorageProvider, StoredFile } from './storage.provider.js';

const SAFE_KEY = /^[a-z0-9_-]+\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;

/**
 * Development storage: files on disk under LOCAL_UPLOAD_DIR, served by the API at
 * /uploads. Not for production on Render/Railway (ephemeral disk).
 */
export class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = path.resolve(rootDir);
  }

  get directory(): string {
    return this.root;
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const key = `${input.folder}/${randomUUID()}.${input.extension}`;
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer, { flag: 'wx' });
    return {
      provider: this.name,
      key,
      url: `${this.publicBaseUrl.replace(/\/$/, '')}/uploads/${key}`,
      width: input.width,
      height: input.height,
      bytes: input.buffer.length,
      mimeType: input.contentType,
    };
  }

  async read(file: Pick<StoredFile, 'key' | 'url'>): Promise<Buffer> {
    if (!SAFE_KEY.test(file.key)) throw new Error('Invalid storage key');
    return readFile(this.resolve(file.key));
  }

  async remove(key: string): Promise<void> {
    if (!SAFE_KEY.test(key)) return; // never touch paths we did not create
    try {
      await unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
}
