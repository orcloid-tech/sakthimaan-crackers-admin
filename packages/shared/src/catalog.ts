import type {
  ComboStockMode,
  ProductType,
  ProductUnit,
  SoundLevel,
  StockMovementType,
  StorageProvider,
} from './enums.js';
import type { Paise } from './money.js';

/** API response shapes for the catalogue (admin). Amounts in paise. */

export interface ImageRefDto {
  provider: StorageProvider;
  key: string;
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  image: ImageRefDto | null;
  hsn: string | null;
  taxRate: number | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface CategoryTreeNode extends CategoryDto {
  children: CategoryDto[];
}

export interface ComboItemDto {
  productId: string;
  qty: number;
  sku: string | null;
  name: string | null;
  mrp: Paise | null;
  netPrice: Paise | null;
  isActive: boolean | null;
}

export interface ProductDto {
  id: string;
  version: number;
  name: string;
  slug: string;
  sku: string;
  type: ProductType;
  category: { id: string; name: string } | null;
  subCategory: { id: string; name: string } | null;
  description: string | null;
  tags: string[];
  mrp: Paise;
  discountPct: number;
  netPrice: Paise;
  /** Overrides (null = inherited) and the values that will apply to orders. */
  hsn: string | null;
  taxRate: number | null;
  effectiveTax: { hsn: string; taxRate: number };
  unit: ProductUnit;
  contentsCount: number;
  stock: number;
  stockVersion: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  trackBatches: boolean;
  /** Quantity on open enquiries (not yet deducted from stock). */
  pendingDemand: number;
  images: ImageRefDto[];
  videoUrl: string | null;
  isGreen: boolean;
  soundLevel: SoundLevel;
  minAge: number | null;
  safetyWarning: string | null;
  comboItems: ComboItemDto[];
  stockMode: ComboStockMode;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BulkPricePreviewRow {
  id: string;
  sku: string;
  name: string;
  before: { mrp: Paise; discountPct: number; netPrice: Paise };
  after: { mrp: Paise; discountPct: number; netPrice: Paise };
}

export interface BulkPriceResult {
  dryRun: boolean;
  matched: number;
  changed: number;
  rows: BulkPricePreviewRow[];
}

export interface ComboSuggestion {
  items: { productId: string; sku: string; name: string; qty: number; mrp: Paise; netPrice: Paise }[];
  itemsMrpTotal: Paise;
  itemsNetTotal: Paise;
  suggested: { mrp: Paise; discountPct: number; netPrice: Paise };
  /** What the customer saves vs buying the items separately (can be 0). */
  savingsVsSeparate: Paise;
}

export interface StockMovementDto {
  id: string;
  productId: string;
  product: { sku: string; name: string } | null;
  batchId: string | null;
  type: StockMovementType;
  qty: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string | null;
  refType: 'order' | 'import' | 'manual';
  refId: string | null;
  refLabel: string | null;
  actor: { userId: string | null; name: string };
  createdAt: string;
}

export interface DemandRow {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  pendingDemand: number;
  enquiryCount: number;
  /** pendingDemand − stock when positive, else 0. */
  shortBy: number;
}

export interface ImportIssue {
  /** Spreadsheet row number as the user sees it (header = row 1). */
  row: number;
  column?: string;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  categoriesToCreate: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  rows: { row: number; sku: string; action: 'create' | 'update' | 'unchanged' | 'error' }[];
}
