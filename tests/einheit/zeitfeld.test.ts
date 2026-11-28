/** Reparatur 4: Uhrzeit-Feld lehnt Unmögliches ab, statt still auf 23:59 zu begrenzen (Prüfung 28.11.2026). */
import { describe, expect, it } from 'vitest';
import { zeitLesen } from '../../src/ui/ZeitFeld';

describe('Uhrzeit tippen', () => {
  it('gültige Eingaben wie bisher', () => {
    expect(['730', '17', '0715', '1745', '0', '9', '2359', '000', ''].map(zeitLesen))
      .toEqual(['07:30', '17:00', '07:15', '17:45', '00:00', '09:00', '23:59', '00:00', '']);
  });
  it('«1775» ist keine Uhrzeit (vorher still 17:59)', () => {
    expect(zeitLesen('1775')).toBeNull();
  });
  it('Stunde über 23 oder Minute über 59 → abgelehnt', () => {
    expect(['2400', '25', '799', '1260', '9999'].map(zeitLesen)).toEqual([null, null, null, null, null]);
  });
});
