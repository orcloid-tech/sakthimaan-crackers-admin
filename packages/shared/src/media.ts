/**
 * Image URLs with CDN transforms. Cloudinary URLs get on-the-fly resizing and
 * automatic format/quality (WebP/AVIF where supported); other providers are returned as-is.
 */
export function imageUrl(
  image: { provider: string; url: string } | null | undefined,
  opts: { width?: number; height?: number; crop?: 'limit' | 'fill' | 'pad' } = {},
): string | null {
  if (!image) return null;
  if (image.provider !== 'cloudinary' || !image.url.includes('/upload/')) return image.url;
  const parts = ['f_auto', 'q_auto', `c_${opts.crop ?? 'limit'}`];
  if (opts.width) parts.push(`w_${Math.round(opts.width)}`);
  if (opts.height) parts.push(`h_${Math.round(opts.height)}`);
  return image.url.replace('/upload/', `/upload/${parts.join(',')}/`);
}
