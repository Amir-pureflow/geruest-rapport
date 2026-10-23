import { describe, it, expect } from 'vitest';
import { feiertag, feiertageBern, istArbeitstag, ostersonntag } from './feiertage';
import { iso } from './datum';

describe('ostersonntag', () => {
  it('bekannte Jahre', () => {
    expect(iso(ostersonntag(2026))).toBe('2026-04-05');
    expect(iso(ostersonntag(2027))).toBe('2027-03-28');
    expect(iso(ostersonntag(2028))).toBe('2028-04-16');
    expect(iso(ostersonntag(2019))).toBe('2019-04-21');
  });
});

describe('feiertageBern', () => {
  it('2026: neun Tage, bewegliche aus Ostern', () => {
    const m = feiertageBern(2026);
    expect(m.size).toBe(9);
    expect(m.get('2026-04-03')).toBe('Karfreitag');
    expect(m.get('2026-04-06')).toBe('Ostermontag');
    expect(m.get('2026-05-14')).toBe('Auffahrt');
    expect(m.get('2026-05-25')).toBe('Pfingstmontag');
    expect(m.get('2026-08-01')).toBe('Bundesfeier');
    expect(m.get('2026-12-25')).toBe('Weihnachten');
    expect(m.get('2026-12-26')).toBe('Stephanstag');
  });
  it('2027: Neujahr und Berchtoldstag, Karfreitag im März', () => {
    expect(feiertag('2027-01-01')).toBe('Neujahr');
    expect(feiertag('2027-01-02')).toBe('Berchtoldstag');
    expect(feiertag('2027-03-26')).toBe('Karfreitag');
    expect(feiertag('2027-05-06')).toBe('Auffahrt');
  });
  it('gewöhnlicher Tag: null', () => expect(feiertag('2026-10-27')).toBeNull());
});

describe('istArbeitstag', () => {
  it('Werktag ja, Wochenende und Feiertag nein', () => {
    expect(istArbeitstag('2026-10-27')).toBe(true);
    expect(istArbeitstag('2026-10-31')).toBe(false); // Samstag
    expect(istArbeitstag('2026-12-25')).toBe(false); // Weihnachten, Freitag
    expect(istArbeitstag('2026-12-28')).toBe(true);
  });
});
