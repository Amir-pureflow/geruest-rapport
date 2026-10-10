import { beforeEach, describe, expect, it } from 'vitest';
import { vorratLeeren, vorratLesen, vorratSchreiben } from './vorrat';

/** Kleiner Ersatz für localStorage (die Tests laufen ohne Browser). */
function speicher() {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe('vorrat', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: ReturnType<typeof speicher> }).localStorage = speicher();
  });

  it('merkt sich, was mit Netz geladen wurde', () => {
    vorratSchreiben('team:1', { personen: [{ id: 'a', name: 'Nuhi' }] });
    expect(vorratLesen<{ personen: { name: string }[] }>('team:1')?.personen[0].name).toBe('Nuhi');
  });

  it('gibt null, wenn nichts da ist', () => {
    expect(vorratLesen('teams')).toBeNull();
  });

  it('löscht beim Abmelden nur den Vorrat, nicht die übrigen Einstellungen', () => {
    vorratSchreiben('teams', [1, 2]);
    vorratSchreiben('team:1', {});
    localStorage.setItem('rapporto-team', 'x');
    vorratLeeren();
    expect(vorratLesen('teams')).toBeNull();
    expect(vorratLesen('team:1')).toBeNull();
    expect(localStorage.getItem('rapporto-team')).toBe('x');
  });
});
