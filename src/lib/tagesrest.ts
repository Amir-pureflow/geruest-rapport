/**
 * Normal und Überstunden über den ganzen Tag (13.10.2026).
 *
 * Bis jetzt teilte jede Meldung für sich: die ersten 8.4 h normal, der Rest Überstunden. Eine zweite Meldung am selben
 * Tag («Zusätzlich speichern», oder ein Gast, den zwei Teams melden) begann wieder bei null — 8.4 h + 2 h ergaben
 * 10.4 h normal und keine Minute Überstunden. Lohn und Bauführer sahen etwas anderes, als gearbeitet wurde.
 *
 * Jetzt zählt, was die Person an dem Tag schon normal hat (auf dem Server und noch auf dem Gerät): vom normalen Tag
 * bleibt nur der Rest, alles darüber sind Überstunden. Die App rechnet dabei nichts weg (Regel #10) — sie verteilt nur
 * dieselben Minuten anders auf die beiden Spalten.
 */
import { aufteilen, teileAufteilen } from './zeiten';

/** Eine Zeile, die schon gemeldet ist: Person, ihre Normalminuten, und zu welcher Meldung sie gehört. */
export interface BisherZeile {
  mitarbeiter_id: string;
  normal_min: number;
  /** Schlüssel der Meldung (client_uuid auf dem Gerät, id auf dem Server) — damit sich ersetzte Meldungen ausnehmen lassen */
  meldung: string;
}

/** Normalminuten je Person, ohne die Meldungen in `ausser` (die gerade ersetzt oder überschrieben werden). */
export function bisherNormal(zeilen: BisherZeile[], ausser: ReadonlySet<string> = new Set()): Map<string, number> {
  const m = new Map<string, number>();
  for (const z of zeilen) {
    if (ausser.has(z.meldung)) continue;
    m.set(z.mitarbeiter_id, (m.get(z.mitarbeiter_id) ?? 0) + Math.max(0, z.normal_min));
  }
  return m;
}

/** Was vom normalen Tag noch übrig ist. */
export function restNormal(normaltag: number, bisher: number): number {
  return Math.max(0, Math.round(normaltag) - Math.max(0, Math.round(bisher)));
}

/** Eine Meldung: `total` Minuten, aufgeteilt mit dem, was vom normalen Tag noch übrig ist. */
export function aufteilenNachBisher(total: number, normaltag: number, bisher: number): { normal_min: number; ueber_min: number } {
  return aufteilen(total, restNormal(normaltag, bisher));
}

/** Zwei Baustellen in einem Durchgang: wie `teileAufteilen`, aber ebenfalls nur mit dem Rest des normalen Tags. */
export function teileNachBisher(minuten: number[], normaltag: number, bisher: number): { normal_min: number; ueber_min: number }[] {
  return teileAufteilen(minuten, restNormal(normaltag, bisher));
}
