import sharp from 'sharp';
import type { CategoryDto, ProductDto } from '@sakthimaan/shared';
import type { signedIn } from '../helpers/app.js';

type Session = Awaited<ReturnType<typeof signedIn>>;

let n = 0;
const next = () => (n += 1);

export async function makeCategory(s: Session, body: Record<string, unknown> = {}): Promise<CategoryDto> {
  const res = await s.post('/api/v1/categories').send({ name: `Category ${next()}`, ...body });
  if (res.status !== 201) throw new Error(`category create failed: ${JSON.stringify(res.body)}`);
  return (res.body as { data: CategoryDto }).data;
}

export async function makeProduct(
  s: Session,
  categoryId: string,
  body: Record<string, unknown> = {},
): Promise<ProductDto> {
  const i = next();
  const res = await s.post('/api/v1/products').send({
    name: `Product ${i}`,
    sku: `SKU-${i}-${Date.now() % 100000}`,
    categoryId,
    unit: 'box',
    contentsCount: 10,
    mrp: 19_900,
    discountPct: 80,
    ...body,
  });
  if (res.status !== 201) throw new Error(`product create failed: ${JSON.stringify(res.body)}`);
  return (res.body as { data: ProductDto }).data;
}

/** A real PNG of the given size. */
export function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 230, g: 120, b: 20 } } })
    .png()
    .toBuffer();
}
