import type { LucideIcon } from 'lucide-react';
import { Package } from 'lucide-react';
import type { Permission, ProductDto } from '@sakthimaan/shared';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  to: string;
}

export interface SearchSource {
  key: string;
  label: string;
  placeholder: string;
  icon: LucideIcon;
  /** The user needs all of these to see this group. */
  permissions: Permission[];
  /** Skip the request when the text can't match (e.g. phone search needs digits). */
  matches: (q: string) => boolean;
  search: (q: string, signal: AbortSignal) => Promise<SearchResult[]>;
}

/** Sources for the header search. Modules add theirs here. */
export const searchSources: SearchSource[] = [
  {
    key: 'products',
    label: 'Products',
    placeholder: 'product name or SKU',
    icon: Package,
    permissions: ['products:read'],
    matches: () => true,
    search: async (q, signal) => {
      const res = await api.get<ProductDto[]>('/products', { q, pageSize: 8, sort: 'name' }, signal);
      return res.data.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.sku}${p.isActive ? '' : ' · Draft'}`,
        meta: money(p.netPrice),
        to: p.type === 'combo' ? `/gift-boxes/${p.id}` : `/products/${p.id}`,
      }));
    },
  },
];
