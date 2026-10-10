import { createRequire } from 'node:module';
import path from 'node:path';
import pdfmake from 'pdfmake';

const require = createRequire(import.meta.url);
const FONT_DIR = path.dirname(require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'));

export type DocDefinition = Parameters<typeof pdfmake.createPdf>[0];

let configured = false;

/** pdfmake with the bundled Roboto (has ₹); no network access and no other local files. */
export function getPdfmake(): typeof pdfmake {
  if (!configured) {
    pdfmake.setFonts({
      Roboto: {
        normal: path.join(FONT_DIR, 'Roboto-Regular.ttf'),
        bold: path.join(FONT_DIR, 'Roboto-Medium.ttf'),
        italics: path.join(FONT_DIR, 'Roboto-Italic.ttf'),
        bolditalics: path.join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
      },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((p: string) => path.resolve(p).startsWith(FONT_DIR));
    configured = true;
  }
  return pdfmake;
}

export async function renderPdf(doc: DocDefinition): Promise<Buffer> {
  return getPdfmake().createPdf(doc).getBuffer();
}

/** 1,234.50 (Indian grouping, always 2 decimals) for PDF tables. */
export const pdfMoney = (paise: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

export const pdfDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—';

export const PDF_COLORS = {
  brand: '#B45309',
  band: '#FEF3C7',
  muted: '#6B7280',
  line: '#D1D5DB',
  green: '#15803D',
  red: '#B91C1C',
};

export const thinTableLayout = {
  hLineWidth: () => 0.4,
  vLineWidth: () => 0.4,
  hLineColor: () => PDF_COLORS.line,
  vLineColor: () => PDF_COLORS.line,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};
