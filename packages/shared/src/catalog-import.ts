import { PRODUCT_UNITS, SOUND_LEVELS, type ProductUnit, type SoundLevel } from './enums.js';
import { MAX_AMOUNT_PAISE, type Paise } from './money.js';
import { HSN_REGEX } from './tax.js';

/**
 * Product import/export spreadsheet format. Single source of truth for the CSV and
 * Excel templates, the client guide, import validation and export columns.
 * Gift boxes (combos) are built in the admin panel, not imported.
 */
export interface ImportColumn {
  key: string;
  required: boolean;
  /** Short help shown in the Excel "Instructions" sheet and the client guide. */
  help: string;
  allowed?: readonly string[];
}

export const PRODUCT_IMPORT_COLUMNS = [
  {
    key: 'sku',
    required: true,
    help: 'Unique product code, e.g. SP-7CM. Letters, numbers, - _ / only. Existing SKU = update that product.',
  },
  { key: 'name', required: true, help: 'Product name as customers should see it.' },
  {
    key: 'category',
    required: true,
    help: 'Category name, e.g. Sparklers. Must match a category in the admin panel.',
  },
  { key: 'sub_category', required: false, help: 'Optional sub-category name inside the category.' },
  { key: 'unit', required: true, help: 'How it is sold.', allowed: PRODUCT_UNITS },
  {
    key: 'contents_per_unit',
    required: false,
    help: 'Pieces in one unit, e.g. 10 for a box of 10. Default 1.',
  },
  { key: 'mrp', required: true, help: 'MRP in rupees, e.g. 199 or 199.50 (no ₹ needed).' },
  {
    key: 'discount_percent',
    required: false,
    help: 'Discount %, e.g. 80 or 82.5. Default 0. Net price is calculated automatically.',
  },
  { key: 'hsn', required: false, help: 'Leave blank to use the category or store default (Settings).' },
  { key: 'gst_rate', required: false, help: 'GST % e.g. 18. Leave blank to use the category/store default.' },
  {
    key: 'opening_stock',
    required: false,
    help: 'Stock for NEW products only. Ignored for existing products (use Inventory).',
  },
  { key: 'low_stock_alert', required: false, help: 'Warn when stock falls to this number. Default 10.' },
  { key: 'green_cracker', required: false, help: 'yes or no. Default no.', allowed: ['yes', 'no'] },
  { key: 'sound_level', required: false, help: 'Default none.', allowed: SOUND_LEVELS },
  { key: 'min_age', required: false, help: 'Minimum age, e.g. 12. Leave blank if none.' },
  { key: 'safety_warning', required: false, help: 'Short safety note shown with the product.' },
  { key: 'description', required: false, help: 'Optional longer description.' },
  { key: 'tags', required: false, help: 'Optional keywords separated by ; e.g. kids;night' },
  { key: 'video_url', required: false, help: 'Optional YouTube/video link (https://...).' },
  {
    key: 'active',
    required: false,
    help: 'yes = visible on the website. Default yes.',
    allowed: ['yes', 'no'],
  },
  {
    key: 'featured',
    required: false,
    help: 'yes = show in featured section. Default no.',
    allowed: ['yes', 'no'],
  },
  {
    key: 'sort_order',
    required: false,
    help: 'Display order within the category (smaller first). Default 0.',
  },
] as const satisfies readonly ImportColumn[];

export type ImportColumnKey = (typeof PRODUCT_IMPORT_COLUMNS)[number]['key'];
export const PRODUCT_IMPORT_HEADERS: readonly ImportColumnKey[] = PRODUCT_IMPORT_COLUMNS.map((c) => c.key);

export const PRODUCT_IMPORT_EXAMPLES: readonly Record<ImportColumnKey, string>[] = [
  {
    sku: 'SP-7CM-ELEC',
    name: '7cm Electric Sparkler',
    category: 'Sparklers',
    sub_category: '',
    unit: 'box',
    contents_per_unit: '10',
    mrp: '199',
    discount_percent: '82.5',
    hsn: '',
    gst_rate: '',
    opening_stock: '500',
    low_stock_alert: '50',
    green_cracker: 'yes',
    sound_level: 'none',
    min_age: '6',
    safety_warning: 'Hold at arm length. Adult supervision.',
    description: '',
    tags: 'kids;sparkler',
    video_url: '',
    active: 'yes',
    featured: 'yes',
    sort_order: '1',
  },
  {
    sku: 'FP-BIG',
    name: 'Flower Pot Big',
    category: 'Flower Pots',
    sub_category: '',
    unit: 'box',
    contents_per_unit: '10',
    mrp: '450',
    discount_percent: '80',
    hsn: '',
    gst_rate: '',
    opening_stock: '300',
    low_stock_alert: '30',
    green_cracker: 'yes',
    sound_level: 'low',
    min_age: '12',
    safety_warning: 'Light on flat ground and step back.',
    description: '',
    tags: '',
    video_url: '',
    active: 'yes',
    featured: 'no',
    sort_order: '1',
  },
  {
    sku: 'RK-LUNIK',
    name: 'Lunik Rocket',
    category: 'Rockets',
    sub_category: '',
    unit: 'pkt',
    contents_per_unit: '10',
    mrp: '750',
    discount_percent: '80',
    hsn: '',
    gst_rate: '',
    opening_stock: '120',
    low_stock_alert: '20',
    green_cracker: 'no',
    sound_level: 'high',
    min_age: '14',
    safety_warning: 'Launch from a bottle in open space.',
    description: '',
    tags: 'aerial',
    video_url: '',
    active: 'yes',
    featured: 'no',
    sort_order: '2',
  },
];

/** Normalises a header cell: case, spaces, hyphens, stray `*`. */
export function normalizeImportHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface ImportRow {
  sku: string;
  name: string;
  category: string;
  subCategory: string | null;
  unit: ProductUnit;
  contentsCount: number;
  mrp: Paise;
  discountPct: number;
  hsn: string | null;
  taxRate: number | null;
  openingStock: number;
  lowStockThreshold: number | null;
  isGreen: boolean;
  soundLevel: SoundLevel;
  minAge: number | null;
  safetyWarning: string | null;
  description: string | null;
  tags: string[];
  videoUrl: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export type RowIssue = { column: ImportColumnKey; message: string };

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/;

/**
 * Parses one spreadsheet row (all values as text) into a typed product row.
 * Accepts what people actually type: "₹1,299.50", "82.5%", "Yes", " box ".
 */
export function parseImportRow(raw: Readonly<Record<string, string | undefined>>): {
  value?: ImportRow;
  issues: RowIssue[];
} {
  const issues: RowIssue[] = [];
  // Undo the formula guard added on export ('=… → =…) so export → import round-trips.
  const get = (k: ImportColumnKey) => (raw[k] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
  const fail = (column: ImportColumnKey, message: string) => void issues.push({ column, message });

  const text = (k: ImportColumnKey, max: number, required = false): string | null => {
    const v = get(k);
    if (!v) {
      if (required) fail(k, 'Required');
      return null;
    }
    if (v.length > max) fail(k, `Too long (max ${max} characters)`);
    if (BAD_TEXT.test(v)) fail(k, 'Contains invalid characters (< > or control characters)');
    return v;
  };

  const int = (k: ImportColumnKey, min: number, max: number): number | null => {
    const v = get(k).replace(/,/g, '');
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      fail(k, `Must be a whole number between ${min} and ${max}`);
      return null;
    }
    return n;
  };

  const decimal = (k: ImportColumnKey, min: number, max: number, strip: RegExp): number | null => {
    const v = get(k).replace(strip, '').trim();
    if (!v) return null;
    if (!/^-?\d+(\.\d{1,2})?$/.test(v)) {
      fail(k, 'Must be a number with at most 2 decimals');
      return null;
    }
    const n = Number(v);
    if (n < min || n > max) {
      fail(k, `Must be between ${min} and ${max}`);
      return null;
    }
    return n;
  };

  const yesNo = (k: ImportColumnKey, fallback: boolean): boolean => {
    const v = get(k).toLowerCase();
    if (!v) return fallback;
    if (YES.has(v)) return true;
    if (NO.has(v)) return false;
    fail(k, 'Use yes or no');
    return fallback;
  };

  const sku = text('sku', 40, true)?.toUpperCase() ?? '';
  if (sku && !/^[A-Z0-9][A-Z0-9\-_/]{0,39}$/.test(sku)) fail('sku', 'Letters, numbers, - _ / only');
  const name = text('name', 150, true) ?? '';
  if (name && name.length < 2) fail('name', 'Too short');
  const category = text('category', 80, true) ?? '';
  const subCategory = text('sub_category', 80);

  const unitRaw = get('unit').toLowerCase();
  const unit = (PRODUCT_UNITS as readonly string[]).includes(unitRaw) ? (unitRaw as ProductUnit) : null;
  if (!unitRaw) fail('unit', 'Required');
  else if (!unit) fail('unit', `Use one of: ${PRODUCT_UNITS.join(', ')}`);

  const mrpRupees = decimal('mrp', 0, MAX_AMOUNT_PAISE / 100, /[₹,\s]|rs\.?/gi);
  if (mrpRupees === null && !issues.some((i) => i.column === 'mrp')) fail('mrp', 'Required');
  const discountPct = decimal('discount_percent', 0, 100, /[%\s]/g) ?? 0;

  const hsn = get('hsn') || null;
  if (hsn && !HSN_REGEX.test(hsn)) fail('hsn', 'HSN must be 4, 6 or 8 digits');
  const taxRate = decimal('gst_rate', 0, 28, /[%\s]/g);

  const soundRaw = get('sound_level').toLowerCase().replace(/\s+/g, '_');
  const soundLevel = soundRaw
    ? (SOUND_LEVELS as readonly string[]).includes(soundRaw)
      ? (soundRaw as SoundLevel)
      : (fail('sound_level', `Use one of: ${SOUND_LEVELS.join(', ')}`), 'none')
    : 'none';

  const videoUrl = text('video_url', 500);
  if (videoUrl && !/^https?:\/\/\S+$/i.test(videoUrl))
    fail('video_url', 'Must start with http:// or https://');

  const tagsRaw = text('tags', 600);
  const tags = tagsRaw
    ? [
        ...new Set(
          tagsRaw
            .split(/[;|]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (tags.length > 20 || tags.some((t) => t.length > 30)) fail('tags', 'Max 20 tags of 30 characters');

  const row: ImportRow = {
    sku,
    name,
    category,
    subCategory,
    unit: unit ?? 'box',
    contentsCount: int('contents_per_unit', 1, 100_000) ?? 1,
    mrp: Math.round((mrpRupees ?? 0) * 100),
    discountPct,
    hsn,
    taxRate,
    openingStock: int('opening_stock', 0, 10_000_000) ?? 0,
    lowStockThreshold: int('low_stock_alert', 0, 1_000_000),
    isGreen: yesNo('green_cracker', false),
    soundLevel: soundLevel,
    minAge: int('min_age', 0, 21),
    safetyWarning: text('safety_warning', 500),
    description: text('description', 5000),
    tags,
    videoUrl,
    isActive: yesNo('active', true),
    isFeatured: yesNo('featured', false),
    sortOrder: int('sort_order', 0, 1_000_000) ?? 0,
  };
  return issues.length > 0 ? { issues } : { value: row, issues };
}

/**
 * Spreadsheet formula-injection guard for exports: a cell starting with = + - @ (or tab/CR)
 * is executed as a formula by Excel; prefix it with an apostrophe.
 */
export function safeSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
