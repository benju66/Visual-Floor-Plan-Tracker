// Date helpers — ported verbatim from the prototype.
// Local-time, string-keyed (YYYY-MM-DD) to keep week keys timezone-stable.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function parseDate(str?: string): Date {
  const p = (str || "2026-06-01").split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function fmtMD(d: Date): string {
  return d.getMonth() + 1 + "/" + d.getDate();
}

export function mon(d: Date): string {
  return MONTHS[d.getMonth()];
}

/** Monday of the week containing `d` (week starts Monday). */
export function mondayOf(d: Date): Date {
  const day = d.getDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
}

/** Week-start key (Monday) of the real current week. */
export function todayKey(): string {
  return toKey(mondayOf(new Date()));
}
