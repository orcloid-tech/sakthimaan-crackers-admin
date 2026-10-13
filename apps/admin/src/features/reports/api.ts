import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  financialYearOf,
  type AuditActorOption,
  type AuditDetail,
  type AuditListItem,
  type OffsetPageMeta,
  type ReportKind,
} from '@sakthimaan/shared';
import { api, type Query } from '@/lib/api';

export function useAuditLog(q: Query) {
  return useQuery({
    queryKey: ['audit', 'list', q],
    queryFn: ({ signal }) => api.get<AuditListItem[], OffsetPageMeta>('/audit', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAuditEntry(id: string | null) {
  return useQuery({
    queryKey: ['audit', 'detail', id],
    queryFn: async () => (await api.get<AuditDetail>(`/audit/${id}`)).data,
    enabled: !!id,
  });
}

export function useAuditActors() {
  return useQuery({
    queryKey: ['audit', 'actors'],
    queryFn: async () => (await api.get<AuditActorOption[]>('/audit/actors')).data,
    staleTime: 5 * 60_000,
  });
}

/** One report for a period (whole IST days); the API defaults to the financial year to date. */
export function useReport<T>(kind: ReportKind, range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['reports', kind, range],
    queryFn: async ({ signal }) => (await api.get<T>(`/reports/${kind}`, range, signal)).data,
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------ date ranges (IST)

const IST = 330 * 60_000;
export const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Quick periods. Financial years follow India's April–March year. */
export function rangePresets(): { key: string; label: string; from: string; to: string }[] {
  const today = istToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const fy = financialYearOf(new Date());
  const monthStart = (yy: number, mm: number) => day(new Date(Date.UTC(yy, mm - 1, 1)));
  const monthEnd = (yy: number, mm: number) => day(new Date(Date.UTC(yy, mm, 0)));
  const lastMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    {
      key: 'last7',
      label: 'Last 7 days',
      from: day(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000)),
      to: today,
    },
    { key: 'month', label: 'This month', from: monthStart(y, m), to: today },
    {
      key: 'lastMonth',
      label: 'Last month',
      from: monthStart(lastMonth.y, lastMonth.m),
      to: monthEnd(lastMonth.y, lastMonth.m),
    },
    { key: 'fy', label: `FY ${fy.long}`, from: `${fy.startYear}-04-01`, to: today },
    {
      key: 'lastFy',
      label: `FY ${fy.startYear - 1}-${String(fy.startYear % 100).padStart(2, '0')}`,
      from: `${fy.startYear - 1}-04-01`,
      to: `${fy.startYear}-03-31`,
    },
  ];
}
