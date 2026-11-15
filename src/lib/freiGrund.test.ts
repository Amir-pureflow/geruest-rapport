import { describe, it, expect } from 'vitest';
import { freiGrund, naechsterArbeitstag } from './feiertage';
import { iso } from './datum';

const tag = (s: string) => new Date(s + 'T12:00:00');

describe('freiGrund / naechsterArbeitstag (Startseite am Wochenende, 15.11.2026)', () => {
  it('Samstag und Sonntag sind Wochenende, Werktage nicht', () => {
    expect(freiGrund(tag('2026-11-14'))).toBe('Wochenende');
    expect(freiGrund(tag('2026-11-15'))).toBe('Wochenende');
    expect(freiGrund(tag('2026-11-16'))).toBeNull();
  });
  it('Feiertag hat seinen Namen', () => {
    expect(freiGrund(tag('2026-12-25'))).toBeTruthy();
    expect(freiGrund(tag('2026-12-25'))).not.toBe('Wochenende');
  });
  it('nach dem Wochenende kommt Montag, über Weihnachten wird gesprungen', () => {
    expect(iso(naechsterArbeitstag(tag('2026-11-14')))).toBe('2026-11-16');
    expect(iso(naechsterArbeitstag(tag('2026-11-13')))).toBe('2026-11-16');
    expect(iso(naechsterArbeitstag(tag('2026-12-24')))).toBe('2026-12-28');
  });
});
