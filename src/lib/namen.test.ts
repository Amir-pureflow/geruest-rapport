import { describe, expect, it } from 'vitest';
import { anzeigeName, namePasst } from './namen';

describe('namen', () => {
  it('«(Bsp.)» wird zum Zusatz', () => {
    expect(anzeigeName('Arben Hoxha (Bsp.)')).toEqual({ name: 'Arben Hoxha', beispiel: true });
    expect(anzeigeName('Ismail Vaiti')).toEqual({ name: 'Ismail Vaiti', beispiel: false });
    expect(anzeigeName('  Nuhi Vaiti ')).toEqual({ name: 'Nuhi Vaiti', beispiel: false });
  });
  it('Suche: alle Wörter, ohne Gross/klein und Akzente', () => {
    expect(namePasst('Piotr Zieliński', 'zielin')).toBe(true);
    expect(namePasst('Piotr Zieliński', 'piotr ziel')).toBe(true);
    expect(namePasst('Arben Hoxha (Bsp.)', 'hox')).toBe(true);
    expect(namePasst('Arben Hoxha', 'marco')).toBe(false);
    expect(namePasst('Arben Hoxha', '')).toBe(true);
  });
});
