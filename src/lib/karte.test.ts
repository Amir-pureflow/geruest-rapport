import { describe, it, expect } from 'vitest';
import { punktPasst, punkteAm } from './karte';

const B1 = { id: 'b1', konto_nr: '901675', bezeichnung: 'Wohnüberbauung Brünnenpark, Haus B', strasse: 'Brünnenstrasse 120', plz: '3018', ort: 'Bern', lat: 46.94, lon: 7.39 };
const B2 = { id: 'b2', konto_nr: '902583', bezeichnung: 'Fassade Monbijoustrasse 55', strasse: null, plz: null, ort: null, lat: null, lon: null };
const teams = new Map([['t1', { name: 'Team 1', chef: 'Sandro Meier' }], ['t2', { name: 'Team 2', chef: 'Mathieu Rochat' }], ['t10', { name: 'Team 10', chef: null }]]);

describe('punkteAm — ein Punkt je Baustelle', () => {
  it('zwei Teams auf derselben Baustelle: ein Punkt, Leute zusammen; ohne Ort in eigener Liste', () => {
    const r = punkteAm({
      einsaetze: [
        { team_id: 't2', baustelle: B1, soll_leute: 3, beginn_min: null },
        { team_id: 't1', baustelle: B1, soll_leute: 4, beginn_min: 390 },
        { team_id: 't10', baustelle: B2 },
      ],
      teams, leute: new Map([['t1', 3], ['t2', 2], ['t10', 4]]),
    });
    expect(r.mitOrt).toHaveLength(1);
    expect(r.mitOrt[0].leute).toBe(5);
    expect(r.mitOrt[0].teams.map((t) => `${t.team} ${t.leute}/${t.soll}`)).toEqual(['Team 1 3/4', 'Team 2 2/3']);
    expect(r.ohneOrt.map((p) => p.baustelle.id)).toEqual(['b2']);
  });
  it('dasselbe Team zweimal auf derselben Baustelle zählt einmal; inaktive Teams fallen weg', () => {
    const r = punkteAm({ einsaetze: [{ team_id: 't1', baustelle: B1 }, { team_id: 't1', baustelle: B1 }, { team_id: 'tX', baustelle: B1 }], teams, leute: new Map([['t1', 3]]) });
    expect(r.mitOrt[0].teams).toHaveLength(1);
    expect(r.mitOrt[0].leute).toBe(3);
  });
  it('Reihenfolge nach Team, numerisch (Team 2 vor Team 10)', () => {
    const B3 = { ...B1, id: 'b3' };
    const r = punkteAm({ einsaetze: [{ team_id: 't10', baustelle: B3 }, { team_id: 't2', baustelle: B1 }], teams, leute: new Map() });
    expect(r.mitOrt.map((p) => p.teams[0].team)).toEqual(['Team 2', 'Team 10']);
  });
});

describe('punktPasst — Suche auf der Karte', () => {
  const p = { baustelle: B1, teams: [{ teamId: 't1', team: 'Team 1', chef: 'Sandro Meier', leute: 3, soll: 4, beginn_min: null }], leute: 3 };
  it('findet nach Team, Chef, Baustelle, Konto und Ort; alle Wörter müssen passen', () => {
    expect(punktPasst(p, '')).toBe(true);
    expect(punktPasst(p, 'sandro')).toBe(true);
    expect(punktPasst(p, '901675')).toBe(true);
    expect(punktPasst(p, 'brünnen bern')).toBe(true);
    expect(punktPasst(p, 'team 2')).toBe(false);
  });
});
