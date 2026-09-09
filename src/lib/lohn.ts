/**
 * Lohn-Aggregation für den Export — reine Funktionen, keine Datenbank.
 *
 * Eingabe: Zeiteinträge (eine Zeile pro Person, Tag und Konto), wie sie aus
 * `zeiteintrag` + `tagesmeldung` kommen. Ausgabe: Tabellen für Bildschirm und Excel.
 *
 * Harte Regel (CLAUDE.md #6): Minuten bleiben Integer. Stunden entstehen erst bei der Ausgabe.
 * Anreise (öV, km) zählt pro Person und Tag einmal — der Monteur fährt einmal hin, auch wenn
 * er an dem Tag auf zwei Konten gearbeitet hat.
 */
import { addTage, iso, kw, montag } from './datum';

export interface LohnPerson {
  id: string;
  name: string;
  /** 'intern' | 'extern' | 'temporaer' */
  typ: string;
  temporaerbuero: string | null;
}

export interface LohnEintrag {
  /** ISO-Datum JJJJ-MM-TT */
  datum: string;
  mitarbeiter: LohnPerson;
  normal_min: number;
  ueber_min: number;
  oev: boolean;
  km: number;
  konto_nr: string | null;
}

export interface LohnZeile {
  person: LohnPerson;
  /** Minuten (normal + über) je ISO-Datum */
  proTag: Record<string, number>;
  normal_min: number;
  ueber_min: number;
  total_min: number;
  /** Tage, an denen die Person mit öV angereist ist */
  oevTage: number;
  /** km, pro Tag einmal gezählt */
  km: number;
}

function mussInt(wert: number, name: string): void {
  if (!Number.isInteger(wert)) throw new Error(`${name} muss ganzzahlig sein, erhalten: ${wert}`);
}

function nameSort(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'de');
}

/** Eine Zeile pro Person: Minuten je Tag, Summen, Anreise. Sortiert nach Name. */
export function lohnZeilen(eintraege: LohnEintrag[]): LohnZeile[] {
  const zeilen = new Map<string, LohnZeile>();
  // Anreise pro Person und Tag: öV ja/nein, km = grösster Wert des Tages
  const anreise = new Map<string, Map<string, { oev: boolean; km: number }>>();

  for (const e of eintraege) {
    mussInt(e.normal_min, 'normal_min');
    mussInt(e.ueber_min, 'ueber_min');
    mussInt(e.km, 'km');
    const id = e.mitarbeiter.id;
    const z = zeilen.get(id) ?? { person: e.mitarbeiter, proTag: {}, normal_min: 0, ueber_min: 0, total_min: 0, oevTage: 0, km: 0 };
    const min = e.normal_min + e.ueber_min;
    z.proTag[e.datum] = (z.proTag[e.datum] ?? 0) + min;
    z.normal_min += e.normal_min;
    z.ueber_min += e.ueber_min;
    z.total_min += min;
    zeilen.set(id, z);

    const tage = anreise.get(id) ?? new Map<string, { oev: boolean; km: number }>();
    const t = tage.get(e.datum) ?? { oev: false, km: 0 };
    t.oev = t.oev || e.oev;
    t.km = Math.max(t.km, e.km);
    tage.set(e.datum, t);
    anreise.set(id, tage);
  }

  for (const [id, z] of zeilen) {
    for (const t of anreise.get(id)?.values() ?? []) {
      if (t.oev) z.oevTage += 1;
      z.km += t.km;
    }
  }
  return [...zeilen.values()].sort((a, b) => nameSort(a.person, b.person));
}

/** Sieben Werte Mo–So (Minuten) für eine Lohnzeile. */
export function wochenSpalten(z: LohnZeile, wochenStart: Date): number[] {
  const start = montag(wochenStart);
  return Array.from({ length: 7 }, (_, i) => z.proTag[iso(addTage(start, i))] ?? 0);
}

/** Alle Montage, deren Woche den Monat berührt (Monat 0–11). */
export function wochenImMonat(jahr: number, monat: number): Date[] {
  const erster = new Date(jahr, monat, 1, 12);
  const letzter = new Date(jahr, monat + 1, 0, 12);
  const wochen: Date[] = [];
  for (let m = montag(erster); m <= letzter; m = addTage(m, 7)) wochen.push(m);
  return wochen;
}

/** Erster und letzter Tag des Monats als ISO. */
export function monatsGrenzen(jahr: number, monat: number): { von: string; bis: string } {
  return { von: iso(new Date(jahr, monat, 1, 12)), bis: iso(new Date(jahr, monat + 1, 0, 12)) };
}

/** Minuten je Woche (Summe Mo–So) — für die Monatsansicht, eine Spalte pro KW. */
export function monatsSpalten(z: LohnZeile, wochen: Date[]): number[] {
  return wochen.map((w) => wochenSpalten(z, w).reduce((s, m) => s + m, 0));
}

export interface BueroZeile {
  name: string;
  datum: string;
  konto_nr: string;
  normal_min: number;
  ueber_min: number;
}

export interface BueroBlatt {
  buero: string;
  /** Person × Tag × Konto-Nr., sortiert nach Name, Datum, Konto */
  zeilen: BueroZeile[];
  /** Summe je Person — die Rechnung des Büros muss direkt prüfbar sein */
  personen: { name: string; normal_min: number; ueber_min: number; total_min: number }[];
  total_min: number;
}

/** Je Temporärbüro ein Blatt. Nur Personen mit typ 'temporaer'; ohne Büro → «ohne Büro». */
export function temporaerBueroBlaetter(eintraege: LohnEintrag[]): BueroBlatt[] {
  const bueros = new Map<string, Map<string, BueroZeile>>();
  for (const e of eintraege) {
    if (e.mitarbeiter.typ !== 'temporaer') continue;
    mussInt(e.normal_min, 'normal_min');
    mussInt(e.ueber_min, 'ueber_min');
    const buero = e.mitarbeiter.temporaerbuero?.trim() || 'ohne Büro';
    const konto = e.konto_nr ?? '—';
    const zeilen = bueros.get(buero) ?? new Map<string, BueroZeile>();
    const key = `${e.mitarbeiter.id}|${e.datum}|${konto}`;
    const z = zeilen.get(key) ?? { name: e.mitarbeiter.name, datum: e.datum, konto_nr: konto, normal_min: 0, ueber_min: 0 };
    z.normal_min += e.normal_min;
    z.ueber_min += e.ueber_min;
    zeilen.set(key, z);
    bueros.set(buero, zeilen);
  }
  return [...bueros.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([buero, m]) => {
      const zeilen = [...m.values()].sort((a, b) => nameSort(a, b) || a.datum.localeCompare(b.datum) || a.konto_nr.localeCompare(b.konto_nr));
      const proPerson = new Map<string, { name: string; normal_min: number; ueber_min: number; total_min: number }>();
      for (const z of zeilen) {
        const p = proPerson.get(z.name) ?? { name: z.name, normal_min: 0, ueber_min: 0, total_min: 0 };
        p.normal_min += z.normal_min;
        p.ueber_min += z.ueber_min;
        p.total_min += z.normal_min + z.ueber_min;
        proPerson.set(z.name, p);
      }
      const personen = [...proPerson.values()].sort(nameSort);
      return { buero, zeilen, personen, total_min: personen.reduce((s, p) => s + p.total_min, 0) };
    });
}

export interface UeberstundenZeile {
  person: LohnPerson;
  /** Überstunden-Minuten im gewählten Zeitraum */
  zeitraum_min: number;
  /** Überstunden-Minuten seit Jahresbeginn (inkl. Zeitraum) */
  jahr_min: number;
}

/**
 * Überstunden je Person: Zeitraum und seit Jahresbeginn.
 * `jahr` enthält alle Einträge des Jahres bis zum Ende des Zeitraums (zweite Abfrage).
 * Wer nur im Jahr, aber nicht im Zeitraum vorkommt, erscheint trotzdem (mit 0 im Zeitraum).
 */
export function ueberstunden(zeitraum: LohnEintrag[], jahr: LohnEintrag[]): UeberstundenZeile[] {
  const m = new Map<string, UeberstundenZeile>();
  const zeile = (p: LohnPerson) => {
    const z = m.get(p.id) ?? { person: p, zeitraum_min: 0, jahr_min: 0 };
    m.set(p.id, z);
    return z;
  };
  for (const e of zeitraum) { mussInt(e.ueber_min, 'ueber_min'); zeile(e.mitarbeiter).zeitraum_min += e.ueber_min; }
  for (const e of jahr) { mussInt(e.ueber_min, 'ueber_min'); zeile(e.mitarbeiter).jahr_min += e.ueber_min; }
  return [...m.values()].sort((a, b) => nameSort(a.person, b.person));
}

/** Blattname für Excel: max. 31 Zeichen, ohne die verbotenen Zeichen, eindeutig. */
export function blattName(name: string, vergeben: Set<string>): string {
  const basis = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Blatt';
  let kandidat = basis;
  let n = 2;
  while (vergeben.has(kandidat)) kandidat = `${basis.slice(0, 25)} ${n++}`;
  vergeben.add(kandidat);
  return kandidat;
}

/** Beschriftung eines Zeitraums für Blatt-Titel: «KW 37 · 7.9.–13.9.2026» */
export function wochenTitel(wochenStart: Date): string {
  const s = montag(wochenStart);
  const e = addTage(s, 6);
  return `KW ${kw(s)} · ${s.getDate()}.${s.getMonth() + 1}.–${e.getDate()}.${e.getMonth() + 1}.${e.getFullYear()}`;
}
