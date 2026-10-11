import { describe, it, expect } from 'vitest';
import { bloecke, summeJePerson, werktage, type Abwesenheit } from './abwesenheit';

describe('werktage — Mo–Fr zwischen zwei Daten', () => {
  it('eine Woche Ferien = 5 Tage, Wochenende fällt weg', () => {
    expect(werktage('2026-10-12', '2026-10-18')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  });
  it('über zwei Wochen: 10 Tage', () => {
    expect(werktage('2026-10-12', '2026-10-23')).toHaveLength(10);
  });
  it('ein einzelner Tag, auch ein Samstag allein gibt nichts', () => {
    expect(werktage('2026-10-14', '2026-10-14')).toEqual(['2026-10-14']);
    expect(werktage('2026-10-17', '2026-10-17')).toEqual([]);
  });
  it('bis vor von oder leer → nichts', () => {
    expect(werktage('2026-10-14', '2026-10-13')).toEqual([]);
    expect(werktage('', '2026-10-13')).toEqual([]);
  });
  it('höchstens ein Jahr am Stück', () => {
    expect(werktage('2026-01-01', '2030-12-31').length).toBeLessThanOrEqual(262);
  });
});

const a = (id: string, ma: string, datum: string, art: Abwesenheit['art'] = 'ferien', minuten = 504): Abwesenheit => ({ id, mitarbeiter_id: ma, datum, art, minuten });

describe('bloecke — Tage zu Zeiträumen', () => {
  it('Fr + Mo derselben Art = ein Block über das Wochenende', () => {
    const b = bloecke([a('1', 'p', '2026-10-16'), a('2', 'p', '2026-10-19')]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ von: '2026-10-16', bis: '2026-10-19', tage: 2, minuten: 1008, minutenProTag: 504, ids: ['1', '2'] });
  });
  it('Lücke, andere Art oder andere Person trennt', () => {
    const b = bloecke([a('1', 'p', '2026-10-12'), a('2', 'p', '2026-10-14'), a('3', 'p', '2026-10-15', 'krank'), a('4', 'q', '2026-10-15')]);
    expect(b.map((x) => `${x.mitarbeiter_id} ${x.art} ${x.von}–${x.bis}`)).toEqual([
      'p ferien 2026-10-12–2026-10-12', 'p ferien 2026-10-14–2026-10-14', 'p krank 2026-10-15–2026-10-15', 'q ferien 2026-10-15–2026-10-15',
    ]);
  });
  it('verschiedene Minuten im Block → minutenProTag null, Summe stimmt', () => {
    const b = bloecke([a('1', 'p', '2026-10-12', 'ferien', 504), a('2', 'p', '2026-10-13', 'ferien', 252)]);
    expect(b[0].minutenProTag).toBeNull();
    expect(b[0].minuten).toBe(756);
  });
  it('Reihenfolge der Eingabe egal', () => {
    const b = bloecke([a('2', 'p', '2026-10-13'), a('1', 'p', '2026-10-12')]);
    expect(b).toHaveLength(1);
    expect(b[0].von).toBe('2026-10-12');
  });
});

describe('summeJePerson', () => {
  it('Minuten je Person und Art', () => {
    const s = summeJePerson([a('1', 'p', '2026-10-12'), a('2', 'p', '2026-10-13'), a('3', 'p', '2026-10-14', 'krank', 252), a('4', 'q', '2026-10-12', 'unbezahlt', 0)]);
    expect(s.get('p')?.get('ferien')).toBe(1008);
    expect(s.get('p')?.get('krank')).toBe(252);
    expect(s.get('q')?.get('unbezahlt')).toBe(0);
  });
});
