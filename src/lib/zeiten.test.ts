import { describe, it, expect } from 'vitest';
import { aufteilen, ausUhrzeit, markiertePersonen, mittagMinuten, spannenMinuten, spannenUeberlappen, standardSpannen, ueberMarkiert, uhrzeit, uhrzeitFeld, zeitenText, zuSpalten } from './zeiten';
import { NORMALTAG_MIN } from './datum';

describe('Uhrzeit ↔ Minuten', () => {
  it('formatiert für Anzeige und Feld', () => {
    expect(uhrzeit(420)).toBe('7:00');
    expect(uhrzeit(1020)).toBe('17:00');
    expect(uhrzeit(9 * 60 + 5)).toBe('9:05');
    expect(uhrzeitFeld(420)).toBe('07:00');
    expect(uhrzeitFeld(null)).toBe('');
  });
  it('liest das Feld zurück, weist Unsinn ab', () => {
    expect(ausUhrzeit('07:00')).toBe(420);
    expect(ausUhrzeit('7:30')).toBe(450);
    expect(ausUhrzeit('24:00')).toBeNull();
    expect(ausUhrzeit('')).toBeNull();
    expect(ausUhrzeit('abc')).toBeNull();
  });
});

describe('spannenMinuten — keine Pausenrechnung', () => {
  it('7:00–16:00 sind 9.0 h, nicht 8.5', () => {
    expect(spannenMinuten([{ von: 420, bis: 960 }])).toBe(540);
  });
  it('Vormittag + Nachmittag: der Mittag ist eine Lücke, kein Abzug', () => {
    expect(spannenMinuten([{ von: 420, bis: 720 }, { von: 780, bis: 1020 }])).toBe(300 + 240);
  });
  it('unvollständige oder verkehrte Spannen zählen 0', () => {
    expect(spannenMinuten([{ von: 420, bis: null }])).toBe(0);
    expect(spannenMinuten([{ von: 720, bis: 420 }])).toBe(0);
    expect(spannenMinuten([{ von: 420, bis: 420 }])).toBe(0);
  });
  it('erkennt Überschneidungen, egal in welcher Reihenfolge eingetragen', () => {
    expect(spannenUeberlappen([{ von: 420, bis: 720 }, { von: 780, bis: 1020 }])).toBe(false);
    expect(spannenUeberlappen([{ von: 420, bis: 720 }, { von: 720, bis: 1020 }])).toBe(false);
    expect(spannenUeberlappen([{ von: 420, bis: 720 }, { von: 660, bis: 900 }])).toBe(true);
    expect(spannenUeberlappen([{ von: 780, bis: 1020 }, { von: 420, bis: 800 }])).toBe(true);
    expect(spannenUeberlappen([{ von: 420, bis: 720 }, { von: 780, bis: null }])).toBe(false);
  });
});

describe('Mittag 12–13 — Vorgabe als Lücke, nie als Abzug', () => {
  it('Vorgabe: Vormittag 7:00–12:00 fertig, Nachmittag ab 13:00 offen, jedes Mal neue Objekte', () => {
    const a = standardSpannen();
    expect(a).toEqual([{ von: 420, bis: 720 }, { von: 780, bis: null }]);
    expect(spannenMinuten(a)).toBe(300);
    const b = standardSpannen();
    b[0].bis = 700;
    expect(standardSpannen()[0].bis).toBe(720);
  });
  it('zählt, wie viel Mittag in den Zeiten steckt — Hinweis, kein Abzug', () => {
    expect(mittagMinuten(standardSpannen())).toBe(0);
    expect(mittagMinuten([{ von: 420, bis: 1020 }])).toBe(60);
    expect(mittagMinuten([{ von: 420, bis: 750 }])).toBe(30);
    expect(mittagMinuten([{ von: 420, bis: 720 }, { von: 750, bis: 1020 }])).toBe(30);
    expect(mittagMinuten([{ von: 420, bis: null }])).toBe(0);
    // die Stunden bleiben trotzdem, was eingetragen ist
    expect(spannenMinuten([{ von: 420, bis: 1020 }])).toBe(600);
  });
});

describe('aufteilen — Normal bis 8.4 h, Rest Überstunden', () => {
  it('teilt wie das Wochenblatt', () => {
    expect(aufteilen(300)).toEqual({ normal_min: 300, ueber_min: 0 });
    expect(aufteilen(NORMALTAG_MIN)).toEqual({ normal_min: 504, ueber_min: 0 });
    expect(aufteilen(600)).toEqual({ normal_min: 504, ueber_min: 96 });
    expect(aufteilen(0)).toEqual({ normal_min: 0, ueber_min: 0 });
  });
  it('Integer bleiben Integer', () => {
    const a = aufteilen(540);
    expect(Number.isInteger(a.normal_min)).toBe(true);
    expect(Number.isInteger(a.ueber_min)).toBe(true);
  });
});

describe('zuSpalten / zeitenText', () => {
  it('speichert nur vollständige Spannen, sortiert nach Beginn', () => {
    expect(zuSpalten([{ von: 780, bis: 1020 }, { von: 420, bis: 720 }])).toEqual({ von_min: 420, bis_min: 720, von2_min: 780, bis2_min: 1020 });
    expect(zuSpalten([{ von: 420, bis: 720 }, { von: 780, bis: null }])).toEqual({ von_min: 420, bis_min: 720, von2_min: null, bis2_min: null });
    expect(zuSpalten([])).toEqual({ von_min: null, bis_min: null, von2_min: null, bis2_min: null });
  });
  it('zeigt die Zeiten lesbar oder nichts', () => {
    expect(zeitenText({ von_min: 420, bis_min: 720, von2_min: 780, bis2_min: 1020 })).toBe('7:00–12:00 · 13:00–17:00');
    expect(zeitenText({ von_min: 420, bis_min: 960, von2_min: null, bis2_min: null })).toBe('7:00–16:00');
    expect(zeitenText({ von_min: null, bis_min: null, von2_min: null, bis2_min: null })).toBeNull();
    expect(zeitenText(undefined)).toBeNull();
  });
});

describe('aufteilen — normaler Arbeitstag je Firma (08.10.2026)', () => {
  it('8.2 h (492 min): 10 h Arbeit = 8.2 h normal + 1.8 h Überstunden', () => {
    expect(aufteilen(600, 492)).toEqual({ normal_min: 492, ueber_min: 108 });
  });
  it('genau ein normaler Tag hat keine Überstunden, egal wie lang er ist', () => {
    for (const n of [480, 492, 504, 510, 540]) expect(aufteilen(n, n)).toEqual({ normal_min: n, ueber_min: 0 });
  });
  it('ohne Angabe gilt weiter 8.4 h', () => {
    expect(aufteilen(600)).toEqual(aufteilen(600, NORMALTAG_MIN));
  });
});

describe('ueberMarkiert — «Gelb markieren ab» je Firma (09.10.2026)', () => {
  it('Gerüst GmbH ab 9.0 h: 8.4 normal + 0.4 Überstunden = 8.8 h bleibt ruhig', () => {
    expect(ueberMarkiert(504, 24, 540)).toBe(false);
  });
  it('ab 9.0 h Tagestotal wird gelb', () => {
    expect(ueberMarkiert(504, 36, 540)).toBe(true);
    expect(ueberMarkiert(504, 96, 540)).toBe(true);
  });
  it('ohne Überstunden nie gelb, auch über der Schwelle', () => {
    expect(ueberMarkiert(540, 0, 540)).toBe(false);
    expect(ueberMarkiert(600, 0, null)).toBe(false);
  });
  it('null = wie bisher: jede Überstunde wird gelb, auch neben weniger Normalstunden', () => {
    expect(ueberMarkiert(504, 6, null)).toBe(true);
    expect(ueberMarkiert(240, 60, null)).toBe(true);
  });
  it('Schwelle = normaler Arbeitstag: jede Überstunde über 8.4 h wird gelb', () => {
    expect(ueberMarkiert(NORMALTAG_MIN, 6, NORMALTAG_MIN)).toBe(true);
    expect(ueberMarkiert(NORMALTAG_MIN, 24, NORMALTAG_MIN)).toBe(true);
  });
  it('die Überstunden selbst bleiben, wie sie sind — markiert wird nur die Anzeige', () => {
    expect(aufteilen(528)).toEqual({ normal_min: 504, ueber_min: 24 });
    expect(ueberMarkiert(504, 24, 540)).toBe(false);
  });
});

describe('markiertePersonen — die Schwelle gilt fürs Tagestotal der Person', () => {
  it('zählt alle Einträge einer Person zusammen (normaler Tag + Zusatzarbeit)', () => {
    const tag = [
      { person: 'p1', normal_min: 504, ueber_min: 24 },
      { person: 'p1', normal_min: 30, ueber_min: 0 },
      { person: 'p2', normal_min: 504, ueber_min: 24 },
    ];
    expect(markiertePersonen(tag, 540)).toEqual(new Set(['p1']));
  });
  it('ohne Schwelle ist jede Person mit Überstunden gelb', () => {
    const tag = [
      { person: 'p1', normal_min: 504, ueber_min: 24 },
      { person: 'p2', normal_min: 504, ueber_min: 0 },
    ];
    expect(markiertePersonen(tag, null)).toEqual(new Set(['p1']));
  });
  it('Personen ohne Überstunden sind nie gelb', () => {
    expect(markiertePersonen([{ person: 'p1', normal_min: 600, ueber_min: 0 }], 540).size).toBe(0);
    expect(markiertePersonen([], 540).size).toBe(0);
  });
});
