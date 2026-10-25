import { describe, expect, it } from 'vitest';
import { eintragText, empfaengerFuer, istNeu, tagWort, wannText, type Eintrag } from './posteingang';

const HEUTE = '2026-10-23'; // Freitag

function eintrag(t: Partial<Eintrag>): Eintrag {
  return {
    id: 'e1', an: 'team', team_id: 't1', mitarbeiter_id: null, art: 'plan', tag: '2026-10-26', bezug_id: null,
    inhalt: {}, erstellt_am: '2026-10-23T14:00:00Z', geaendert_am: '2026-10-23T14:00:00Z', erledigt_am: null, gelesen: false,
    ...t,
  };
}

const ort = (baustelle: string, extra: Record<string, unknown> = {}) => ({ baustelle, ...extra });

describe('tagWort', () => {
  it('heute, morgen, sonst Wochentag mit Datum', () => {
    expect(tagWort('2026-10-23', HEUTE)).toBe('heute');
    expect(tagWort('2026-10-24', HEUTE)).toBe('morgen');
    expect(tagWort('2026-10-26', HEUTE)).toBe('Montag 26.10.');
  });
});

describe('eintragText · Plan des Teams', () => {
  it('andere Baustelle: «X statt Y» mit Beginn und Treffpunkt der neuen', () => {
    const t = eintragText(eintrag({ inhalt: { team: 'Team 1', posten: {
      'b:a': { titel: 'Brünnenpark', vorher: ort('Brünnenpark'), nachher: null, zeit: '1' },
      'b:b': { titel: 'Kramgasse 41', vorher: null, nachher: ort('Kramgasse 41', { beginn: 390, treffpunkt: 'werkhof' }), zeit: '2' },
    } } }), HEUTE);
    expect(t.titel).toBe('Plan für Montag 26.10. geändert');
    expect(t.zeilen).toEqual(['Kramgasse 41 statt Brünnenpark (ab 6:30, Treffpunkt Werkhof)']);
    expect(t.ziel).toBe('/');
  });

  it('neue und wegfallende Baustellen einzeln, wenn es nicht eins gegen eins ist', () => {
    const t = eintragText(eintrag({ tag: '2026-10-24', inhalt: { posten: {
      'b:a': { vorher: null, nachher: ort('Kramgasse 41') },
      'b:b': { vorher: null, nachher: ort('Monbijou') },
      'b:c': { vorher: ort('Brünnenpark'), nachher: null },
    } } }), HEUTE);
    expect(t.titel).toBe('Plan für morgen geändert');
    expect(t.zeilen).toEqual(['Neu: Kramgasse 41', 'Neu: Monbijou', 'Fällt weg: Brünnenpark']);
  });

  it('gleiche Baustelle: Beginn, Treffpunkt und Hinweis — ohne Namen, wenn es nur eine ist', () => {
    const t = eintragText(eintrag({ inhalt: { posten: {
      'b:a': { vorher: ort('Brünnenpark', { beginn: 390, treffpunkt: 'werkhof', hinweis: 'Kran um 9' }), nachher: ort('Brünnenpark', { beginn: 420, hinweis: 'Zufahrt hinten' }) },
    } } }), HEUTE);
    expect(t.zeilen).toEqual(['Beginn 7:00 statt 6:30', 'Treffpunkt auf der Baustelle statt Werkhof', 'Hinweis: «Zufahrt hinten»']);
  });

  it('Hinweis entfernt, Beginn wieder wie immer; bei zwei Baustellen mit Namen', () => {
    const t = eintragText(eintrag({ inhalt: { posten: {
      'b:a': { vorher: ort('Brünnenpark', { beginn: 390, hinweis: 'x' }), nachher: ort('Brünnenpark') },
      'b:b': { vorher: null, nachher: ort('Kramgasse 41') },
    } } }), HEUTE);
    expect(t.zeilen).toEqual(['Neu: Kramgasse 41', 'Brünnenpark: Beginn wieder wie immer', 'Brünnenpark: Hinweis entfernt']);
  });

  it('Leute: dazu, weg, zurück, fehlt, doch da, nicht mehr eingeteilt', () => {
    const t = eintragText(eintrag({ inhalt: { posten: {
      'm:1': { titel: 'Marco Keller', vorher: { s: 'nicht' }, nachher: { s: 'da' }, zeit: '1' },
      'm:2': { titel: 'Pascal Müller', vorher: { s: 'da' }, nachher: { s: 'weg', nach: 'Team 3' }, zeit: '2' },
      'm:3': { titel: 'Arben Krasniqi', vorher: { s: 'weg', nach: 'Team 3' }, nachher: { s: 'da' }, zeit: '3' },
      'm:4': { titel: 'Dritan Berisha', vorher: { s: 'da' }, nachher: { s: 'abwesend', art: 'krank' }, zeit: '4' },
      'm:5': { titel: 'Luca Rossi', vorher: { s: 'abwesend', art: 'ferien' }, nachher: { s: 'da' }, zeit: '5' },
      'm:6': { titel: 'Tom Frei', vorher: { s: 'da' }, nachher: { s: 'nicht' }, zeit: '6' },
    } } }), HEUTE);
    expect(t.zeilen).toEqual([
      'Marco Keller kommt dazu', 'Pascal Müller ist bei Team 3', 'Arben Krasniqi ist wieder bei euch',
      'Dritan Berisha fehlt (krank)', 'Luca Rossi ist doch da', 'Tom Frei ist nicht mehr eingeteilt',
    ]);
  });

  it('Reihenfolge nach Zeit der Änderung, Baustellen vor Leuten', () => {
    const t = eintragText(eintrag({ inhalt: { posten: {
      'm:1': { titel: 'Marco Keller', vorher: { s: 'nicht' }, nachher: { s: 'da' }, zeit: '2026-10-23T10:00:00Z' },
      'b:a': { vorher: null, nachher: ort('Kramgasse 41'), zeit: '2026-10-23T11:00:00Z' },
    } } }), HEUTE);
    expect(t.zeilen).toEqual(['Neu: Kramgasse 41', 'Marco Keller kommt dazu']);
  });
});

describe('eintragText · eigene Einteilung', () => {
  it('anderes Team mit Baustelle, statt dem bisherigen', () => {
    const t = eintragText(eintrag({ an: 'person', team_id: null, mitarbeiter_id: 'm1', inhalt: { name: 'Marco Keller', posten: {
      team: { vorher: { team: 'Team 6' }, nachher: { team: 'Team 1', baustelle: 'Brünnenpark' } },
    } } }), HEUTE);
    expect(t.titel).toBe('Einteilung für Montag 26.10. geändert');
    expect(t.zeilen).toEqual(['Du bist bei Team 1 · Brünnenpark (statt Team 6)']);
  });
});

describe('eintragText · Korrektur', () => {
  const inhalt = { name: 'Piotr Zieliński', datum: '2026-10-21', grund: 'Pause nicht abgezogen', posten: {
    normal_min: { vorher: '480', nachher: '465' }, zeiten: { vorher: '07:00–16:30', nachher: '07:00–16:15' },
  } };
  it('Team: Name und Tag, Stunden statt Minuten, Grund zuletzt', () => {
    const t = eintragText(eintrag({ art: 'korrektur', tag: '2026-10-21', inhalt }), HEUTE);
    expect(t.titel).toBe('Stunden korrigiert: Piotr Zieliński, Mi 21.10.');
    expect(t.zeilen).toEqual(['Normal 8.0 h → 7.75 h', 'Zeiten 07:00–16:30 → 07:00–16:15', 'Grund: Pause nicht abgezogen']);
  });
  it('Person: «Deine Stunden»', () => {
    expect(eintragText(eintrag({ art: 'korrektur', an: 'person', tag: '2026-10-21', inhalt }), HEUTE).titel).toBe('Deine Stunden vom Mi 21.10. korrigiert');
  });
});

describe('eintragText · Büro', () => {
  it('Rückfrage mit Kommentar, führt zum Rapport', () => {
    const t = eintragText(eintrag({ an: 'buero', team_id: null, art: 'rueckfrage', tag: null, bezug_id: 'r1', inhalt: { nummer: 'RR-2026-0053', baustelle: 'Lorrainestrasse 18', von: 'bauleitung@example.ch', kommentar: 'Warum 3 h?' } }), HEUTE);
    expect(t).toEqual({ titel: 'Rückfrage zu RR-2026-0053', zeilen: ['Lorrainestrasse 18', '«Warum 3 h?»', 'von bauleitung@example.ch'], ziel: '/regie/r1' });
  });
  it('bestätigt und Frist', () => {
    expect(eintragText(eintrag({ an: 'buero', art: 'bestaetigt', bezug_id: 'r1', inhalt: { nummer: 'RR-1' } }), HEUTE).titel).toBe('RR-1 bestätigt');
    const f = eintragText(eintrag({ an: 'buero', art: 'frist', bezug_id: 'r1', inhalt: { nummer: 'RR-1', frist_bis: '2026-10-20' } }), HEUTE);
    expect(f.titel).toBe('Frist abgelaufen: RR-1');
    expect(f.zeilen).toEqual(['Frist bis Di 20.10. — noch nicht bestätigt']);
  });
  it('Abweichung: Team, Art, wer, Text — und direkt in die Wochenübersicht', () => {
    const t = eintragText(eintrag({ an: 'buero', team_id: null, art: 'abweichung', tag: '2026-10-21', bezug_id: 'tm1',
      inhalt: { team: 'Team 2', team_id: 't2', baustelle: 'Kramgasse 41', typ: 'zusaetzlich', wer: 'kunde', text: 'Zwei Lagen mehr' } }), HEUTE);
    expect(t.titel).toBe('Team 2 meldet: Zusatzarbeit');
    expect(t.zeilen).toEqual(['Kramgasse 41 · Mi 21.10.', 'Vom Kunden gewollt', '«Zwei Lagen mehr»']);
    expect(t.ziel).toBe('/cockpit?woche=2026-10-19&tag=2026-10-21&team=t2&meldung=tm1');
  });
});

describe('istNeu und wannText', () => {
  it('neu = ungelesen und nicht erledigt', () => {
    expect(istNeu(eintrag({}))).toBe(true);
    expect(istNeu(eintrag({ gelesen: true }))).toBe(false);
    expect(istNeu(eintrag({ erledigt_am: '2026-10-23T15:00:00Z' }))).toBe(false);
  });
  it('gerade eben, Minuten, Uhrzeit, gestern, Datum', () => {
    const jetzt = new Date(2026, 9, 23, 16, 0);
    expect(wannText(new Date(2026, 9, 23, 15, 59, 40).toISOString(), jetzt)).toBe('gerade eben');
    expect(wannText(new Date(2026, 9, 23, 15, 35).toISOString(), jetzt)).toBe('vor 25 Min.');
    expect(wannText(new Date(2026, 9, 23, 8, 5).toISOString(), jetzt)).toBe('8:05');
    expect(wannText(new Date(2026, 9, 22, 17, 30).toISOString(), jetzt)).toBe('gestern 17:30');
    expect(wannText(new Date(2026, 9, 19, 9, 0).toISOString(), jetzt)).toBe('Mo 19.10.');
  });
});

describe('empfaengerFuer', () => {
  const lies = (werte: Record<string, string>) => (k: string) => werte[k] ?? null;
  it('Bauführer liest das Büro, Kunde nichts', () => {
    expect(empfaengerFuer('bauf', lies({}))).toEqual({ art: 'buero' });
    expect(empfaengerFuer('kunde', lies({}))).toBeNull();
    expect(empfaengerFuer(null, lies({}))).toBeNull();
  });
  it('Teamgerät mit Firmen-Zugang: das gewählte Team, keine Person', () => {
    expect(empfaengerFuer('chef', lies({ 'teamgeraet-team-id': 't1', 'monteur-id': 'm9' }))).toEqual({ art: 'baustelle', team: 't1', person: null });
  });
  it('Monteur: die gewählte Person', () => {
    expect(empfaengerFuer('monteur', lies({ 'monteur-id': 'm9', 'teamgeraet-team-id': 't1' }))).toEqual({ art: 'baustelle', team: null, person: 'm9' });
  });
});
