export { cn } from 'cn';

/**
 * On phones, show a dialog as a bottom sheet (full width, within thumb reach, scrollable).
 * Add to DialogContent's className.
 */
export const PHONE_SHEET =
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:max-h-[92svh] max-sm:overflow-y-auto max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]';
