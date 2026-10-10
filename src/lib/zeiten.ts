/**
 * Zeiten von–bis (Feedback Bauführer 20.09.2026): Statt nur «8.4 h» kann das Team «7:00 bis 12:00»
 * eintragen. Alles in Minuten seit Mitternacht als Integer (CLAUDE.md #6).
 *
 * Die App rechnet KEINE Pausen: Wer 7:00–16:00 einträgt, hat 9.0 h — nicht 8.5. Die bezahlte Pause
 * 9:00–9:30 ist freiwillig, der Mittag ist nicht geklärt; darum trägt man den Mittag als Lücke
 * zwischen zwei Zeiten ein (Vormittag, Nachmittag), und die App zählt nur, was dasteht.
 *
 * Znüni (09.10.2026, Amir): Die Pause 9:00–9:30 ist bezahlt und zählt mit. Zahlt der Bauherr sie nicht,
 * zieht man sie auf Knopfdruck ab — Teamgerät oder Bauführer: der Vormittag wird geteilt (7:00–9:00 und
 * 9:30–12:00), darum bis zu drei Spannen. Rückgängig = wieder zusammenfügen. Nie automatisch.
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
/** Znüni 9:00–9:30 — bezahlt, zählt mit. Abgezogen wird sie nur auf Knopfdruck, wenn der Bauherr sie nicht zahlt. */
export const ZNUENI_VON_MIN = 9 * 60;
export const ZNUENI_BIS_MIN = 9 * 60 + 30;
/** Vormittag, nach der Pause, Nachmittag (Migration 0029) — die dritte Spanne gibt es nur wegen des Znüni-Abzugs. */
export const MAX_SPANNEN = 3;

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

/**
 * Ist eine Zeile nicht fertig? `fehlt` = eine Zeile ohne «bis» (z. B. Nachmittag 13:00 – leer), `verkehrt` = «bis» vor «von».
 * Vor dem Speichern nachfragen statt die Zeile still mit 0 zu zählen (10.10.2026: Nachmittag ohne «bis» ergab 5 h statt 9 h).
 */
export function spannenOffen(spannen: Spanne[]): 'fehlt' | 'verkehrt' | null {
  if (spannen.some((s) => s.bis === null)) return 'fehlt';
  if (spannen.some((s) => s.bis !== null && s.bis <= s.von)) return 'verkehrt';
  return null;
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

/** Enthält die Spanne den Znüni 9:00–9:30 ganz, mit Arbeit davor und danach? Nur dann lässt er sich herausschneiden. */
export function umfasstPause(s: Spanne): boolean {
  return spanneVollstaendig(s) && s.von < ZNUENI_VON_MIN && s.bis > ZNUENI_BIS_MIN;
}

const sortiert = (spannen: Spanne[]): Spanne[] => [...spannen].sort((a, b) => a.von - b.von);

/** Lässt sich der Znüni abziehen? Eine Spanne enthält ihn ganz, und für die zusätzliche Zeile ist Platz. */
export function kannPauseAbziehen(spannen: Spanne[]): boolean {
  return spannen.length < MAX_SPANNEN && spannen.some(umfasstPause);
}

/** Ist der Znüni abgezogen? Eine Spanne endet um 9:00 und die nächste beginnt um 9:30. */
export function pauseAbgezogen(spannen: Spanne[]): boolean {
  const s = sortiert(spannen);
  return s.some((x, i) => i > 0 && s[i - 1].bis === ZNUENI_VON_MIN && x.von === ZNUENI_BIS_MIN);
}

/**
 * Znüni abziehen (Bauherr zahlt ihn nicht): die Spanne, die 9:00–9:30 ganz enthält, wird zu «von–9:00» und
 * «9:30–bis». 30 Minuten weniger, sonst nichts. Passt es nicht, kommt die Liste unverändert zurück. Sortiert.
 */
export function pauseAbziehen(spannen: Spanne[]): Spanne[] {
  if (!kannPauseAbziehen(spannen)) return spannen;
  return sortiert(spannen).flatMap((s) =>
    umfasstPause(s) ? [{ von: s.von, bis: ZNUENI_VON_MIN }, { von: ZNUENI_BIS_MIN, bis: s.bis }] : [{ ...s }],
  );
}

/** Znüni wieder zählen: macht genau den Schnitt von `pauseAbziehen` rückgängig (…–9:00 + 9:30–… → eine Spanne). Sonst unverändert. */
export function pauseZaehlen(spannen: Spanne[]): Spanne[] {
  if (!pauseAbgezogen(spannen)) return spannen;
  const s = sortiert(spannen);
  const i = s.findIndex((x, j) => j > 0 && s[j - 1].bis === ZNUENI_VON_MIN && x.von === ZNUENI_BIS_MIN);
  return [...s.slice(0, i - 1).map((x) => ({ ...x })), { von: s[i - 1].von, bis: s[i].bis }, ...s.slice(i + 1).map((x) => ({ ...x }))];
}

/**
 * Gesamtminuten in Normal (bis zum normalen Arbeitstag der Firma, Standard 8.4 h) und Überstunden aufteilen —
 * wie auf dem Wochenblatt. `normalMin` = `normaltagMin()` aus den Firmen-Einstellungen.
 */
export function aufteilen(total: number, normalMin: number = NORMALTAG_MIN): { normal_min: number; ueber_min: number } {
  const t = Math.max(0, Math.round(total));
  const n = Math.max(0, Math.round(normalMin));
  return { normal_min: Math.min(t, n), ueber_min: Math.max(0, t - n) };
}

/**
 * Gelb markieren (09.10.2026): Überstunden gemeldet UND die Person kommt am Tag auf mindestens `schwelleMin`
 * (Firmen-Einstellung «Gelb markieren ab», Gerüst GmbH 9.0 h). Darunter sieht der Tag aus wie jeder andere —
 * gezählt und bezahlt werden die Überstunden trotzdem ab dem normalen Arbeitstag (`aufteilen`).
 * `schwelleMin` null = wie der normale Arbeitstag: jede Überstunde wird gelb (bisheriges Verhalten).
 */
export function ueberMarkiert(normal_min: number, ueber_min: number, schwelleMin: number | null): boolean {
  return ueber_min > 0 && (schwelleMin === null || normal_min + ueber_min >= schwelleMin);
}

/**
 * Welche Personen sind gelb? Alle Einträge einer Person zählen zusammen (normaler Tag + Zusatzarbeit, mehrere
 * Baustellen) — die Schwelle gilt fürs Tagestotal, nicht für den einzelnen Eintrag. `person` wählt der Aufrufer:
 * die Mitarbeiter-ID für einen Tag, `id|datum` für eine Woche.
 */
export function markiertePersonen(eintraege: { person: string; normal_min: number; ueber_min: number }[], schwelleMin: number | null): Set<string> {
  const summe = new Map<string, { normal: number; ueber: number }>();
  for (const e of eintraege) {
    const s = summe.get(e.person) ?? { normal: 0, ueber: 0 };
    s.normal += e.normal_min;
    s.ueber += e.ueber_min;
    summe.set(e.person, s);
  }
  return new Set([...summe].filter(([, s]) => ueberMarkiert(s.normal, s.ueber, schwelleMin)).map(([person]) => person));
}

/**
 * Spalten des Zeiteintrags (Migration 0016, dritte Spanne 0029). `von3_min`/`bis3_min` sind optional: sie stehen
 * nur da, wenn es eine dritte Spanne gibt — so geht jede gewöhnliche Meldung auch ohne Migration 0029 durch.
 */
export interface ZeitSpalten {
  von_min: number | null;
  bis_min: number | null;
  von2_min: number | null;
  bis2_min: number | null;
  von3_min?: number | null;
  bis3_min?: number | null;
}

/** Spannen → Spalten. Nur vollständige Spannen werden gespeichert; ohne Spannen bleibt alles null. Die dritte nur, wenn es sie gibt. */
export function zuSpalten(spannen: Spanne[]): ZeitSpalten {
  const voll = spannen.filter(spanneVollstaendig).sort((a, b) => a.von - b.von);
  return {
    von_min: voll[0]?.von ?? null,
    bis_min: voll[0]?.bis ?? null,
    von2_min: voll[1]?.von ?? null,
    bis2_min: voll[1]?.bis ?? null,
    ...(voll[2] ? { von3_min: voll[2].von, bis3_min: voll[2].bis } : {}),
  };
}

/** Spalten → Spannen (nur vollständige, sortiert) — für Anzeige und den Znüni-Abzug in der Wochenübersicht. */
export function ausSpalten(z: Partial<ZeitSpalten> | null | undefined): { von: number; bis: number }[] {
  if (!z) return [];
  const paare: [number | null | undefined, number | null | undefined][] = [[z.von_min, z.bis_min], [z.von2_min, z.bis2_min], [z.von3_min, z.bis3_min]];
  return paare
    .filter((p): p is [number, number] => typeof p[0] === 'number' && typeof p[1] === 'number')
    .map(([von, bis]) => ({ von, bis }))
    .sort((a, b) => a.von - b.von);
}

/** Spalten → Text für die Anzeige: «7:00–12:00 · 13:00–17:00», mit Znüni-Abzug «7:00–9:00 · 9:30–12:00 · 13:00–17:00». Ohne Zeiten: null. */
export function zeitenText(z: Partial<ZeitSpalten> | null | undefined): string | null {
  if (!z || z.von_min === null || z.von_min === undefined || z.bis_min === null || z.bis_min === undefined) return null;
  return ausSpalten(z).map((s) => `${uhrzeit(s.von)}–${uhrzeit(s.bis)}`).join(' · ');
}
