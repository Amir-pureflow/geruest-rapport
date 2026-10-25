/**
 * Abwesenheiten (Migration 0036, Arbnor 10.10.2026): Das Sekretariat trägt Ferien, Krankheit, Unfall, Todesfall usw.
 * je Mitarbeiter ein — mit Wirkung auf Stunden und Lohn. Ein Abwesenheitstag zählt den normalen Arbeitstag der Firma
 * (Einstellungen, z. B. 8.4 h), anpassbar je Eintrag (halber Tag, unbezahlt = 0).
 *
 * Reine Funktionen, keine Datenbank. Minuten bleiben Integer (CLAUDE.md #6).
 */
import { addTage, ausIso, iso } from './datum';

export type AbwesenheitArt = 'ferien' | 'krank' | 'unfall' | 'militaer' | 'feiertag' | 'todesfall' | 'freitag' | 'unbezahlt';

export const ARTEN: { wert: AbwesenheitArt; text: string; hinweis?: string; bezahlt: boolean }[] = [
  { wert: 'ferien', text: 'Ferien', bezahlt: true },
  { wert: 'krank', text: 'Krank', bezahlt: true },
  { wert: 'unfall', text: 'Unfall', bezahlt: true },
  { wert: 'militaer', text: 'Militär / ZS', hinweis: 'Militär, Zivilschutz, Zivildienst', bezahlt: true },
  { wert: 'feiertag', text: 'Feiertag', bezahlt: true },
  { wert: 'todesfall', text: 'Todesfall', hinweis: 'Todesfall in der Familie', bezahlt: true },
  { wert: 'freitag', text: 'Freier Tag', hinweis: 'Hochzeit, Geburt, Umzug — bezahlt', bezahlt: true },
  { wert: 'unbezahlt', text: 'Unbezahlt', hinweis: 'Unbezahlter Urlaub — zählt 0 h', bezahlt: false },
];

export function artText(art: string): string {
  // «fehlt» ist keine Abwesenheit, sondern die Meldung des Teams (0053) — bis das Büro sie erledigt
  if (art === 'fehlt') return 'Fehlt gemeldet';
  return ARTEN.find((a) => a.wert === art)?.text ?? art;
}

/** Eine Zeile der Tabelle `abwesenheit`. */
export interface Abwesenheit {
  id: string;
  mitarbeiter_id: string;
  datum: string;
  art: AbwesenheitArt;
  minuten: number;
}

/** Höchstens ein Jahr am Stück — mehr ist ein Tippfehler im Datum. */
export const MAX_TAGE = 366;

/**
 * Die Arbeitstage Mo–Fr von–bis (ISO, beide inklusive). Samstag und Sonntag fallen weg — wer am Samstag arbeitet,
 * meldet ihn ja. Leer, wenn bis vor von liegt; höchstens MAX_TAGE Kalendertage.
 */
export function werktage(von: string, bis: string): string[] {
  if (!von || !bis || bis < von) return [];
  const out: string[] = [];
  let d = ausIso(von);
  for (let i = 0; i < MAX_TAGE && iso(d) <= bis; i++, d = addTage(d, 1)) {
    const wt = d.getDay();
    if (wt !== 0 && wt !== 6) out.push(iso(d));
  }
  return out;
}

/** Nächster Werktag nach `datum` (Fr → Mo). */
function naechsterWerktag(datum: string): string {
  let d = addTage(ausIso(datum), 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addTage(d, 1);
  return iso(d);
}

export interface Block {
  mitarbeiter_id: string;
  art: AbwesenheitArt;
  von: string;
  bis: string;
  /** Minuten pro Tag, falls alle Tage gleich; sonst null */
  minutenProTag: number | null;
  tage: number;
  minuten: number;
  ids: string[];
}

/**
 * Aufeinanderfolgende Tage derselben Person und Art zu einem Block zusammenfassen («Ferien 13.–24.10.»), über das
 * Wochenende hinweg. Für die Liste in der Verwaltung: ein Eintrag statt zehn Zeilen. Sortiert nach Beginn, dann Person.
 */
export function bloecke(liste: Abwesenheit[]): Block[] {
  const sortiert = [...liste].sort((a, b) => a.mitarbeiter_id.localeCompare(b.mitarbeiter_id) || a.datum.localeCompare(b.datum));
  const out: Block[] = [];
  for (const a of sortiert) {
    const letzter = out[out.length - 1];
    if (letzter && letzter.mitarbeiter_id === a.mitarbeiter_id && letzter.art === a.art && naechsterWerktag(letzter.bis) === a.datum) {
      letzter.bis = a.datum;
      letzter.tage += 1;
      letzter.minuten += a.minuten;
      if (letzter.minutenProTag !== a.minuten) letzter.minutenProTag = null;
      letzter.ids.push(a.id);
    } else {
      out.push({ mitarbeiter_id: a.mitarbeiter_id, art: a.art, von: a.datum, bis: a.datum, minutenProTag: a.minuten, tage: 1, minuten: a.minuten, ids: [a.id] });
    }
  }
  return out.sort((a, b) => a.von.localeCompare(b.von) || a.mitarbeiter_id.localeCompare(b.mitarbeiter_id));
}

/** Minuten je Person und Art — für das Lohnblatt. */
export function summeJePerson(liste: Abwesenheit[]): Map<string, Map<AbwesenheitArt, number>> {
  const m = new Map<string, Map<AbwesenheitArt, number>>();
  for (const a of liste) {
    const je = m.get(a.mitarbeiter_id) ?? new Map<AbwesenheitArt, number>();
    je.set(a.art, (je.get(a.art) ?? 0) + a.minuten);
    m.set(a.mitarbeiter_id, je);
  }
  return m;
}
