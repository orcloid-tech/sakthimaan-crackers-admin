/**
 * Regenerates the product import templates in docs/templates from the shared column
 * definitions (the same code the API uses for GET /products/import/template):
 *
 *   npm run templates -w @sakthimaan/api
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IMPORT_EXAMPLES } from '@sakthimaan/shared';
import {
  DEFAULT_TEMPLATE_CATEGORIES,
  buildProductsWorkbook,
  buildTemplateCsv,
} from '../services/catalog/spreadsheet.js';

const outDir = fileURLToPath(new URL('../../../../docs/templates/', import.meta.url));

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}product-import-template.csv`, buildTemplateCsv());
await writeFile(
  `${outDir}product-import-template.xlsx`,
  await buildProductsWorkbook({
    rows: PRODUCT_IMPORT_EXAMPLES,
    categories: DEFAULT_TEMPLATE_CATEGORIES,
    withInstructions: true,
  }),
);
console.log(`Templates written to ${outDir}`);
