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

/** Opens an authenticated PDF in a new tab (falls back to download if pop-ups are blocked). */
export async function openPdf(path: string, query: Query | undefined, fallbackName: string): Promise<void> {
  const tab = window.open('', '_blank');
  const { blob, filename } = await api.blob(path, query);
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
