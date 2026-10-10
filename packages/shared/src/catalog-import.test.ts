import { describe, expect, it } from 'vitest';
import {
  PRODUCT_IMPORT_EXAMPLES,
  PRODUCT_IMPORT_HEADERS,
  normalizeImportHeader,
  parseImportRow,
  safeSpreadsheetCell,
} from './catalog-import.js';
import { imageUrl } from './media.js';

describe('parseImportRow', () => {
  it('parses every example row in the template', () => {
    for (const example of PRODUCT_IMPORT_EXAMPLES) {
      const { value, issues } = parseImportRow(example);
      expect(issues).toEqual([]);
      expect(value?.sku).toBe(example.sku);
    }
    expect(Object.keys(PRODUCT_IMPORT_EXAMPLES[0]!)).toEqual([...PRODUCT_IMPORT_HEADERS]);
  });

  it('accepts what people type in spreadsheets', () => {
    const { value } = parseImportRow({
      sku: ' sp-7cm ',
      name: '7cm Sparkler',
      category: 'Sparklers',
      unit: ' Box ',
      mrp: '₹1,299.50',
      discount_percent: '82.5%',
      green_cracker: 'Yes',
      sound_level: 'Very High',
      tags: 'kids; night ;kids',
      gst_rate: '18',
    });
    expect(value).toMatchObject({
      sku: 'SP-7CM',
      unit: 'box',
      mrp: 129_950,
      discountPct: 82.5,
      isGreen: true,
      soundLevel: 'very_high',
      tags: ['kids', 'night'],
      taxRate: 18,
      hsn: null,
      isActive: true,
      isFeatured: false,
      contentsCount: 1,
      openingStock: 0,
    });
  });

  it('reports every problem in a row with its column', () => {
    const { value, issues } = parseImportRow({
      sku: 'BAD SKU!',
      name: '',
      category: 'Sparklers',
      unit: 'carton',
      mrp: '12.345',
      discount_percent: '120',
      hsn: '36',
      green_cracker: 'maybe',
      video_url: 'javascript:alert(1)',
      safety_warning: '<script>',
    });
    expect(value).toBeUndefined();
    expect(issues.map((i) => i.column).sort()).toEqual(
      [
        'discount_percent',
        'green_cracker',
        'hsn',
        'mrp',
        'name',
        'safety_warning',
        'sku',
        'unit',
        'video_url',
      ].sort(),
    );
  });

  it('requires mrp', () => {
    const { issues } = parseImportRow({ sku: 'A1', name: 'Atom', category: 'Bombs', unit: 'box' });
    expect(issues).toEqual([{ column: 'mrp', message: 'Required' }]);
  });
});

describe('helpers', () => {
  it('normalizes headers', () => {
    expect(normalizeImportHeader(' Discount Percent* ')).toBe('discount_percent');
    expect(normalizeImportHeader('sub-category')).toBe('sub_category');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(safeSpreadsheetCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(safeSpreadsheetCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(safeSpreadsheetCell('Flower Pot')).toBe('Flower Pot');
  });

  it('adds Cloudinary transforms only to Cloudinary URLs', () => {
    const cdn = {
      provider: 'cloudinary',
      url: 'https://res.cloudinary.com/demo/image/upload/v1/smc/p/abc.webp',
    };
    expect(imageUrl(cdn, { width: 400 })).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_400/v1/smc/p/abc.webp',
    );
    expect(imageUrl({ provider: 'local', url: 'http://localhost:4000/uploads/a.webp' }, { width: 400 })).toBe(
      'http://localhost:4000/uploads/a.webp',
    );
    expect(imageUrl(null)).toBeNull();
  });
});
