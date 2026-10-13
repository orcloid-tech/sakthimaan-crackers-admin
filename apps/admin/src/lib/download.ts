import { api, type Query } from './api';

/** Downloads an authenticated file (CSV/XLSX/PDF) and saves it with the server's file name. */
export async function downloadFile(
  path: string,
  query: Query | undefined,
  fallbackName: string,
): Promise<void> {
  const { blob, filename } = await api.blob(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? fallbackName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Phones and tablets: a blob URL in a new tab often opens blank (Android) or traps the user in a
 * tab with no way back, so there we save the file instead and the system viewer opens it.
 */
const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 1279.98px)').matches;

/** Opens an authenticated PDF in a new tab on desktop; downloads it on phones and tablets. */
export async function openPdf(path: string, query: Query | undefined, fallbackName: string): Promise<void> {
  if (isTouchDevice()) return downloadFile(path, query, fallbackName);
  const tab = window.open('', '_blank');
  let blob: Blob;
  let filename: string | null;
  try {
    ({ blob, filename } = await api.blob(path, query));
  } catch (err) {
    tab?.close();
    throw err;
  }
  const url = URL.createObjectURL(blob);
  if (tab) {
    tab.location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? fallbackName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
