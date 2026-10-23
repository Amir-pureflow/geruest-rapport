/**
 * Feiertage im Kanton Bern (24.10.2026): Planung und «nächster Arbeitstag» kannten nur Samstag und Sonntag — der Pilot
 * im Dezember trifft Weihnachten und Neujahr. An einem Feiertag gibt es keine Planungskonflikte, er ist nicht «der nächste
 * Arbeitstag» und zählt nicht als Arbeitstag eines Einsatzes.
 *
 * Abwesenheiten bleiben davon unberührt (`werktage()` in abwesenheit.ts): dort trägt das Büro «Feiertag für alle»
 * bewusst als bezahlten Tag ein.
 *
 * Bern: Neujahr, Berchtoldstag, Karfreitag, Ostermontag, Auffahrt, Pfingstmontag, Bundesfeier, Weihnachten, Stephanstag.
 */
import { addTage, ausIso, iso } from './datum';

/** Ostersonntag nach der gregorianischen Osterformel (anonymer Algorithmus). */
export function ostersonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, monat - 1, tag, 12);
}

const cache = new Map<number, Map<string, string>>();

/** Alle Feiertage eines Jahres im Kanton Bern: ISO-Datum → Name. */
export function feiertageBern(jahr: number): Map<string, string> {
  const da = cache.get(jahr);
  if (da) return da;
  const ostern = ostersonntag(jahr);
  const fest = (monat: number, tag: number) => iso(new Date(jahr, monat - 1, tag, 12));
  const m = new Map<string, string>([
    [fest(1, 1), 'Neujahr'],
    [fest(1, 2), 'Berchtoldstag'],
    [iso(addTage(ostern, -2)), 'Karfreitag'],
    [iso(addTage(ostern, 1)), 'Ostermontag'],
    [iso(addTage(ostern, 39)), 'Auffahrt'],
    [iso(addTage(ostern, 50)), 'Pfingstmontag'],
    [fest(8, 1), 'Bundesfeier'],
    [fest(12, 25), 'Weihnachten'],
    [fest(12, 26), 'Stephanstag'],
  ]);
  cache.set(jahr, m);
  return m;
}

/** Name des Feiertags an diesem Tag, sonst null. */
export function feiertag(isoDatum: string): string | null {
  return feiertageBern(Number(isoDatum.slice(0, 4))).get(isoDatum) ?? null;
}

/** Montag bis Freitag und kein Feiertag. */
export function istArbeitstag(d: Date | string): boolean {
  const tag = typeof d === 'string' ? ausIso(d) : d;
  const wt = tag.getDay();
  return wt !== 0 && wt !== 6 && !feiertag(iso(tag));
}
