import { describe, it, expect } from 'vitest';
import { baustellenSuchen, normalisieren, suchRang } from './suche';

const b = (konto_nr: string, bezeichnung: string) => ({ konto_nr, bezeichnung });
const liste = [
  b('903745', 'Archivstrasse 2'),
  b('903538', 'Belp Steinbachstrasse 15'),
  b('903424', 'Bremgarten Stuckishausstr. 12'),
  b('903750', 'Brückenstrasse 15'),
  b('903610', 'Cham, Chollerstrasse 4'),
  b('903611', 'Bern, Chutzenstrasse 30'),
  b('901234', 'Dorfstrasse 9'),
];
const namen = (q: string, max?: number) => baustellenSuchen(liste, q, max).map((x) => x.bezeichnung);

describe('Suche — Anfang zuerst, nicht irgendwo', () => {
  it('«c» findet nur Namen bzw. Wörter, die mit C beginnen — nicht «Archivstrasse»', () => {
    expect(namen('c')).toEqual(['Cham, Chollerstrasse 4', 'Bern, Chutzenstrasse 30']);
  });
  it('«d» bringt «Dorfstrasse», nicht alles mit einem d darin', () => {
    expect(namen('d')).toEqual(['Dorfstrasse 9']);
  });
  it('ab drei Zeichen auch mittendrin — aber nach den Anfangstreffern', () => {
    expect(namen('ch')).toEqual(['Cham, Chollerstrasse 4', 'Bern, Chutzenstrasse 30']); // zwei Zeichen: nur Anfänge, nicht «Archiv»
    expect(namen('strasse')).toEqual(['Archivstrasse 2', 'Belp Steinbachstrasse 15', 'Bern, Chutzenstrasse 30', 'Brückenstrasse 15', 'Cham, Chollerstrasse 4', 'Dorfstrasse 9']);
  });
  it('Umlaute und Gross/klein egal', () => {
    expect(namen('bruck')).toEqual(['Brückenstrasse 15']);
    expect(namen('BRÜCK')).toEqual(['Brückenstrasse 15']);
    expect(normalisieren('Größe Égout')).toBe('grosse egout');
  });
  it('Kontonummer von vorne, ab drei Ziffern auch mittendrin', () => {
    expect(baustellenSuchen(liste, '9037').map((x) => x.konto_nr)).toEqual(['903745', '903750']);
    expect(baustellenSuchen(liste, '424').map((x) => x.konto_nr)).toEqual(['903424']);
  });
  it('Zahl im Namen (Hausnummer) wird als Wortanfang gefunden', () => {
    expect(namen('15')).toEqual(['Belp Steinbachstrasse 15', 'Brückenstrasse 15']);
  });
  it('Anzahl begrenzt, leere Suche = leer', () => {
    expect(namen('b', 2)).toHaveLength(2);
    expect(namen('  ')).toEqual([]);
  });
  it('Rang: Anfang 0, Wortanfang 1, mittendrin 2, sonst null', () => {
    expect(suchRang('Cham, Chollerstrasse', 'cha')).toBe(0);
    expect(suchRang('Bern, Chutzenstrasse', 'chu')).toBe(1);
    expect(suchRang('Archivstrasse', 'chi')).toBe(2);
    expect(suchRang('Archivstrasse', 'c')).toBeNull();
  });
});

describe('Suche — Postleitzahl (13.10.2026)', () => {
  const mitPlz = [
    { konto_nr: '903538', bezeichnung: 'Belp Steinbachstrasse 15', plz: '3123' },
    { konto_nr: '903750', bezeichnung: 'Zollikofen Waldstrasse 6', plz: '3052' },
    { konto_nr: '903052', bezeichnung: 'Aarstrasse 3', plz: null },
  ];
  it('PLZ von vorne findet die Baustelle; die Kontonummer bleibt vorne', () => {
    // «3052» steckt auch in der Kontonummer 903052 (ab 3 Ziffern mittendrin) — die PLZ-Treffer kommen zuerst
    expect(baustellenSuchen(mitPlz, '3052').map((x) => x.konto_nr)).toEqual(['903750', '903052']);
    expect(baustellenSuchen(mitPlz, '312').map((x) => x.konto_nr)).toEqual(['903538']);
    expect(baustellenSuchen(mitPlz, '903').map((x) => x.konto_nr)).toEqual(['903052', '903538', '903750']);
  });
  it('ohne PLZ-Feld (ältere Aufrufer) wie bisher', () => {
    expect(baustellenSuchen([{ konto_nr: '901234', bezeichnung: 'Dorfstrasse 9' }], '3052')).toEqual([]);
  });
});
