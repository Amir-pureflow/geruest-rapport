import { describe, it, expect } from 'vitest';
import { leuteAm, tagTitel, teilenText, type TagesKarte } from './tageskarte';

describe('leuteAm — wer an dem Tag im Team ist', () => {
  const fest = [{ id: 'c1', name: 'Sandro Meier' }, { id: 'a1', name: 'Dominik Widmer' }, { id: 'a2', name: 'Pascal Müller' }];
  const namen = new Map([['b1', 'Dritan Zeqiri']]);
  const teamNamen = new Map([['t3', 'Team 3']]);
  it('feste Leute, dazu Eingeteilte, Abwesende und Versetzte am Schluss', () => {
    const r = leuteAm({
      teamId: 't1', fest, namen, teamNamen, datum: '2026-10-27',
      versetzt: [{ datum: '2026-10-27', mitarbeiter_id: 'b1', team_id: 't1' }, { datum: '2026-10-27', mitarbeiter_id: 'a2', team_id: 't3' }],
      abwesend: new Map([['a1', 'krank']]),
    });
    expect(r).toEqual([
      { id: 'c1', name: 'Sandro Meier', art: 'da' },
      { id: 'b1', name: 'Dritan Zeqiri', art: 'dazu' },
      { id: 'a1', name: 'Dominik Widmer', art: 'abwesend', info: 'Krank' },
      { id: 'a2', name: 'Pascal Müller', art: 'weg', info: 'Team 3' },
    ]);
  });
  it('Versetzung an einem anderen Tag zählt nicht', () => {
    const r = leuteAm({ teamId: 't1', fest, namen, teamNamen, datum: '2026-10-28', versetzt: [{ datum: '2026-10-27', mitarbeiter_id: 'a2', team_id: 't3' }], abwesend: new Map() });
    expect(r.map((p) => p.art)).toEqual(['da', 'da', 'da']);
  });
});

describe('tagTitel', () => {
  it('Heute, Morgen, sonst der Wochentag', () => {
    expect(tagTitel('2026-10-27', '2026-10-27')).toBe('Heute');
    expect(tagTitel('2026-10-28', '2026-10-27')).toBe('Morgen');
    expect(tagTitel('2026-10-26', '2026-10-24')).toBe('Montag'); // Samstag → Montag
  });
});

describe('teilenText — für den Team-Chat', () => {
  const karte: TagesKarte = {
    datum: '2026-10-27',
    einsaetze: [{
      baustelle: { id: 'B1', konto_nr: '901675', bezeichnung: 'Wohnüberbauung Brünnenpark, Haus B', strasse: 'Brünnenstrasse 120', plz: '3027', ort: 'Bern', lat: 46.94, lon: 7.38 },
      beginn_min: 390, treffpunkt: 'werkhof', hinweis: 'Kran kommt um 9', soll_leute: 4,
    }],
    leute: [
      { id: 'c1', name: 'Sandro Meier', art: 'da' }, { id: 'b1', name: 'Dritan Zeqiri', art: 'dazu' },
      { id: 'a1', name: 'Dominik Widmer', art: 'abwesend', info: 'Krank' }, { id: 'a2', name: 'Pascal Müller', art: 'weg', info: 'Team 3' },
    ],
  };
  it('alles drin: Baustelle, Adresse, Beginn, Treffpunkt, Hinweis, Route, Leute', () => {
    expect(teilenText({ team: 'Team 1', karte, heuteIso: '2026-10-26', beginnFirma: 420 })).toBe([
      'Team 1 · Morgen, Di 27.10.',
      '',
      'Wohnüberbauung Brünnenpark, Haus B (901675)',
      'Brünnenstrasse 120, 3027 Bern',
      'Beginn 6:30 · Treffpunkt Werkhof',
      'Hinweis: Kran kommt um 9',
      'Route: https://www.google.com/maps/dir/?api=1&destination=46.940000,7.380000&travelmode=driving',
      '',
      'Leute: Sandro, Dritan',
      'Nicht dabei: Dominik (krank), Pascal (Team 3)',
    ].join('\n'));
  });
  it('ohne eigenen Beginn: der Arbeitsbeginn der Firma; ohne Einsatz: ein Satz', () => {
    const ohne = { ...karte, einsaetze: [{ ...karte.einsaetze[0], beginn_min: null, treffpunkt: null, hinweis: null }] };
    expect(teilenText({ team: 'Team 1', karte: ohne, heuteIso: '2026-10-27', beginnFirma: 420 })).toContain('Beginn 7:00\n');
    expect(teilenText({ team: 'Team 1', karte: { ...karte, einsaetze: [], leute: [] }, heuteIso: '2026-10-27', beginnFirma: 420 })).toBe('Team 1 · Heute, Di 27.10.\nNoch keine Baustelle geplant.');
  });
});
