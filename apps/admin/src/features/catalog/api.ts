import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkPriceInput,
  BulkPriceResult,
  CategoryCreateInput,
  CategoryDto,
  CategoryTreeNode,
  CategoryUpdateInput,
  ComboSuggestion,
  ComboSuggestionInput,
  CursorPageMeta,
  DemandRow,
  ImportReport,
  OffsetPageMeta,
  ProductCreateInput,
  ProductDto,
  ProductPriceInput,
  ProductUpdateInput,
  StockMovementDto,
  StockMovementInput,
} from '@sakthimaan/shared';
import { api, type Query } from '@/lib/api';

export const keys = {
  categories: ['categories'] as const,
  products: ['products'] as const,
  productList: (q: Query) => ['products', 'list', q] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  inventory: ['inventory'] as const,
  lowStock: (q: Query) => ['inventory', 'low-stock', q] as const,
  demand: (q: Query) => ['inventory', 'demand', q] as const,
  movements: (q: Query) => ['inventory', 'movements', q] as const,
  ledger: (id: string) => ['inventory', 'ledger', id] as const,
  batches: (id: string) => ['inventory', 'batches', id] as const,
};

// ------------------------------------------------------------------ categories

export function useCategoryTree() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () => (await api.get<CategoryTreeNode[]>('/categories')).data,
    staleTime: 60_000,
  });
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.categories });
  return {
    create: useMutation({
      mutationFn: (body: CategoryCreateInput) => api.post<CategoryDto>('/categories', body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: CategoryUpdateInput }) =>
        api.patch<CategoryDto>(`/categories/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/categories/${id}`),
      onSuccess: invalidate,
    }),
    reorder: useMutation({
      mutationFn: (items: { id: string; sortOrder: number }[]) => api.patch('/categories/reorder', { items }),
      onSuccess: invalidate,
    }),
    setImage: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('files', file);
        return api.upload<CategoryDto>(`/categories/${id}/image`, form);
      },
      onSuccess: invalidate,
    }),
  };
}

// ------------------------------------------------------------------ products

export function useProducts(q: Query) {
  return useQuery({
    queryKey: keys.productList(q),
    queryFn: ({ signal }) => api.get<ProductDto[], OffsetPageMeta>('/products', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: keys.product(id ?? ''),
    queryFn: async () => (await api.get<ProductDto>(`/products/${id}`)).data,
    enabled: !!id,
  });
}

export function useProductMutations() {
  const qc = useQueryClient();
  const refresh = (p?: ProductDto) => {
    if (p) qc.setQueryData(keys.product(p.id), p);
    void qc.invalidateQueries({ queryKey: keys.products });
    void qc.invalidateQueries({ queryKey: keys.inventory });
    void qc.invalidateQueries({ queryKey: keys.categories }); // product counts
  };
  return {
    create: useMutation({
      mutationFn: async (body: ProductCreateInput) => (await api.post<ProductDto>('/products', body)).data,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: string; body: ProductUpdateInput }) =>
        (await api.patch<ProductDto>(`/products/${id}`, body)).data,
      onSuccess: refresh,
    }),
    updatePrice: useMutation({
      mutationFn: async ({ id, body }: { id: string; body: ProductPriceInput }) =>
        (await api.patch<ProductDto>(`/products/${id}/price`, body)).data,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/products/${id}`),
      onSuccess: () => refresh(),
    }),
    restore: useMutation({
      mutationFn: async (id: string) => (await api.post<ProductDto>(`/products/${id}/restore`)).data,
      onSuccess: refresh,
    }),
    addImages: useMutation({
      mutationFn: async ({ id, files }: { id: string; files: File[] }) => {
        const form = new FormData();
        files.forEach((f) => form.append('files', f));
        return (await api.upload<ProductDto>(`/products/${id}/images`, form)).data;
      },
      onSuccess: refresh,
    }),
    removeImage: useMutation({
      mutationFn: async ({ id, key }: { id: string; key: string }) =>
        (await api.delete<ProductDto>(`/products/${id}/images/${encodeURIComponent(key)}`)).data,
      onSuccess: refresh,
    }),
    reorderImages: useMutation({
      mutationFn: async ({ id, version, keys: order }: { id: string; version: number; keys: string[] }) =>
        (await api.patch<ProductDto>(`/products/${id}/images`, { version, keys: order })).data,
      onSuccess: refresh,
    }),
    bulkPrice: useMutation({
      mutationFn: async (body: BulkPriceInput) =>
        (await api.post<BulkPriceResult>('/products/bulk-price', body)).data,
      onSuccess: (r) => {
        if (!r.dryRun) refresh();
      },
    }),
  };
}

export async function fetchComboSuggestion(body: ComboSuggestionInput): Promise<ComboSuggestion> {
  return (await api.post<ComboSuggestion>('/products/combos/price-suggestion', body)).data;
}

export async function runImport(file: File, query: Query): Promise<ImportReport> {
  const form = new FormData();
  form.append('file', file);
  return (await api.upload<ImportReport>('/products/import', form, query)).data;
}

// ------------------------------------------------------------------ inventory

export function useLowStock(q: Query) {
  return useQuery({
    queryKey: keys.lowStock(q),
    queryFn: ({ signal }) => api.get<ProductDto[], OffsetPageMeta>('/inventory/low-stock', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useDemand(q: Query) {
  return useQuery({
    queryKey: keys.demand(q),
    queryFn: ({ signal }) => api.get<DemandRow[], OffsetPageMeta>('/inventory/demand', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useBatches(productId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.batches(productId ?? ''),
    queryFn: async () =>
      (
        await api.get<{ id: string; lotNumber: string; qtyRemaining: number; receivedAt: string }[]>(
          '/inventory/batches',
          { productId, onlyAvailable: false },
        )
      ).data,
    enabled: enabled && !!productId,
  });
}

export function useRecordMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: StockMovementInput) =>
      (
        await api.post<{
          productId: string;
          sku: string;
          stockBefore: number;
          stockAfter: number;
          stockVersion: number;
        }>('/inventory/movements', body)
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.inventory });
      void qc.invalidateQueries({ queryKey: keys.products });
    },
  });
}

export async function fetchMovements(q: Query) {
  return api.get<StockMovementDto[], CursorPageMeta>('/inventory/movements', q);
}

export async function fetchLedger(productId: string, q: Query) {
  return api.get<
    {
      product: { id: string; sku: string; name: string; stock: number; stockVersion: number };
      movements: StockMovementDto[];
    },
    CursorPageMeta
  >(`/products/${productId}/stock-ledger`, q);
}
