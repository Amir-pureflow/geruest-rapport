import { describe, expect, it } from 'vitest';
import { arbeitstage, ausschnitt, besetzung, einteilungenBuendeln, ersatzVorschlaege, heuteUndNaechster, istBalken, konflikte, konflikteBuendeln, naechsterTeamName, ohneTag, planAm, planHinweise, planIst, spuren, tageZwischen, ueberschneiden, zeitraumVorschlag, type EinsatzSoll, type VerlaufZeile } from './planung';
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

describe('planHinweise — Umplanungen fürs Team (Stand damals gegen jetzt)', () => {
  const p = (id: string, team: string, bs: string, von: string, bis: string) => ({ id, team_id: team, baustelle_id: bs, von, bis });
  const seit = '2026-10-06T00:00:00Z';
  it('Notfall: Einsatz gekürzt, für Mi neue Baustelle → Hinweis mit der alten Baustelle; Do bleibt gleich → kein Hinweis', () => {
    const v: VerlaufZeile[] = [
      { tabelle: 'jahresplan', datensatz_id: 'p1', aktion: 'geaendert', vorher: p('p1', 't2', 'eig', '2026-10-05', '2026-10-09'), nachher: p('p1', 't2', 'eig', '2026-10-05', '2026-10-06'), zeit: '2026-10-07T04:45:00Z' },
      { tabelle: 'jahresplan', datensatz_id: 'p6', aktion: 'neu', vorher: null, nachher: p('p6', 't2', 'eig', '2026-10-08', '2026-10-09'), zeit: '2026-10-07T04:45:01Z' },
      { tabelle: 'jahresplan', datensatz_id: 'p5', aktion: 'neu', vorher: null, nachher: p('p5', 't2', 'vik', '2026-10-07', '2026-10-07'), zeit: '2026-10-07T04:45:02Z' },
    ];
    const jetzt = [p('p1', 't2', 'eig', '2026-10-05', '2026-10-06'), p('p5', 't2', 'vik', '2026-10-07', '2026-10-07'), p('p6', 't2', 'eig', '2026-10-08', '2026-10-09')];
    expect(planHinweise('t2', [], ['2026-10-07', '2026-10-08'], v, seit, jetzt, [])).toEqual([
      { tag: '2026-10-07', art: 'baustelle', zeit: '2026-10-07T04:45:02Z', alt: ['eig'] },
    ]);
  });
  it('Demo neu geladen: gelöscht und gleich wieder angelegt → kein Hinweis', () => {
    const v: VerlaufZeile[] = [
      { tabelle: 'jahresplan', datensatz_id: 'alt', aktion: 'geloescht', vorher: p('alt', 't2', 'eig', '2026-10-05', '2026-10-16'), nachher: null, zeit: '2026-10-07T04:00:00Z' },
      { tabelle: 'jahresplan', datensatz_id: 'neu', aktion: 'neu', vorher: null, nachher: p('neu', 't2', 'eig', '2026-10-05', '2026-10-16'), zeit: '2026-10-07T04:00:01Z' },
    ];
    expect(planHinweise('t2', [], ['2026-10-07'], v, seit, [p('neu', 't2', 'eig', '2026-10-05', '2026-10-16')], [])).toEqual([]);
  });
  it('Leute: eigene weg, fremde dazu, zurück — nur was sich gegenüber damals unterscheidet', () => {
    const e = (id: string, ma: string, team: string, datum: string, aktion: VerlaufZeile['aktion'], zeit: string): VerlaufZeile =>
      ({ tabelle: 'einsatz_person', datensatz_id: id, aktion, vorher: aktion === 'neu' ? null : { mitarbeiter_id: ma, team_id: team, datum }, nachher: aktion === 'geloescht' ? null : { mitarbeiter_id: ma, team_id: team, datum }, zeit });
    const v = [
      e('a', 'luan', 't7', '2026-10-08', 'neu', '2026-10-06T14:21:00Z'),
      e('b', 'marco', 't3', '2026-10-08', 'neu', '2026-10-08T05:30:00Z'),
      e('c', 'kevin', 't7', '2026-10-09', 'neu', '2026-10-06T14:21:00Z'),
      e('c', 'kevin', 't7', '2026-10-09', 'geloescht', '2026-10-09T04:50:00Z'),
    ];
    const jetzt = [{ mitarbeiter_id: 'luan', team_id: 't7', datum: '2026-10-08' }, { mitarbeiter_id: 'marco', team_id: 't3', datum: '2026-10-08' }];
    expect(planHinweise('t2', ['luan', 'marco'], ['2026-10-08'], v, seit, [], jetzt).map((x) => `${x.art} ${x.mitarbeiter_id} ${x.team_id ?? ''}`).sort()).toEqual(['weg luan t7', 'weg marco t3']);
    // Kevin: Do eingeteilt und Fr wieder gelöscht → am Fr gegenüber damals nichts geändert
    expect(planHinweise('t3', ['kevin'], ['2026-10-08', '2026-10-09'], v, seit, [], jetzt).map((x) => `${x.tag} ${x.art} ${x.mitarbeiter_id}`)).toEqual(['2026-10-08 dazu marco']);
  });
  it('Zurück ins feste Team, nachdem die Einteilung schon vor «seit» bestand', () => {
    const v: VerlaufZeile[] = [{ tabelle: 'einsatz_person', datensatz_id: 'x', aktion: 'geloescht', vorher: { mitarbeiter_id: 'kevin', team_id: 't7', datum: '2026-10-09' }, nachher: null, zeit: '2026-10-09T04:50:00Z' }];
    expect(planHinweise('t3', ['kevin'], ['2026-10-09'], v, seit, [], [])).toEqual([{ tag: '2026-10-09', art: 'zurueck', zeit: '2026-10-09T04:50:00Z', mitarbeiter_id: 'kevin' }]);
  });
  it('Neu verplanter Tag ist keine Umplanung (Woche am Freitag geplant, Demo neu geladen); gestrichener Einsatz schon', () => {
    const v: VerlaufZeile[] = [
      { tabelle: 'jahresplan', datensatz_id: 'x', aktion: 'neu', vorher: null, nachher: p('x', 't2', 'eig', '2026-10-05', '2026-10-09'), zeit: '2026-10-06T16:00:00Z' },
      { tabelle: 'jahresplan', datensatz_id: 'y', aktion: 'geloescht', vorher: p('y', 't9', 'alt', '2026-10-05', '2026-10-09'), nachher: null, zeit: '2026-10-06T16:00:00Z' },
    ];
    expect(planHinweise('t2', [], ['2026-10-07'], v, seit, [p('x', 't2', 'eig', '2026-10-05', '2026-10-09')], [])).toEqual([]);
    expect(planHinweise('t9', [], ['2026-10-07'], v, seit, [], [])).toEqual([{ tag: '2026-10-07', art: 'baustelle', zeit: '2026-10-06T16:00:00Z', alt: ['alt'] }]);
  });
  it('Änderungen vor «seit» zählen nicht', () => {
    const v: VerlaufZeile[] = [{ tabelle: 'jahresplan', datensatz_id: 'x', aktion: 'neu', vorher: null, nachher: p('x', 't2', 'eig', '2026-10-05', '2026-10-09'), zeit: '2026-10-02T14:00:00Z' }];
    expect(planHinweise('t2', [], ['2026-10-07'], v, seit, [p('x', 't2', 'eig', '2026-10-05', '2026-10-09')], [])).toEqual([]);
  });
});

describe('heuteUndNaechster', () => {
  it('Freitag → Montag, Mittwoch → Donnerstag', () => {
    expect(heuteUndNaechster(new Date(2026, 9, 9, 12))).toEqual(['2026-10-09', '2026-10-12']);
    expect(heuteUndNaechster(new Date(2026, 9, 7, 12))).toEqual(['2026-10-07', '2026-10-08']);
  });
  it('über Feiertage: Do 24.12. → Mo 28.12., Do 31.12. → Mo 4.1.', () => {
    expect(heuteUndNaechster(new Date(2026, 11, 24, 12))).toEqual(['2026-12-24', '2026-12-28']);
    expect(heuteUndNaechster(new Date(2026, 11, 31, 12))).toEqual(['2026-12-31', '2027-01-04']);
  });
});

describe('arbeitstage über Feiertage', () => {
  it('Weihnachtswoche 21.–25.12.2026: 4 Arbeitstage (Fr ist Weihnachten)', () => {
    expect(arbeitstage({ von: '2026-12-21', bis: '2026-12-25' })).toBe(4);
  });
});

describe('konflikte — was in der Planung zu lösen ist', () => {
  // Woche Mo 26.10. – Fr 30.10.2026. Team 1: Chef c1, a1, a2 · Team 2: Chef c2, b1 · Team 3 und 4 ohne Einsatz
  const teams = [{ id: 't1', chefmonteur_id: 'c1' }, { id: 't2', chefmonteur_id: 'c2' }, { id: 't3', chefmonteur_id: null }, { id: 't4', chefmonteur_id: null }];
  const basis = new Map([['t1', ['c1', 'a1', 'a2']], ['t2', ['c2', 'b1']], ['t3', []], ['t4', ['d1']]]);
  const plaene: EinsatzSoll[] = [
    { team_id: 't1', baustelle_id: 'B1', von: '2026-10-26', bis: '2026-10-30', soll_leute: 3 },
    { team_id: 't2', baustelle_id: 'B2', von: '2026-10-26', bis: '2026-10-30', soll_leute: null },
  ];
  const abw = (eintraege: [string, string, string][]) => {
    const m = new Map<string, Map<string, string>>();
    for (const [datum, id, art] of eintraege) m.set(datum, (m.get(datum) ?? new Map()).set(id, art));
    return m;
  };
  const lauf = (o: Partial<Parameters<typeof konflikte>[0]>) => konflikte({ tage: ['2026-10-26'], teams, basis, versetzt: [], plaene, abwesend: new Map(), ...o });

  it('alles besetzt: nichts zu lösen', () => expect(lauf({})).toEqual([]));

  it('unter Soll: Team 1 braucht 3, a1 ist krank', () => {
    expect(lauf({ tage: ['2026-10-27'], abwesend: abw([['2026-10-27', 'a1', 'krank']]) }))
      .toEqual([{ art: 'unter-soll', datum: '2026-10-27', team_id: 't1', ist: 2, soll: 3, baustelle_id: 'B1' }]);
  });

  it('ohne «Leute nötig» keine Meldung, auch wenn jemand fehlt', () => {
    expect(lauf({ tage: ['2026-10-27'], abwesend: abw([['2026-10-27', 'b1', 'ferien']]) })).toEqual([]);
  });

  it('Chefmonteur fehlt: abwesend — und versetzt (mit Ziel-Team)', () => {
    expect(lauf({ tage: ['2026-10-28'], abwesend: abw([['2026-10-28', 'c2', 'ferien']]) }))
      .toEqual([{ art: 'chef-fehlt', datum: '2026-10-28', team_id: 't2', mitarbeiter_id: 'c2', baustelle_id: 'B2' }]);
    const r = lauf({ tage: ['2026-10-28'], versetzt: [{ datum: '2026-10-28', mitarbeiter_id: 'c2', team_id: 't1' }] });
    expect(r).toEqual([{ art: 'chef-fehlt', datum: '2026-10-28', team_id: 't2', mitarbeiter_id: 'c2', baustelle_id: 'B2', nach_team: 't1' }]);
  });

  it('niemand da: nur «ohne Leute», nicht zusätzlich «Chef fehlt»', () => {
    const r = lauf({ tage: ['2026-10-29'], versetzt: [{ datum: '2026-10-29', mitarbeiter_id: 'c2', team_id: 't1' }], abwesend: abw([['2026-10-29', 'b1', 'krank']]) });
    expect(r.filter((k) => k.team_id === 't2')).toEqual([{ art: 'ohne-leute', datum: '2026-10-29', team_id: 't2', ist: 0, soll: undefined, baustelle_id: 'B2' }]);
  });

  it('abwesend, aber eingeteilt', () => {
    const r = lauf({ tage: ['2026-10-30'], versetzt: [{ datum: '2026-10-30', mitarbeiter_id: 'b1', team_id: 't1' }], abwesend: abw([['2026-10-30', 'b1', 'krank']]) });
    expect(r).toContainEqual({ art: 'abwesend-eingeteilt', datum: '2026-10-30', team_id: 't1', mitarbeiter_id: 'b1' });
  });

  it('eingeteilt, aber das Team hat keine Baustelle', () => {
    const r = lauf({ versetzt: [{ datum: '2026-10-26', mitarbeiter_id: 'a2', team_id: 't3' }] });
    expect(r).toContainEqual({ art: 'eingeteilt-ohne-einsatz', datum: '2026-10-26', team_id: 't3', ist: 1 });
  });

  it('Team mit Leuten ohne Baustelle: nur für heute und den nächsten Arbeitstag', () => {
    expect(lauf({ tage: ['2026-10-26', '2026-10-27'], ohneEinsatzTage: ['2026-10-26'] }))
      .toEqual([{ art: 'ohne-einsatz', datum: '2026-10-26', team_id: 't4', ist: 1 }]);
  });

  it('Wochenende und Feiertag: nie ein Konflikt', () => {
    const p: EinsatzSoll[] = [{ team_id: 't1', baustelle_id: 'B1', von: '2026-12-24', bis: '2026-12-27', soll_leute: 5 }];
    expect(lauf({ tage: ['2026-12-25', '2026-12-26', '2026-12-27'], plaene: p })).toEqual([]);
    expect(lauf({ tage: ['2026-12-24'], plaene: p })).toEqual([{ art: 'unter-soll', datum: '2026-12-24', team_id: 't1', ist: 3, soll: 5, baustelle_id: 'B1' }]);
  });

  it('bündeln: dieselbe Lücke Mo–Fr ist eine Zeile; über das Wochenende weiter, eine andere Zahl trennt', () => {
    const p: EinsatzSoll[] = [{ team_id: 't1', baustelle_id: 'B1', von: '2026-10-26', bis: '2026-11-03', soll_leute: 4 }];
    const tage = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03'];
    // Am Di 3.11. ist a1 krank: 2 statt 3 Leute — eigener Block
    const r = konflikteBuendeln(lauf({ tage, plaene: p, abwesend: abw([['2026-11-03', 'a1', 'krank']]) }));
    expect(r.map((k) => `${k.datum}–${k.bis} ${k.tage} ${k.ist}/${k.soll}`)).toEqual(['2026-10-26–2026-11-02 6 3/4', '2026-11-03–2026-11-03 1 2/4']);
  });

  it('bündeln: eine Lücke (Mittwoch ohne Konflikt) trennt die Blöcke', () => {
    const k = (datum: string) => ({ art: 'chef-fehlt' as const, datum, team_id: 't2', mitarbeiter_id: 'c2' });
    expect(konflikteBuendeln([k('2026-10-26'), k('2026-10-27'), k('2026-10-29')]).map((b) => `${b.datum}–${b.bis}`)).toEqual(['2026-10-26–2026-10-27', '2026-10-29–2026-10-29']);
  });

  it('zwei Einsätze am Tag: das grössere Soll gilt; sortiert nach Tag, dann Schwere', () => {
    const p: EinsatzSoll[] = [
      { team_id: 't1', baustelle_id: 'B1', von: '2026-10-26', bis: '2026-10-26', soll_leute: 2 },
      { team_id: 't1', baustelle_id: 'B9', von: '2026-10-26', bis: '2026-10-26', soll_leute: 4 },
      { team_id: 't2', baustelle_id: 'B2', von: '2026-10-26', bis: '2026-10-27', soll_leute: null },
    ];
    const r = lauf({ tage: ['2026-10-27', '2026-10-26'], plaene: p, abwesend: abw([['2026-10-27', 'c2', 'krank'], ['2026-10-27', 'b1', 'krank']]) });
    expect(r.map((k) => `${k.datum} ${k.art} ${k.team_id}`)).toEqual(['2026-10-26 unter-soll t1', '2026-10-27 ohne-leute t2']);
    expect(r[0]).toMatchObject({ ist: 3, soll: 4, baustelle_id: 'B9' });
  });
});

describe('Fehlt gemeldet und Ersatzvorschlag (0053)', () => {
  // Mo 26.10.2026. Team 1 (Chef c1, a1, a2) braucht 3 · Team 2 (Chef c2, b1, b2, b3) braucht 3 → einer zu viel
  // Team 3 (d1, d2) ohne Einsatz · s1 ohne festes Team
  const teams = [{ id: 't1', chefmonteur_id: 'c1' }, { id: 't2', chefmonteur_id: 'c2' }, { id: 't3', chefmonteur_id: 'd1' }];
  const basis = new Map([['t1', ['c1', 'a1', 'a2']], ['t2', ['c2', 'b1', 'b2', 'b3']], ['t3', ['d1', 'd2']]]);
  const plaene: EinsatzSoll[] = [
    { team_id: 't1', baustelle_id: 'B1', von: '2026-10-26', bis: '2026-10-30', soll_leute: 3 },
    { team_id: 't2', baustelle_id: 'B2', von: '2026-10-26', bis: '2026-10-30', soll_leute: 3 },
  ];
  const personen = [
    { id: 'c1', name: 'Chef Eins' }, { id: 'a1', name: 'Arben' }, { id: 'a2', name: 'Pascal' },
    { id: 'c2', name: 'Chef Zwei' }, { id: 'b1', name: 'Bujar' }, { id: 'b2', name: 'Dani' }, { id: 'b3', name: 'Luca' },
    { id: 'd1', name: 'Marco' }, { id: 'd2', name: 'Tom' }, { id: 's1', name: 'Sami' },
  ];
  const fehlt = [{ id: 'f1', datum: '2026-10-26', mitarbeiter_id: 'a2', team_id: 't1' }];
  const abw = new Map([['2026-10-26', new Map([['a2', 'fehlt']])]]);

  it('steht zuoberst, und «unter Soll» für dasselbe Team entfällt', () => {
    const r = konflikte({ tage: ['2026-10-26'], teams, basis, versetzt: [], plaene, abwesend: abw, fehlt });
    expect(r).toEqual([{ art: 'fehlt-gemeldet', datum: '2026-10-26', team_id: 't1', mitarbeiter_id: 'a2', fehlmeldung_id: 'f1' }]);
  });

  it('fehlten schon vorher Leute, bleibt «x von y» — auch nachdem Ersatz eingeteilt ist', () => {
    const p4: EinsatzSoll[] = [{ ...plaene[0], soll_leute: 4 }, plaene[1]];
    const vorher = konflikte({ tage: ['2026-10-26'], teams, basis, versetzt: [], plaene: p4, abwesend: abw, fehlt });
    expect(vorher.map((k) => `${k.art} ${k.ist ?? ''}`)).toEqual(['fehlt-gemeldet ', 'unter-soll 2']);
    const mitErsatz = konflikte({ tage: ['2026-10-26'], teams, basis, versetzt: [{ datum: '2026-10-26', mitarbeiter_id: 'd1', team_id: 't1' }], plaene: p4, abwesend: abw, fehlt });
    expect(mitErsatz.map((k) => `${k.art} ${k.ist ?? ''}`)).toEqual(['fehlt-gemeldet ', 'unter-soll 3']);
  });

  it('Ersatz eingeteilt und das Soll erreicht: nur noch die Fehlmeldung (bis die Abwesenheit eingetragen ist)', () => {
    const r = konflikte({ tage: ['2026-10-26'], teams, basis, versetzt: [{ datum: '2026-10-26', mitarbeiter_id: 'd1', team_id: 't1' }], plaene, abwesend: abw, fehlt });
    expect(r.map((k) => k.art)).toEqual(['fehlt-gemeldet']);
  });

  it('eingeteilt und als fehlt gemeldet: keine zweite Zeile «abwesend, aber eingeteilt»', () => {
    const versetzt = [{ datum: '2026-10-26', mitarbeiter_id: 'b3', team_id: 't1' }];
    const r = konflikte({ tage: ['2026-10-26'], teams, basis, versetzt, plaene, abwesend: new Map([['2026-10-26', new Map([['b3', 'fehlt']])]]), fehlt: [{ id: 'f2', datum: '2026-10-26', mitarbeiter_id: 'b3', team_id: 't1' }] });
    expect(r.map((k) => k.art)).toEqual(['fehlt-gemeldet']);
  });

  it('Ersatz: zuerst frei (Team ohne Einsatz, ohne festes Team), dann überzählig — nie der Chef, nie Abwesende', () => {
    const r = ersatzVorschlaege({ datum: '2026-10-26', fuerTeam: 't1', teams, basis, versetzt: [], plaene, abwesend: abw.get('2026-10-26')!, personen, max: 5 });
    expect(r).toEqual([
      { id: 'd1', grund: 'frei', team_id: 't3' },
      { id: 's1', grund: 'frei', team_id: null },
      { id: 'd2', grund: 'frei', team_id: 't3' },
      { id: 'b1', grund: 'ueberzaehlig', team_id: 't2' },
    ]);
  });

  it('höchstens so viele aus einem Team, wie dort zu viel sind; Abwesende zählen nicht mit', () => {
    const r = ersatzVorschlaege({ datum: '2026-10-26', fuerTeam: 't1', teams, basis, versetzt: [], plaene, abwesend: new Map([['a2', 'fehlt'], ['b1', 'krank']]), personen, max: 9 });
    expect(r.filter((k) => k.grund === 'ueberzaehlig')).toEqual([]);
  });

  it('wer schon im Team ist oder anderswo eingeteilt, wird nicht vorgeschlagen', () => {
    const versetzt = [{ datum: '2026-10-26', mitarbeiter_id: 's1', team_id: 't2' }, { datum: '2026-10-26', mitarbeiter_id: 'd2', team_id: 't1' }];
    const r = ersatzVorschlaege({ datum: '2026-10-26', fuerTeam: 't1', teams, basis, versetzt, plaene, abwesend: abw.get('2026-10-26')!, personen, max: 9 });
    expect(r.map((k) => k.id)).toEqual(['d1', 'b1', 'b2']);
  });
});
