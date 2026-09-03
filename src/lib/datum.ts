/** Datumshelfer — Woche beginnt am Montag, alles als ISO-Datum (YYYY-MM-DD). */

export function montag(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(12, 0, 0, 0);
  return x;
}

export function addTage(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

export function ausIso(s: string): Date {
  const [y, m, t] = s.split('-').map(Number);
  return new Date(y, m - 1, t, 12);
}

/** 3.9. */
export function kurz(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Do 3.9.2026 */
export function lang(d: Date): string {
  const tage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return `${tage[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Kalenderwoche nach ISO 8601. */
export function kw(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - tag);
  const jahresStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - jahresStart.getTime()) / 86400000 + 1) / 7);
}

export function stunden(min: number): string {
  return (min / 60).toFixed(1);
}
