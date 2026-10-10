import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/app-error.js';

/**
 * In-memory multipart parsing with hard limits. Files never touch disk unprocessed;
 * images are then sniffed and re-encoded (image-processing.ts), spreadsheets parsed.
 */
export function imageUpload(opts: { maxMb: number; maxFiles: number; field?: string }): RequestHandler {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: opts.maxMb * 1024 * 1024,
      files: opts.maxFiles,
      fields: 10,
      parts: opts.maxFiles + 10,
    },
  }).array(opts.field ?? 'files', opts.maxFiles);
}

export function spreadsheetUpload(opts: { maxMb: number }): RequestHandler {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxMb * 1024 * 1024, files: 1, fields: 5, parts: 6 },
    fileFilter: (_req, file, cb) => {
      const name = file.originalname.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.xlsx')) cb(null, true);
      else cb(new AppError(400, 'VALIDATION_ERROR', 'Upload a .csv or .xlsx file'));
    },
  }).single('file');
}

/** Maps multer's errors to the API envelope (used by the central error handler). */
export function multerToAppError(err: unknown): AppError | null {
  if (!(err instanceof multer.MulterError)) return null;
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'File is too large');
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new AppError(400, 'VALIDATION_ERROR', 'Too many files, or an unexpected file field');
    default:
      return new AppError(400, 'VALIDATION_ERROR', 'Invalid upload');
  }
}
