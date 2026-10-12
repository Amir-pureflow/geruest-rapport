import { describe, it, expect } from 'vitest';
import { jetztEinspielen, RUHE_MS, SPAETESTENS_MS } from './aktualisierung';

const T0 = Date.parse('2026-10-13T16:00:00');

describe('Neue Fassung — nie mitten in einer Meldung', () => {
  it('ohne offene Eingabe: im Hintergrund und beim Seitenwechsel sofort', () => {
    expect(jetztEinspielen({ anlass: 'hintergrund', eingabe: false, wartetSeit: T0, jetzt: T0 + 1000, letzteEingabe: null })).toBe(true);
    expect(jetztEinspielen({ anlass: 'navigation', eingabe: false, wartetSeit: T0, jetzt: T0 + 1000, letzteEingabe: null })).toBe(true);
  });

  it('angefangene Meldung: weder beim Wechsel in den Hintergrund noch beim Seitenwechsel', () => {
    expect(jetztEinspielen({ anlass: 'hintergrund', eingabe: true, wartetSeit: T0, jetzt: T0 + 60_000, letzteEingabe: T0 + 30_000 })).toBe(false);
    expect(jetztEinspielen({ anlass: 'navigation', eingabe: true, wartetSeit: T0, jetzt: T0 + 60_000, letzteEingabe: T0 + 30_000 })).toBe(false);
  });

  it('liegen gelassen: nach einem halben Tag Warten und Stunden ohne Eingabe doch — aber nur im Hintergrund', () => {
    const jetzt = T0 + SPAETESTENS_MS + 1;
    expect(jetztEinspielen({ anlass: 'hintergrund', eingabe: true, wartetSeit: T0, jetzt, letzteEingabe: jetzt - RUHE_MS })).toBe(true);
    expect(jetztEinspielen({ anlass: 'navigation', eingabe: true, wartetSeit: T0, jetzt, letzteEingabe: jetzt - RUHE_MS })).toBe(false);
    // wer vor fünf Minuten noch getippt hat, verliert nichts — egal wie lange die Fassung wartet
    expect(jetztEinspielen({ anlass: 'hintergrund', eingabe: true, wartetSeit: T0, jetzt, letzteEingabe: jetzt - 5 * 60_000 })).toBe(false);
  });
});
