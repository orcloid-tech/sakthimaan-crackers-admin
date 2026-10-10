import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { PutFileInput, StorageProvider, StoredFile } from './storage.provider.js';

/**
 * Production storage. Images are uploaded already sanitised and re-encoded (WebP), and
 * served from Cloudinary's CDN; on-the-fly resizing uses shared `imageUrl()`.
 */
export class CloudinaryStorage implements StorageProvider {
  readonly name = 'cloudinary' as const;

  constructor(
    config: { cloudName: string; apiKey: string; apiSecret: string },
    private readonly rootFolder: string,
  ) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${this.rootFolder}/${input.folder}`,
          resource_type: 'image',
          unique_filename: true,
          overwrite: false,
        },
        (err, res) => {
          if (err || !res) reject(err instanceof Error ? err : new Error('Cloudinary upload failed'));
          else resolve(res);
        },
      );
      stream.end(input.buffer);
    });
    return {
      provider: this.name,
      key: result.public_id,
      url: result.secure_url,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      mimeType: input.contentType,
    };
  }

  async remove(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key, { invalidate: true, resource_type: 'image' });
  }
}
