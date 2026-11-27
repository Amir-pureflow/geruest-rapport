/**
 * Phase 2 — Stunden, Pause, zwei Baustellen, Überstunden. Jedes Beispiel ist von Hand nachgerechnet (Kommentar).
 * Einstellungen wie bei der Gerüst GmbH: Arbeitsbeginn 7:00, Mittag 12–13 (Lücke, nie abgezogen),
 * Pause am Morgen 9:00–9:15 IMMER abgezogen, normaler Arbeitstag 8.4 h = 504 Min.
 *
 * «BEKANNTER FEHLER»-Tests sind mit it.fails markiert: sie beschreiben, wie es richtig wäre, und schlagen heute fehl.
 * Wird der Fehler behoben, wird der Test rot → dann `.fails` entfernen.
 */
import { describe, expect, it } from 'vitest';
import {
  aufteilen, pauseAbziehen, spannenMinuten, spannenOffen, spannenTeilen, standardSpannen, teileAufteilen,
  mittagMinuten, type Spanne, type Znueni,
} from '../../src/lib/zeiten';
import { aufteilenNachBisher, bisherNormal, teileNachBisher } from '../../src/lib/tagesrest';
import { stunden } from '../../src/lib/datum';

const GERUEST_PAUSE: Znueni = { von: 9 * 60, bis: 9 * 60 + 15, immer: true };
const GERUEST_TAG = { beginn: 7 * 60, mittagVon: 12 * 60, mittagBis: 13 * 60 };
const NORMALTAG = 504;
const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Der Tag, wie ihn das Teamgerät vorschlägt, mit eingetragenem Feierabend. */
function geruestTag(feierabend: number): Spanne[] {
  const s = standardSpannen(GERUEST_PAUSE, GERUEST_TAG);
  return s.map((x) => (x.bis === null ? { ...x, bis: feierabend } : x));
}

describe('Ein Tag, eine Person', () => {
  it('7:00–17:00, Pause 9:00–9:15 abgezogen, Mittag 12–13 als Lücke', () => {
    // Vorschlag: 7:00–9:00 | 9:15–12:00 | 13:00–17:00
    // 120 + 165 + 240 = 525 Min. = 8.75 h
    const s = geruestTag(h(17));
    expect(s).toEqual([{ von: 420, bis: 540 }, { von: 555, bis: 720 }, { von: 780, bis: 1020 }]);
    expect(spannenMinuten(s)).toBe(525);
    expect(mittagMinuten(s, GERUEST_TAG)).toBe(0); // der Mittag wird weder gezählt noch abgezogen
    // 525 − 504 = 21 Min. Überstunden
    expect(aufteilen(525, NORMALTAG)).toEqual({ normal_min: 504, ueber_min: 21 });
    expect(stunden(525)).toBe('8.75');
  });

  it('Feierabend 16:15: genau der normale Tag, keine Überstunden', () => {
    // 120 + 165 + 195 (13:00–16:15) = 480 Min. = 8.0 h → unter 8.4 h, alles normal
    expect(aufteilen(spannenMinuten(geruestTag(h(16, 15))), NORMALTAG)).toEqual({ normal_min: 480, ueber_min: 0 });
  });

  it('Team mit 3 Personen, alle 7:00–17:00 → 3 × 8.75 h = 26.25 h', () => {
    // 3 × 525 = 1575 Min. = 26.25 h; davon 3 × 504 = 1512 normal, 3 × 21 = 63 Überstunden
    const proPerson = aufteilen(spannenMinuten(geruestTag(h(17))), NORMALTAG);
    const team = [proPerson, proPerson, proPerson];
    expect(team.reduce((s, x) => s + x.normal_min + x.ueber_min, 0)).toBe(1575);
    expect(team.reduce((s, x) => s + x.normal_min, 0)).toBe(1512);
    expect(team.reduce((s, x) => s + x.ueber_min, 0)).toBe(63);
    expect(stunden(1575)).toBe('26.25');
  });

  it('Minuten bleiben ganzzahlig — keine Kommazahlen-Rundung über viele Tage', () => {
    // 20 Tage × 525 Min. = 10 500 Min. = 175.00 h genau (mit Dezimalstunden 8.75 × 20 ebenfalls, aber 0.1-Werte nicht)
    // Gegenprobe mit 50 Min. (0.8333… h): 30 × 50 = 1500 Min. = 25.00 h, als gerundete Stunden 30 × 0.83 = 24.90 h
    expect(stunden(30 * 50)).toBe('25.0');
  });

  it('Pause «immer»: wer erst um 9:10 beginnt, dem wird nichts abgezogen (die Pause liegt nicht ganz in der Zeit)', () => {
    // 9:10–12:00 = 170 Min., 13:00–17:00 = 240 Min. → 410 Min. Die Pause 9:00–9:15 überschneidet sich nur teilweise.
    // Heute: kein Abzug (410). Ob 5 Min. (9:10–9:15) abgezogen werden müssten, ist eine offene Frage an Amir.
    const s = pauseAbziehen([{ von: h(9, 10), bis: h(12) }, { von: h(13), bis: h(17) }], GERUEST_PAUSE);
    expect(spannenMinuten(s)).toBe(410);
  });

  it('Pause «immer»: wer alles in EINER Zeile 7:00–17:00 einträgt, bekommt die Pause abgezogen, der Mittag zählt aber mit', () => {
    // 7:00–9:00 + 9:15–17:00 = 120 + 465 = 585 Min. = 9.75 h — darin steckt 1 h Mittag (nur ein Hinweis, kein Abzug).
    const s = pauseAbziehen([{ von: h(7), bis: h(17) }], GERUEST_PAUSE);
    expect(spannenMinuten(s)).toBe(585);
    expect(mittagMinuten(s, GERUEST_TAG)).toBe(60);
  });

  it('Nachtarbeit über Mitternacht (22:00–02:00) lässt sich nicht erfassen — gilt als «verkehrt»', () => {
    // 22:00 = 1320, 02:00 = 120 → bis < von. Die App lehnt ab statt 4 h zu zählen. Ob Nachtarbeit vorkommt: Frage an Amir.
    expect(spannenOffen([{ von: h(22), bis: h(2) }])).toBe('verkehrt');
  });
});

describe('Zwei Baustellen am Tag', () => {
  it('Wechsel um 13:00: der Morgen auf A, der Nachmittag auf B — Überstunden gehen an den späteren Teil', () => {
    // Teil A: 7:00–9:00 + 9:15–12:00 = 285 Min.; Teil B: 13:00–17:00 = 240 Min.; zusammen 525
    // Normal füllt sich der Reihe nach: A 285 normal (Rest 504 − 285 = 219), B 219 normal + 21 Über
    const teile = spannenTeilen(geruestTag(h(17)), [h(13)]).map(spannenMinuten);
    expect(teile).toEqual([285, 240]);
    expect(teileAufteilen(teile, NORMALTAG)).toEqual([{ normal_min: 285, ueber_min: 0 }, { normal_min: 219, ueber_min: 21 }]);
  });

  it('Wechsel um 10:00 mitten in einer Zeile: die Zeile wird geteilt, nichts geht verloren', () => {
    // 9:15–12:00 wird zu 9:15–10:00 (45) | 10:00–12:00 (120)
    // A: 120 + 45 = 165; B: 120 + 240 = 360; Summe 525 = wie ohne Wechsel
    const teile = spannenTeilen(geruestTag(h(17)), [h(10)]).map(spannenMinuten);
    expect(teile).toEqual([165, 360]);
    expect(teile[0] + teile[1]).toBe(525);
  });

  it('Zweite Meldung später am Tag: Normaltag zählt über beide Meldungen', () => {
    // Erste Meldung (Morgen, Baustelle A): 285 normal. Zweite Meldung (Nachmittag, B): 240 Min.
    // Rest des Normaltags 504 − 285 = 219 → B = 219 normal + 21 Über
    const bisher = bisherNormal([{ mitarbeiter_id: 'p1', normal_min: 285, meldung: 'm1' }]);
    expect(aufteilenNachBisher(240, NORMALTAG, bisher.get('p1') ?? 0)).toEqual({ normal_min: 219, ueber_min: 21 });
  });

  it('Die erste Meldung wird ersetzt: sie zählt beim Ersetzen nicht doppelt', () => {
    // m1 wird gerade ersetzt (ausser) → bisher 0 → die neue Fassung bekommt den ganzen Normaltag
    const bisher = bisherNormal([{ mitarbeiter_id: 'p1', normal_min: 504, meldung: 'm1' }], new Set(['m1']));
    expect(teileNachBisher([285, 240], NORMALTAG, bisher.get('p1') ?? 0)).toEqual([{ normal_min: 285, ueber_min: 0 }, { normal_min: 219, ueber_min: 21 }]);
  });
});
