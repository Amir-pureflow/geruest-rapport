import { describe, it, expect } from 'vitest';
import { gemerkt, merken, merkerLeeren } from './merker';

describe('merker — Seiten-Zwischenspeicher', () => {
  it('merkt sich je Schlüssel und liefert dasselbe zurück', () => {
    merkerLeeren();
    expect(gemerkt('a')).toBeUndefined();
    merken('a', [1, 2]);
    expect(gemerkt<number[]>('a')).toEqual([1, 2]);
    merken('a', [3]);
    expect(gemerkt<number[]>('a')).toEqual([3]);
    merkerLeeren();
    expect(gemerkt('a')).toBeUndefined();
  });
});
