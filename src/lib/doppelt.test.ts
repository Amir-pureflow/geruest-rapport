import { describe, it, expect } from 'vitest';
import { arbeitstage, arbeitstagePlus, mitZeiten, ohneReihenfolge, streichen, verschieben } from './doppelt';

// Der Fall von Arbnor (16.11.2026): Schwarzenburg Mo 16.–Di 17.11., danach Liebefeld Mi 18.–Do 19.11.;
// neu für Mo 16.11. die Bienenstrasse.
const schwarzenburg = { id: 's', von: '2026-11-16', bis: '2026-11-17', beginn_min: null };
const liebefeld = { id: 'l', von: '2026-11-18', bis: '2026-11-19', beginn_min: null };
const bienen = { von: '2026-11-16', bis: '2026-11-16' };

describe('Arbeitstage', () => {
  it('zählt Mo–Fr, überspringt Wochenende', () => {
    expect(arbeitstage('2026-11-13', '2026-11-16')).toBe(2); // Fr + Mo
    expect(arbeitstagePlus('2026-11-19', 3)).toBe('2026-11-23'); // Do, Fr, Mo
  });
});

describe('verschieben', () => {
  it('Schwarzenburg rutscht auf Di–Mi, Liebefeld mit auf Do–Fr', () => {
    expect(verschieben(bienen, [schwarzenburg, liebefeld])).toEqual([
      { art: 'aendern', id: 's', von: '2026-11-17', bis: '2026-11-18' },
      { art: 'aendern', id: 'l', von: '2026-11-19', bis: '2026-11-20' },
    ]);
  });

  it('was mit Abstand folgt, bleibt stehen', () => {
    const spaeter = { id: 'x', von: '2026-11-25', bis: '2026-11-26', beginn_min: null };
    expect(verschieben(bienen, [schwarzenburg, spaeter])).toEqual([
      { art: 'aendern', id: 's', von: '2026-11-17', bis: '2026-11-18' },
    ]);
  });

  it('beginnt der bisherige vorher: Teil davor bleibt, Rest kommt danach (über das Wochenende)', () => {
    const lang = { id: 'w', von: '2026-11-16', bis: '2026-11-20', beginn_min: null }; // Mo–Fr
    const neu = { von: '2026-11-18', bis: '2026-11-18' }; // Mi
    expect(verschieben(neu, [lang])).toEqual([
      { art: 'aendern', id: 'w', von: '2026-11-16', bis: '2026-11-17' },
      { art: 'neu', vorlage: 'w', von: '2026-11-19', bis: '2026-11-23' }, // Do, Fr, Mo = 3 Arbeitstage (Mi–Fr)
    ]);
  });
});

describe('streichen', () => {
  it('Mo fällt bei Schwarzenburg weg, Liebefeld bleibt', () => {
    expect(streichen(bienen, [schwarzenburg, liebefeld])).toEqual([
      { art: 'aendern', id: 's', von: '2026-11-17', bis: '2026-11-17' },
    ]);
  });
  it('mitten heraus: Teil davor bleibt, Teil danach wird neu', () => {
    const lang = { id: 'w', von: '2026-11-16', bis: '2026-11-20', beginn_min: null };
    expect(streichen({ von: '2026-11-18', bis: '2026-11-18' }, [lang])).toEqual([
      { art: 'aendern', id: 'w', von: '2026-11-16', bis: '2026-11-17' },
      { art: 'neu', vorlage: 'w', von: '2026-11-19', bis: '2026-11-20' },
    ]);
  });
  it('ganz überdeckt: löschen', () => {
    expect(streichen({ von: '2026-11-16', bis: '2026-11-17' }, [schwarzenburg])).toEqual([{ art: 'loeschen', id: 's' }]);
  });
});

describe('mit Zeiten', () => {
  it('Schwarzenburg bekommt für Mo einen eigenen Abschnitt ab 13:00, Di bleibt wie bisher', () => {
    expect(mitZeiten(bienen, [schwarzenburg, liebefeld], 13 * 60)).toEqual([
      { art: 'aendern', id: 's', von: '2026-11-16', bis: '2026-11-16', beginn_min: 780 },
      { art: 'neu', vorlage: 's', von: '2026-11-17', bis: '2026-11-17' },
    ]);
  });
  it('nur dieser eine Tag: einfach die Beginnzeit setzen', () => {
    const tag = { id: 't', von: '2026-11-16', bis: '2026-11-16', beginn_min: null };
    expect(mitZeiten(bienen, [tag], 780)).toEqual([{ art: 'aendern', id: 't', von: '2026-11-16', bis: '2026-11-16', beginn_min: 780 }]);
  });
});

describe('Teile enden und beginnen auf Arbeitstagen', () => {
  it('Einsatz über das Wochenende, neuer am Montag: Teil davor endet Freitag', () => {
    const lang = { id: 'b', von: '2026-11-02', bis: '2026-11-20', beginn_min: null };
    expect(streichen(bienen, [lang])).toEqual([
      { art: 'aendern', id: 'b', von: '2026-11-02', bis: '2026-11-13' },
      { art: 'neu', vorlage: 'b', von: '2026-11-17', bis: '2026-11-20' },
    ]);
  });
});

describe('ohneReihenfolge', () => {
  it('zwei ohne Zeit oder mit gleicher Zeit = Konflikt, verschiedene Zeiten = gewollt', () => {
    expect(ohneReihenfolge([{ beginn_min: null }])).toBe(false);
    expect(ohneReihenfolge([{ beginn_min: null }, { beginn_min: 420 }])).toBe(true);
    expect(ohneReihenfolge([{ beginn_min: 420 }, { beginn_min: 420 }])).toBe(true);
    expect(ohneReihenfolge([{ beginn_min: 420 }, { beginn_min: 780 }])).toBe(false);
  });
});
