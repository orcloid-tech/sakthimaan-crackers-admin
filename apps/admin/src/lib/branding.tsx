import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { API_BASE } from './config';
import { cn } from './utils';

export interface Branding {
  storeName: string | null;
  logoUrl: string | null;
}

export const brandingKey = ['branding'] as const;

/**
 * Store name and logo from Settings (public endpoint, so the sign-in page can show them).
 * Nothing is assumed when they aren't set yet: screens fall back to neutral wording.
 */
export function useBranding() {
  return useQuery({
    queryKey: brandingKey,
    queryFn: async (): Promise<Branding> => {
      const res = await fetch(`${API_BASE}/branding`, { credentials: 'include' });
      if (!res.ok) return { storeName: null, logoUrl: null };
      return ((await res.json()) as { data: Branding }).data;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Logo if one is uploaded, otherwise a plain store icon. */
export function BrandMark({ logoUrl, size = 32 }: { logoUrl: string | null | undefined; size?: number }) {
  return logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="shrink-0 rounded-lg object-contain"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={cn('bg-primary text-primary-foreground grid shrink-0 place-items-center rounded-lg')}
      style={{ width: size, height: size }}
    >
      <Store className="size-4" aria-hidden />
    </span>
  );
}

/** Keeps the browser tab title in step with the store name ("<Store> · Admin"). */
export function BrandingTitle() {
  const name = useBranding().data?.storeName;
  useEffect(() => {
    document.title = name ? `${name} · Admin` : 'Admin';
  }, [name]);
  return null;
}
