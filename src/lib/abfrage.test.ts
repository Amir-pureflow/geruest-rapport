import { describe, it, expect } from 'vitest';
import { alle, alleOderFehler, stuecke } from './abfrage';

/** Eine «Tabelle» mit n Zeilen, die wie die API höchstens `max` Zeilen je Antwort liefert. */
function tabelle(n: number, max = 1000) {
  const zeilen = Array.from({ length: n }, (_, i) => ({ id: i }));
  const aufrufe: [number, number][] = [];
  const bau = (von: number, bis: number) => {
    aufrufe.push([von, bis]);
    return Promise.resolve({ data: zeilen.slice(von, Math.min(bis + 1, von + max)), error: null });
  };
  return { bau, aufrufe };
}

describe('alle — seitenweise statt still abgeschnitten', () => {
  it('holt mehr als 1000 Zeilen in Seiten zu 1000', async () => {
    const t = tabelle(2345);
    const z = await alle<{ id: number }>(t.bau);
    expect(z).toHaveLength(2345);
    expect(z[2344].id).toBe(2344);
    expect(t.aufrufe).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('genau 1000 Zeilen: noch eine leere Seite, dann fertig', async () => {
    const t = tabelle(1000);
    expect(await alle(t.bau)).toHaveLength(1000);
    expect(t.aufrufe).toHaveLength(2);
  });

  it('leere Tabelle und kleine Seiten', async () => {
    expect(await alle(tabelle(0).bau)).toEqual([]);
    const t = tabelle(5);
    expect(await alle(t.bau, 2)).toHaveLength(5);
    expect(t.aufrufe).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('ein Fehler auf einer Seite wirft — keine halbe Liste', async () => {
    let n = 0;
    const bau = (von: number) => Promise.resolve(++n === 2 ? { data: null, error: { message: 'Zeitüberschreitung' } } : { data: Array.from({ length: 1000 }, (_, i) => von + i), error: null });
    await expect(alle(bau)).rejects.toThrow('Zeitüberschreitung');
  });
});

describe('alleOderFehler — Fehler als Antwort statt Ausnahme', () => {
  it('gibt die Zeilen oder den Fehler zurück', async () => {
    expect(await alleOderFehler(tabelle(3).bau)).toEqual({ data: [{ id: 0 }, { id: 1 }, { id: 2 }], error: null });
    const kaputt = () => Promise.resolve({ data: null, error: { message: 'relation "x" does not exist' } });
    expect(await alleOderFehler(kaputt)).toEqual({ data: null, error: { message: 'relation "x" does not exist' } });
  });
});

describe('stuecke — lange id-Listen für .in()', () => {
  it('teilt in gleich grosse Stücke, das letzte kleiner', () => {
    expect(stuecke([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(stuecke([], 100)).toEqual([]);
    expect(stuecke(Array.from({ length: 250 }, (_, i) => i)).map((s) => s.length)).toEqual([100, 100, 50]);
  });
});
