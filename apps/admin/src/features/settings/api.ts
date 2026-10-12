import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  CityDto,
  cityInputSchema,
  CustomerDto,
  CustomerListItem,
  customerUpdateSchema,
  OffsetPageMeta,
  RuntimeSettingsDto,
  SeasonDto,
  seasonSchema,
  ServiceStateDto,
  SettingsDto,
  settingsUpdateSchema,
  StateUpdateInput,
  TransportPartnerDto,
  transportPartnerInputSchema,
  ZoneDto,
  zoneInputSchema,
} from '@sakthimaan/shared';
import { api, type Query } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Request bodies as sent over the wire (dates as strings, defaults optional). */
export type SettingsUpdateBody = z.input<typeof settingsUpdateSchema>;
export type SeasonBody = z.input<typeof seasonSchema>;
export type ZoneBody = z.input<typeof zoneInputSchema>;
export type CityBody = z.input<typeof cityInputSchema>;
export type PartnerBody = z.input<typeof transportPartnerInputSchema>;
export type CustomerUpdateBody = z.input<typeof customerUpdateSchema>;

export const adminKeys = {
  settings: ['settings'] as const,
  runtime: ['settings', 'runtime'] as const,
  seasons: ['settings', 'seasons'] as const,
  zones: ['shipping', 'zones'] as const,
  states: ['shipping', 'states'] as const,
  cities: (stateCode?: string) => ['shipping', 'cities', stateCode ?? 'all'] as const,
  partners: ['shipping', 'partners'] as const,
  customers: ['customers'] as const,
  customerList: (q: Query) => ['customers', 'list', q] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
};

// ------------------------------------------------------------------ settings

export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: async () => (await api.get<SettingsDto>('/settings')).data,
  });
}

/** Rounding mode, tax defaults and store status: readable by every signed-in user. */
export function useRuntimeSettings() {
  const signedIn = useSession((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: adminKeys.runtime,
    queryFn: async () => (await api.get<RuntimeSettingsDto>('/settings/runtime')).data,
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

export function useSettingsMutations() {
  const qc = useQueryClient();
  const settle = (s: SettingsDto) => {
    qc.setQueryData(adminKeys.settings, s);
    void qc.invalidateQueries({ queryKey: adminKeys.runtime });
    // Rounding changes re-price products; store details show on documents.
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
  return {
    update: useMutation({
      mutationFn: async (body: SettingsUpdateBody) => (await api.patch<SettingsDto>('/settings', body)).data,
      onSuccess: settle,
    }),
    setImage: useMutation({
      mutationFn: async ({ kind, file }: { kind: 'logo' | 'upi-qr'; file: File }) => {
        const form = new FormData();
        form.append('files', file);
        return (await api.upload<SettingsDto>(`/settings/images/${kind}`, form)).data;
      },
      onSuccess: settle,
    }),
    removeImage: useMutation({
      mutationFn: async (kind: 'logo' | 'upi-qr') =>
        (await api.delete<SettingsDto>(`/settings/images/${kind}`)).data,
      onSuccess: settle,
    }),
  };
}

export function useSeasons(enabled = true) {
  return useQuery({
    queryKey: adminKeys.seasons,
    queryFn: async () => (await api.get<SeasonDto[]>('/settings/seasons')).data,
    enabled,
  });
}

export function useSeasonMutations() {
  const qc = useQueryClient();
  const settle = (rows: SeasonDto[]) => {
    qc.setQueryData(adminKeys.seasons, rows);
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    save: useMutation({
      mutationFn: async ({ id, body }: { id: string | null; body: SeasonBody }) =>
        (id
          ? await api.put<SeasonDto[]>(`/settings/seasons/${id}`, body)
          : await api.post<SeasonDto[]>('/settings/seasons', body)
        ).data,
      onSuccess: settle,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete<SeasonDto[]>(`/settings/seasons/${id}`)).data,
      onSuccess: settle,
    }),
  };
}

// ------------------------------------------------------------------ shipping

export function useZones() {
  return useQuery({
    queryKey: adminKeys.zones,
    queryFn: async () => (await api.get<ZoneDto[]>('/shipping/zones')).data,
  });
}

export function useStates() {
  return useQuery({
    queryKey: adminKeys.states,
    queryFn: async () => (await api.get<ServiceStateDto[]>('/shipping/states')).data,
  });
}

export function useCities(stateCode?: string) {
  return useQuery({
    queryKey: adminKeys.cities(stateCode),
    queryFn: async () => (await api.get<CityDto[]>('/shipping/cities', { stateCode })).data,
  });
}

export function usePartners() {
  return useQuery({
    queryKey: adminKeys.partners,
    queryFn: async () => (await api.get<TransportPartnerDto[]>('/shipping/transport-partners')).data,
  });
}

function useRefreshShipping() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['shipping'] });
    void qc.invalidateQueries({ queryKey: ['transport-partners'] }); // dispatch dialog list
    void qc.invalidateQueries({ queryKey: ['orders', 'preview'] });
  };
}

function useSaveMutation<B>(base: string) {
  const refresh = useRefreshShipping();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string | null; body: B }) =>
      id ? api.put(`${base}/${id}`, body) : api.post(base, body),
    onSuccess: refresh,
  });
}

function useRemoveMutation(base: string) {
  const refresh = useRefreshShipping();
  return useMutation({ mutationFn: (id: string) => api.delete(`${base}/${id}`), onSuccess: refresh });
}

export function useShippingMutations() {
  const refresh = useRefreshShipping();
  return {
    saveZone: useSaveMutation<ZoneBody>('/shipping/zones'),
    removeZone: useRemoveMutation('/shipping/zones'),
    updateStates: useMutation({
      mutationFn: (body: StateUpdateInput) => api.patch('/shipping/states', body),
      onSuccess: refresh,
    }),
    saveCity: useSaveMutation<CityBody>('/shipping/cities'),
    removeCity: useRemoveMutation('/shipping/cities'),
    savePartner: useSaveMutation<PartnerBody>('/shipping/transport-partners'),
    removePartner: useRemoveMutation('/shipping/transport-partners'),
  };
}

// ------------------------------------------------------------------ customers

export function useCustomers(q: Query) {
  return useQuery({
    queryKey: adminKeys.customerList(q),
    queryFn: ({ signal }) => api.get<CustomerListItem[], OffsetPageMeta>('/customers', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.customer(id ?? ''),
    queryFn: async () => (await api.get<CustomerDto>(`/customers/${id}`)).data,
    enabled: !!id,
  });
}

export function useCustomerMutations(id: string) {
  const qc = useQueryClient();
  const settle = (c: CustomerDto) => {
    qc.setQueryData(adminKeys.customer(id), c);
    void qc.invalidateQueries({ queryKey: [...adminKeys.customers, 'list'] });
    void qc.invalidateQueries({ queryKey: ['customers', 'lookup'] });
  };
  return {
    update: useMutation({
      mutationFn: async (body: CustomerUpdateBody) =>
        (await api.patch<CustomerDto>(`/customers/${id}`, body)).data,
      onSuccess: settle,
    }),
    block: useMutation({
      mutationFn: async (body: { blocked: boolean; reason?: string }) =>
        (await api.post<CustomerDto>(`/customers/${id}/block`, body)).data,
      onSuccess: settle,
    }),
    credit: useMutation({
      mutationFn: async (body: { creditAllowed: boolean; reason?: string }) =>
        (await api.post<CustomerDto>(`/customers/${id}/credit`, body)).data,
      onSuccess: settle,
    }),
  };
}
