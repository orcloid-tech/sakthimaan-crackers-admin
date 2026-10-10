import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { AppError } from '../../utils/app-error.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_DIMENSION = 1600;
const MAX_INPUT_PIXELS = 40_000_000; // ~40 MP: blocks decompression bombs

export interface ProcessedImage {
  buffer: Buffer;
  contentType: 'image/webp';
  extension: 'webp';
  width: number;
  height: number;
}

/**
 * Sanitises an uploaded image:
 * 1. Detects the real type from the file's bytes (the client's MIME type and file name
 *    are ignored), allowing JPEG/PNG/WebP/AVIF only.
 * 2. Re-encodes with sharp: applies EXIF rotation, drops all metadata (GPS, camera),
 *    discards anything appended to the image (polyglot files), limits the size.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Upload a JPEG, PNG, WebP or AVIF image', [
      { location: 'body', path: 'file', message: 'Unsupported file type', code: 'invalid_type' },
    ]);
  }
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      contentType: 'image/webp',
      extension: 'webp',
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'The image could not be read. Try another file.', [
      { location: 'body', path: 'file', message: 'Corrupt or unsupported image', code: 'invalid_image' },
    ]);
  }
}
