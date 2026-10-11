import { describe, expect, it } from 'vitest';
import { arbeitstage, ausschnitt, besetzung, einteilungenBuendeln, istBalken, naechsterTeamName, ohneTag, planAm, planIst, spuren, tageZwischen, ueberschneiden, zeitraumVorschlag, type VerlaufZeile } from './planung';
import { ausIso } from './datum';

describe('planung', () => {
  it('zählt Tage über die Sommerzeit hinweg ganz', () => {
    expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
    expect(tageZwischen('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('schneidet Einsätze auf das sichtbare Fenster zu', () => {
    // Fenster Mo 5.10. bis So 11.10.
    expect(ausschnitt({ von: '2026-10-06', bis: '2026-10-08' }, '2026-10-05', 7)).toEqual({ ab: 1, bis: 3, links: false, rechts: false });
    expect(ausschnitt({ von: '2026-09-28', bis: '2026-10-20' }, '2026-10-05', 7)).toEqual({ ab: 0, bis: 6, links: true, rechts: true });
    expect(ausschnitt({ von: '2026-10-12', bis: '2026-10-14' }, '2026-10-05', 7)).toBeNull();
    expect(ausschnitt({ von: '2026-09-01', bis: '2026-10-04' }, '2026-10-05', 7)).toBeNull();
  });

  it('legt Überschneidungen in eigene Spuren, sonst bleibt alles in Spur 0', () => {
    const r = spuren(
      [
        { id: 'a', von: '2026-10-05', bis: '2026-10-07' },
        { id: 'b', von: '2026-10-08', bis: '2026-10-09' },
        { id: 'c', von: '2026-10-07', bis: '2026-10-07' },
      ],
      '2026-10-05',
      7,
    );
    const spurVon = Object.fromEntries(r.map((x) => [x.plan.id, x.spur]));
    expect(spurVon).toEqual({ a: 0, c: 1, b: 0 });
  });

  it('schlägt Zeiträume bis Freitag vor', () => {
    const di = ausIso('2026-10-06');
    expect(zeitraumVorschlag('tag', di)).toEqual({ von: '2026-10-06', bis: '2026-10-06' });
    expect(zeitraumVorschlag('woche', di)).toEqual({ von: '2026-10-06', bis: '2026-10-09' });
    expect(zeitraumVorschlag('zwei', di)).toEqual({ von: '2026-10-06', bis: '2026-10-16' });
    expect(zeitraumVorschlag('vier', di)).toEqual({ von: '2026-10-06', bis: '2026-10-30' });
    // Samstag: «bis Freitag» wäre rückwärts — dann nur der Tag selbst
    expect(zeitraumVorschlag('woche', ausIso('2026-10-10'))).toEqual({ von: '2026-10-10', bis: '2026-10-10' });
  });

  it('zählt nur Montag bis Freitag als Arbeitstage', () => {
    expect(arbeitstage({ von: '2026-10-05', bis: '2026-10-11' })).toBe(5);
    expect(arbeitstage({ von: '2026-10-09', bis: '2026-10-12' })).toBe(2);
  });

  it('erkennt Überschneidungen inklusive Randtag', () => {
    expect(ueberschneiden({ von: '2026-10-05', bis: '2026-10-07' }, { von: '2026-10-07', bis: '2026-10-09' })).toBe(true);
    expect(ueberschneiden({ von: '2026-10-05', bis: '2026-10-06' }, { von: '2026-10-07', bis: '2026-10-09' })).toBe(false);
  });
});

describe('besetzung — wer ist an einem Tag in welchem Team (Mehmeti, 10.10.2026)', () => {
  const basis = new Map([['t1', ['a', 'b', 'c']], ['t4', ['d', 'e', 'f']]]);
  it('ohne Versetzung: die festen Mitglieder', () => {
    const b = besetzung(basis, [], '2026-10-13');
    expect(b.get('t1')).toEqual({ ids: ['a', 'b', 'c'], dazu: [], weg: [] });
  });
  it('d von Team 4 für einen Tag zu Team 1: dort dazu, in Team 4 weg — nur an diesem Tag', () => {
    const v = [{ datum: '2026-10-13', mitarbeiter_id: 'd', team_id: 't1' }];
    const b = besetzung(basis, v, '2026-10-13');
    expect(b.get('t1')).toEqual({ ids: ['a', 'b', 'c', 'd'], dazu: ['d'], weg: [] });
    expect(b.get('t4')).toEqual({ ids: ['e', 'f'], dazu: [], weg: [{ id: 'd', nach: 't1' }] });
    expect(besetzung(basis, v, '2026-10-14').get('t4')?.ids).toEqual(['d', 'e', 'f']);
  });
  it('Zusatzteam ohne feste Mitglieder bekommt Leute nur über Versetzungen', () => {
    const v = [{ datum: '2026-10-13', mitarbeiter_id: 'a', team_id: 't7' }, { datum: '2026-10-13', mitarbeiter_id: 'e', team_id: 't7' }];
    const b = besetzung(basis, v, '2026-10-13');
    expect(b.get('t7')).toEqual({ ids: ['a', 'e'], dazu: ['a', 'e'], weg: [] });
    expect(b.get('t1')?.weg).toEqual([{ id: 'a', nach: 't7' }]);
  });
  it('Versetzung ins eigene Team ändert nichts; Person ohne Team kommt als «dazu»', () => {
    const v = [{ datum: '2026-10-13', mitarbeiter_id: 'a', team_id: 't1' }, { datum: '2026-10-13', mitarbeiter_id: 'x', team_id: 't4' }];
    const b = besetzung(basis, v, '2026-10-13');
    expect(b.get('t1')).toEqual({ ids: ['a', 'b', 'c'], dazu: [], weg: [] });
    expect(b.get('t4')?.dazu).toEqual(['x']);
  });
});

describe('ohneTag — nur an diesem Tag andere Baustelle', () => {
  it('Mitte: davor und danach bleiben', () => {
    expect(ohneTag({ von: '2026-10-12', bis: '2026-10-16' }, '2026-10-14')).toEqual({ vorher: { von: '2026-10-12', bis: '2026-10-13' }, nachher: { von: '2026-10-15', bis: '2026-10-16' } });
  });
  it('erster oder letzter Tag', () => {
    expect(ohneTag({ von: '2026-10-12', bis: '2026-10-16' }, '2026-10-12')).toEqual({ vorher: null, nachher: { von: '2026-10-13', bis: '2026-10-16' } });
    expect(ohneTag({ von: '2026-10-12', bis: '2026-10-16' }, '2026-10-16')).toEqual({ vorher: { von: '2026-10-12', bis: '2026-10-15' }, nachher: null });
  });
  it('eintägiger Einsatz: nichts bleibt; Tag ausserhalb: alles bleibt', () => {
    expect(ohneTag({ von: '2026-10-14', bis: '2026-10-14' }, '2026-10-14')).toEqual({ vorher: null, nachher: null });
    expect(ohneTag({ von: '2026-10-12', bis: '2026-10-13' }, '2026-10-14')).toEqual({ vorher: { von: '2026-10-12', bis: '2026-10-13' }, nachher: null });
  });
  it('über das Monatsende', () => {
    expect(ohneTag({ von: '2026-10-29', bis: '2026-11-03' }, '2026-11-01').vorher).toEqual({ von: '2026-10-29', bis: '2026-10-31' });
  });
});

describe('planIst — Plan gegen Ist', () => {
  it('wie geplant, anders, nichts, ohne Plan', () => {
    expect(planIst(['b1'], ['b1'])).toBe('wie-geplant');
    expect(planIst(['b1', 'b2'], ['b2'])).toBe('wie-geplant');
    expect(planIst(['b1'], ['b2'])).toBe('anders');
    expect(planIst(['b1'], ['b1', 'b2'])).toBe('anders');
    expect(planIst(['b1'], [])).toBe('nichts');
    expect(planIst([], ['b1'])).toBe('ohne-plan');
    expect(planIst([], [])).toBeNull();
  });
});

describe('naechsterTeamName', () => {
  it('nach Team 1–6 kommt Team 7, auch durcheinander', () => {
    expect(naechsterTeamName(['Team 2', 'Team 10', 'Team 1'])).toBe('Team 11');
    expect(naechsterTeamName(['Gerüst Nord'])).toBe('Team 2');
    expect(naechsterTeamName([])).toBe('Team 1');
  });
});

describe('planAm — Plan vom Montag aus dem Verlauf (0038)', () => {
  const p = (id: string, baustelle: string, von: string, bis: string) => ({ id, team_id: 't3', baustelle_id: baustelle, von, bis });
  const montag = '2026-10-05T04:00:00.000Z'; // Mo 06:00 Schweizer Zeit
  // Am Fr 2.10. geplant: Tillierstrasse Mo–Fr. Am Mo 07:10 gekürzt auf Mo–Di, dazu Siedlerstrasse Mi–Fr.
  const verlauf: VerlaufZeile[] = [
    { tabelle: 'jahresplan', datensatz_id: 'a', aktion: 'neu', vorher: null, nachher: p('a', 'till', '2026-10-05', '2026-10-09'), zeit: '2026-10-02T14:00:00+00:00' },
    { tabelle: 'jahresplan', datensatz_id: 'a', aktion: 'geaendert', vorher: p('a', 'till', '2026-10-05', '2026-10-09'), nachher: p('a', 'till', '2026-10-05', '2026-10-06'), zeit: '2026-10-05T05:10:00+00:00' },
    { tabelle: 'jahresplan', datensatz_id: 'b', aktion: 'neu', vorher: null, nachher: p('b', 'sied', '2026-10-07', '2026-10-09'), zeit: '2026-10-05T05:11:00+00:00' },
  ];
  const jetzt = [p('a', 'till', '2026-10-05', '2026-10-06'), p('b', 'sied', '2026-10-07', '2026-10-09')];
  it('rechnet die Änderungen nach Montag früh zurück', () => {
    expect(planAm(jetzt, verlauf, montag)).toEqual([p('a', 'till', '2026-10-05', '2026-10-09')]);
  });
  it('Einsätze aus der Zeit vor dem Verlauf bleiben', () => {
    const alt = p('x', 'alt', '2026-10-05', '2026-10-09');
    expect(planAm([...jetzt, alt], verlauf, montag).map((x) => x.id).sort()).toEqual(['a', 'x']);
  });
  it('Gelöschtes kommt zurück; Zeitformate «Z» und «+00:00» gemischt', () => {
    const weg: VerlaufZeile = { tabelle: 'jahresplan', datensatz_id: 'c', aktion: 'geloescht', vorher: p('c', 'eig', '2026-10-08', '2026-10-09'), nachher: null, zeit: '2026-10-07T09:00:00Z' };
    expect(planAm([], [weg], montag)).toEqual([p('c', 'eig', '2026-10-08', '2026-10-09')]);
    expect(planAm([], [weg], '2026-10-08T00:00:00+00:00')).toEqual([]);
  });
});

describe('istBalken — gemeldete Tage zu Balken', () => {
  it('aufeinanderfolgende Tage derselben Baustelle = ein Balken, Wechsel = neuer Balken', () => {
    const b = istBalken([
      { team_id: 't2', datum: '2026-10-05', baustelle_id: 'eig' },
      { team_id: 't2', datum: '2026-10-06', baustelle_id: 'eig' },
      { team_id: 't2', datum: '2026-10-07', baustelle_id: 'vik' },
      { team_id: 't2', datum: '2026-10-08', baustelle_id: 'eig' },
      { team_id: 't2', datum: '2026-10-09', baustelle_id: 'vik' },
      { team_id: 't2', datum: '2026-10-06', baustelle_id: 'eig' },
    ]);
    expect(b.map((x) => `${x.baustelle_id} ${x.von}–${x.bis}`)).toEqual(['eig 2026-10-05–2026-10-06', 'eig 2026-10-08–2026-10-08', 'vik 2026-10-07–2026-10-07', 'vik 2026-10-09–2026-10-09']);
  });
});

describe('einteilungenBuendeln — «bis Freitag» als eine Zeile', () => {
  it('gleiche Person, Team, Aktion und Minute → eine Gruppe mit allen Tagen', () => {
    const z = (datum: string, zeit: string, team = 't7'): VerlaufZeile => ({ tabelle: 'einsatz_person', datensatz_id: datum, aktion: 'neu', vorher: null, nachher: { mitarbeiter_id: 'luan', team_id: team, datum }, zeit });
    const g = einteilungenBuendeln([z('2026-10-09', '2026-10-06T14:20:05Z'), z('2026-10-08', '2026-10-06T14:20:04Z'), z('2026-10-08', '2026-10-07T06:00:00Z', 't3')]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ mitarbeiter_id: 'luan', team_id: 't7', tage: ['2026-10-08', '2026-10-09'] });
  });
});
