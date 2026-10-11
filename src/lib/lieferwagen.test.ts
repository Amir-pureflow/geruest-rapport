import { describe, it, expect } from 'vitest';
import { lieferwagenTage, type LieferZeile } from './lieferwagen';

const z = (datum: string, team: string, konto: string): LieferZeile => ({
  datum, team_id: team, team: { bezeichnung: team }, baustelle: { konto_nr: konto, bezeichnung: `Baustelle ${konto}` },
});

describe('lieferwagenTage — pro Team und Tag einmal', () => {
  it('zwei Baustellen am selben Tag = ein Tag, beide Baustellen in einer Zeile', () => {
    const t = lieferwagenTage([z('2026-10-12', 'Team 1', '101'), z('2026-10-12', 'Team 1', '102')], 10000);
    expect(t).toHaveLength(1);
    expect(t[0].betrag_rp).toBe(10000);
    expect(t[0].baustellen).toBe('101 Baustelle 101 · 102 Baustelle 102');
  });
  it('doppelte Meldung derselben Baustelle zählt nicht doppelt', () => {
    const t = lieferwagenTage([z('2026-10-12', 'Team 1', '101'), z('2026-10-12', 'Team 1', '101')], 10000);
    expect(t).toHaveLength(1);
    expect(t[0].baustellen).toBe('101 Baustelle 101');
  });
  it('verschiedene Teams und Tage getrennt, sortiert nach Datum und Team (Team 2 vor Team 10)', () => {
    const t = lieferwagenTage([z('2026-10-13', 'Team 10', '101'), z('2026-10-12', 'Team 10', '101'), z('2026-10-12', 'Team 2', '103')], 8000);
    expect(t.map((x) => `${x.datum} ${x.team}`)).toEqual(['2026-10-12 Team 2', '2026-10-12 Team 10', '2026-10-13 Team 10']);
    expect(t.reduce((s, x) => s + x.betrag_rp, 0)).toBe(24000);
  });
  it('ohne Team oder Baustelle bricht nichts', () => {
    const t = lieferwagenTage([{ datum: '2026-10-12', team_id: null, team: null, baustelle: null }], 10000);
    expect(t).toEqual([{ datum: '2026-10-12', team: 'ohne Team', baustellen: '', betrag_rp: 10000 }]);
  });
});
