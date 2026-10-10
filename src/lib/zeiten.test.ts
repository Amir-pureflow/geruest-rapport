import { describe, it, expect } from 'vitest';
import { MAX_SPANNEN, aufteilen, ausSpalten, ausUhrzeit, kannPauseAbziehen, markiertePersonen, mittagMinuten, pauseAbgezogen, pauseAbziehen, pauseZaehlen, spannenMinuten, spannenOffen, spannenUeberlappen, standardSpannen, ueberMarkiert, uhrzeit, uhrzeitFeld, zeitenText, zuSpalten } from './zeiten';
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
  it('Nachmittag ohne «bis» wird nicht still weggelassen, sondern gemeldet (10.10.2026)', () => {
    expect(spannenOffen(standardSpannen())).toBe('fehlt');
    expect(spannenOffen([{ von: 420, bis: 720 }, { von: 780, bis: 1020 }])).toBeNull();
    expect(spannenOffen([{ von: 420, bis: 720 }])).toBeNull();
    expect(spannenOffen([{ von: 420, bis: 720 }, { von: 780, bis: 720 }])).toBe('verkehrt');
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
  it('drei Spannen (Znüni abgezogen, 0029): Spalten 3 nur, wenn es die dritte gibt', () => {
    expect(zuSpalten([{ von: 780, bis: 1020 }, { von: 570, bis: 720 }, { von: 420, bis: 540 }])).toEqual({
      von_min: 420, bis_min: 540, von2_min: 570, bis2_min: 720, von3_min: 780, bis3_min: 1020,
    });
    // ohne dritte Spanne fehlen die Felder ganz — so geht die Meldung auch vor Migration 0029 durch
    expect(zuSpalten(standardSpannen())).not.toHaveProperty('von3_min');
    expect(zuSpalten([{ von: 420, bis: 540 }, { von: 570, bis: 720 }, { von: 780, bis: null }])).not.toHaveProperty('bis3_min');
  });
  it('zeigt drei Spannen und liest sie zurück', () => {
    const z = { von_min: 420, bis_min: 540, von2_min: 570, bis2_min: 720, von3_min: 780, bis3_min: 1020 };
    expect(zeitenText(z)).toBe('7:00–9:00 · 9:30–12:00 · 13:00–17:00');
    expect(ausSpalten(z)).toEqual([{ von: 420, bis: 540 }, { von: 570, bis: 720 }, { von: 780, bis: 1020 }]);
    expect(ausSpalten({ von_min: 420, bis_min: 720, von2_min: 780, bis2_min: 1020 })).toEqual([{ von: 420, bis: 720 }, { von: 780, bis: 1020 }]);
    expect(ausSpalten({ von_min: null, bis_min: null, von2_min: null, bis2_min: null })).toEqual([]);
  });
});

describe('Znüni 9:00–9:30 — abziehen nur auf Knopfdruck, rückgängig machbar', () => {
  const tag = () => [{ von: 420, bis: 720 }, { von: 780, bis: 1020 }];

  it('teilt den Vormittag: 7:00–9:00 und 9:30–12:00, der Nachmittag bleibt', () => {
    expect(pauseAbziehen(tag())).toEqual([{ von: 420, bis: 540 }, { von: 570, bis: 720 }, { von: 780, bis: 1020 }]);
    expect(pauseAbziehen([{ von: 420, bis: 960 }])).toEqual([{ von: 420, bis: 540 }, { von: 570, bis: 960 }]);
    // Nachmittag noch offen — der Vormittag lässt sich trotzdem teilen
    expect(pauseAbziehen(standardSpannen())).toEqual([{ von: 420, bis: 540 }, { von: 570, bis: 720 }, { von: 780, bis: null }]);
  });
  it('das Total sinkt um genau 30 Minuten', () => {
    expect(spannenMinuten(pauseAbziehen(tag()))).toBe(spannenMinuten(tag()) - 30);
    expect(spannenMinuten(pauseAbziehen([{ von: 420, bis: 960 }]))).toBe(540 - 30);
  });
  it('rückgängig: ergibt wieder genau die Zeiten von vorher', () => {
    expect(pauseZaehlen(pauseAbziehen(tag()))).toEqual(tag());
    expect(pauseZaehlen(pauseAbziehen([{ von: 420, bis: 960 }]))).toEqual([{ von: 420, bis: 960 }]);
    expect(spannenMinuten(pauseZaehlen(pauseAbziehen(tag())))).toBe(spannenMinuten(tag()));
  });
  it('erkennt den Zustand', () => {
    expect(kannPauseAbziehen(tag())).toBe(true);
    expect(pauseAbgezogen(tag())).toBe(false);
    const geteilt = pauseAbziehen(tag());
    expect(kannPauseAbziehen(geteilt)).toBe(false);
    expect(pauseAbgezogen(geteilt)).toBe(true);
    // Reihenfolge der Eingabe egal
    expect(pauseAbgezogen([...geteilt].reverse())).toBe(true);
  });
  it('passt nicht → unverändert: Beginn nach 9:00, Ende vor 9:30, schon geteilt', () => {
    const spaet = [{ von: 600, bis: 720 }, { von: 780, bis: 1020 }];
    expect(kannPauseAbziehen(spaet)).toBe(false);
    expect(pauseAbziehen(spaet)).toBe(spaet);
    const frueh = [{ von: 360, bis: 555 }];
    expect(kannPauseAbziehen(frueh)).toBe(false);
    expect(pauseAbziehen(frueh)).toBe(frueh);
    const geteilt = pauseAbziehen(tag());
    expect(pauseAbziehen(geteilt)).toBe(geteilt);
    // genau um 9:00 begonnen oder um 9:30 aufgehört: davor oder danach bliebe nichts übrig
    expect(kannPauseAbziehen([{ von: 540, bis: 720 }])).toBe(false);
    expect(kannPauseAbziehen([{ von: 420, bis: 570 }])).toBe(false);
    // ohne «bis» nichts teilen
    expect(kannPauseAbziehen([{ von: 420, bis: null }])).toBe(false);
  });
  it('wieder zählen ohne Abzug → unverändert; eine andere Lücke wird nie geschlossen', () => {
    const t = tag();
    expect(pauseZaehlen(t)).toBe(t);
    const andereLuecke = [{ von: 420, bis: 540 }, { von: 600, bis: 720 }];
    expect(pauseAbgezogen(andereLuecke)).toBe(false);
    expect(pauseZaehlen(andereLuecke)).toBe(andereLuecke);
  });
  it('höchstens drei Spannen — der Mittag-Hinweis bleibt still', () => {
    expect(pauseAbziehen(tag())).toHaveLength(MAX_SPANNEN);
    expect(mittagMinuten(pauseAbziehen(tag()))).toBe(0);
    expect(spannenUeberlappen(pauseAbziehen(tag()))).toBe(false);
  });
  it('die Aufteilung folgt: 9.0 h → 8.5 h, die Überstunden schrumpfen mit (Normaltag je Firma)', () => {
    expect(aufteilen(spannenMinuten(tag()))).toEqual({ normal_min: 504, ueber_min: 36 });
    expect(aufteilen(spannenMinuten(pauseAbziehen(tag())))).toEqual({ normal_min: 504, ueber_min: 6 });
    expect(aufteilen(spannenMinuten(pauseAbziehen(tag())), 540)).toEqual({ normal_min: 510, ueber_min: 0 });
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
