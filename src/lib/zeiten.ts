/**
 * Zeiten von–bis (Feedback Bauführer 20.09.2026): Statt nur «8.4 h» kann das Team «7:00 bis 12:00»
 * eintragen. Alles in Minuten seit Mitternacht als Integer (CLAUDE.md #6).
 *
 * Die App rechnet KEINE Pausen: Wer 7:00–16:00 einträgt, hat 9.0 h — nicht 8.5. Die bezahlte Pause
 * 9:00–9:30 ist freiwillig, der Mittag ist nicht geklärt; darum trägt man den Mittag als Lücke
 * zwischen zwei Zeiten ein (Vormittag, Nachmittag), und die App zählt nur, was dasteht.
 */
import { NORMALTAG_MIN } from './datum';

/** Eine Zeitspanne am Tag. `bis` ist null, solange sie noch nicht fertig eingetragen ist. */
export interface Spanne {
  von: number;
  bis: number | null;
}

/** Arbeitsbeginn laut Bauführer («7:00 bis 17:00 normale Arbeitszeit»). */
export const ARBEITSBEGINN_MIN = 7 * 60;
/** Mittag 12:00–13:00, unbezahlt (Amir, 20.09. — «denke ich», mit Arbnor bestätigen). Die App zieht ihn NICHT ab, sie schlägt ihn als Lücke vor. */
export const MITTAG_VON_MIN = 12 * 60;
export const MITTAG_BIS_MIN = 13 * 60;
/** Vorgabe für die zweite Zeit (Nachmittag): 13:00, Ende offen. */
export const NACHMITTAG_MIN = MITTAG_BIS_MIN;
export const MAX_SPANNEN = 2;

/** Vorgabe beim Umschalten auf von–bis: Vormittag 7:00–12:00 fertig, Nachmittag ab 13:00 mit offenem Ende — das «bis» muss das Team eintragen. Immer frische Objekte. */
export function standardSpannen(): Spanne[] {
  return [{ von: ARBEITSBEGINN_MIN, bis: MITTAG_VON_MIN }, { von: NACHMITTAG_MIN, bis: null }];
}

/** Wie viele Minuten der (unbezahlten) Mittagspause 12–13 in den eingetragenen Zeiten mitgezählt sind — 0, wenn der Mittag die Lücke ist. Nur Hinweis, kein Abzug. */
export function mittagMinuten(spannen: Spanne[]): number {
  return spannen.reduce((s, x) => (spanneVollstaendig(x) ? s + Math.max(0, Math.min(x.bis, MITTAG_BIS_MIN) - Math.max(x.von, MITTAG_VON_MIN)) : s), 0);
}

/** 420 → «7:00», 1020 → «17:00». Für Anzeige. */
export function uhrzeit(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** 420 → «07:00» — das Format, das <input type="time"> erwartet. */
export function uhrzeitFeld(min: number | null): string {
  if (min === null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** «07:00» → 420. Ungültiges → null. */
export function ausUhrzeit(text: string): number | null {
  const t = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!t) return null;
  const h = Number(t[1]);
  const m = Number(t[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Ist die Spanne vollständig und sinnvoll (Ende nach Anfang)? */
export function spanneVollstaendig(s: Spanne): s is { von: number; bis: number } {
  return s.bis !== null && s.bis > s.von;
}

/** Summe der vollständigen Spannen in Minuten — ohne Abzug, ohne Zuschlag. Unvollständige zählen 0. */
export function spannenMinuten(spannen: Spanne[]): number {
  return spannen.reduce((s, x) => s + (spanneVollstaendig(x) ? x.bis - x.von : 0), 0);
}

/** Überschneiden sich zwei vollständige Spannen (z. B. 7:00–12:00 und 11:00–15:00)? Die Datenbank lehnt das ab (0016) — vorher fragen. */
export function spannenUeberlappen(spannen: Spanne[]): boolean {
  const voll = spannen.filter(spanneVollstaendig).sort((a, b) => a.von - b.von);
  for (let i = 1; i < voll.length; i++) if (voll[i].von < voll[i - 1].bis) return true;
  return false;
}

/** Gesamtminuten in Normal (bis 8.4 h) und Überstunden aufteilen — wie auf dem Wochenblatt. */
export function aufteilen(total: number): { normal_min: number; ueber_min: number } {
  const t = Math.max(0, Math.round(total));
  return { normal_min: Math.min(t, NORMALTAG_MIN), ueber_min: Math.max(0, t - NORMALTAG_MIN) };
}

/** Spalten des Zeiteintrags (Migration 0016). */
export interface ZeitSpalten {
  von_min: number | null;
  bis_min: number | null;
  von2_min: number | null;
  bis2_min: number | null;
}

/** Spannen → Spalten. Nur vollständige Spannen werden gespeichert; ohne Spannen bleibt alles null. */
export function zuSpalten(spannen: Spanne[]): ZeitSpalten {
  const voll = spannen.filter(spanneVollstaendig).sort((a, b) => a.von - b.von);
  return {
    von_min: voll[0]?.von ?? null,
    bis_min: voll[0]?.bis ?? null,
    von2_min: voll[1]?.von ?? null,
    bis2_min: voll[1]?.bis ?? null,
  };
}

/** Spalten → Text für die Anzeige: «7:00–12:00 · 13:00–17:00». Ohne Zeiten: null. */
export function zeitenText(z: Partial<ZeitSpalten> | null | undefined): string | null {
  if (!z || z.von_min === null || z.von_min === undefined || z.bis_min === null || z.bis_min === undefined) return null;
  const teile = [`${uhrzeit(z.von_min)}–${uhrzeit(z.bis_min)}`];
  if (z.von2_min !== null && z.von2_min !== undefined && z.bis2_min !== null && z.bis2_min !== undefined) {
    teile.push(`${uhrzeit(z.von2_min)}–${uhrzeit(z.bis2_min)}`);
  }
  return teile.join(' · ');
}
