import { financialYearOf, type ReportPeriod } from '@sakthimaan/shared';

const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in IST as YYYY-MM-DD. */
export const istToday = (now = new Date()) =>
  new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** A UTC instant → its IST calendar day (YYYY-MM-DD). */
export const istDayOf = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** IST days → UTC instants covering them (start of `from`, end of `to`). */
export function istDayRange(from?: string, to?: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from ?? '1970-01-01'}T00:00:00.000+05:30`),
    end: new Date(`${to ?? istToday()}T23:59:59.999+05:30`),
  };
}

/**
 * The period a report covers. Default: the current financial year (April–March) to
 * date, so "this year" means what the accountant means by it.
 */
export function reportPeriod(
  q: { from?: string; to?: string },
  storeName: string | null,
): ReportPeriod & { start: Date; end: Date } {
  const today = istToday();
  const fy = financialYearOf(new Date());
  const from = q.from ?? `${fy.startYear}-04-01`;
  const to = q.to ?? today;
  const { start, end } = istDayRange(from, to);
  return {
    from,
    to,
    financialYear: financialYearOf(start).long,
    generatedAt: new Date().toISOString(),
    storeName,
    start,
    end,
  };
}

/** Every IST day from `from` to `to` (inclusive), for gap-free daily series. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
