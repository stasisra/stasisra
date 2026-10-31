export const DAY_MS = 86_400_000;
export function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function todayYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
export function calendarDays(start: string | Date, end: string | Date): number {
  const ymd = (d: string | Date) =>
    d instanceof Date ? d.toISOString().slice(0, 10) : d.slice(0, 10);
  return Math.round(
    (utcDate(ymd(end)).getTime() - utcDate(ymd(start)).getTime()) / DAY_MS,
  );
}
