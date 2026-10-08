import { describe, expect, it } from 'vitest';
import { ABGELEHNT, fehlerText, personEntscheid, personFrage, planungAbMorgen, teamEntscheid, teamFrage } from './entfernen';

describe('entfernen', () => {
  it('löscht eine Person nur ohne Stunden, sonst nimmt es sie aus den Listen', () => {
    expect(personEntscheid({ aktiv: true, hatStunden: false })).toBe('loeschen');
    expect(personEntscheid({ aktiv: false, hatStunden: false })).toBe('loeschen');
    expect(personEntscheid({ aktiv: true, hatStunden: true })).toBe('deaktivieren');
    // Schon inaktiv mit Stunden: nichts mehr zu tun — ganz löschen würde den Lohn-Export leeren
    expect(personEntscheid({ aktiv: false, hatStunden: true })).toBe('bleibt');
  });

  it('löscht ein Team nur ohne Meldung; mit offenen Stunden erst nach der Freigabe', () => {
    expect(teamEntscheid({ aktiv: true, hatMeldungen: false, hatOffeneStunden: false })).toBe('loeschen');
    expect(teamEntscheid({ aktiv: false, hatMeldungen: false, hatOffeneStunden: false })).toBe('loeschen');
    expect(teamEntscheid({ aktiv: true, hatMeldungen: true, hatOffeneStunden: false })).toBe('deaktivieren');
    expect(teamEntscheid({ aktiv: true, hatMeldungen: true, hatOffeneStunden: true })).toBe('erst_freigeben');
    expect(teamEntscheid({ aktiv: false, hatMeldungen: true, hatOffeneStunden: true })).toBe('bleibt');
  });

  it('nimmt die Planung ab morgen weg, kürzt was heute läuft und lässt Vergangenes stehen', () => {
    const r = planungAbMorgen(
      [
        { id: 'vorbei', von: '2026-10-01', bis: '2026-10-08' },
        { id: 'bis-heute', von: '2026-10-05', bis: '2026-10-09' },
        { id: 'laeuft', von: '2026-10-05', bis: '2026-10-16' },
        { id: 'ab-heute', von: '2026-10-09', bis: '2026-10-12' },
        { id: 'morgen', von: '2026-10-10', bis: '2026-10-10' },
        { id: 'spaeter', von: '2026-11-02', bis: '2026-11-20' },
      ],
      '2026-10-09',
    );
    expect(r.weg).toEqual(['morgen', 'spaeter']);
    expect(r.kuerzen.map((p) => p.id)).toEqual(['laeuft', 'ab-heute']);
  });

  it('sagt in der Rückfrage klar, was passiert', () => {
    expect(personFrage('Nuhi Vaiti', 'loeschen')).toEqual({ entscheid: 'loeschen', text: '«Nuhi Vaiti» löschen? Das lässt sich nicht rückgängig machen.', knopf: 'Löschen' });
    const weg = personFrage('Nuhi Vaiti', 'deaktivieren', ['Team Vaiti']);
    expect(weg.text).toBe('«Nuhi Vaiti» hat schon Stunden — wird aus allen Listen entfernt, die Stunden bleiben im Lohn-Export. Team Vaiti hat danach keinen Chefmonteur.');
    expect(weg.knopf).toBe('Entfernen');
    expect(personFrage('A B', 'loeschen', ['Team 1', 'Team 3', 'Team 5']).text).toContain('Team 1, Team 3 und Team 5 haben danach keinen Chefmonteur.');
    expect(personFrage('A B', 'bleibt').knopf).toBeNull();

    expect(teamFrage('Team 21', 'loeschen', 0, 0).text).toBe('«Team 21» löschen? Das lässt sich nicht rückgängig machen.');
    expect(teamFrage('Team 21', 'loeschen', 2, 1).text).toBe('«Team 21» löschen? Das lässt sich nicht rückgängig machen. Die Leute bleiben als Mitarbeitende. Die Einsätze in der Planung fallen mit weg.');
    expect(teamFrage('Team 4', 'deaktivieren', 3, 2).text).toBe('«Team 4» hat schon Meldungen — wird aus allen Listen entfernt, die Stunden bleiben im Lohn-Export. Die Leute bleiben als Mitarbeitende. Die Planung ab morgen fällt weg.');
    expect(teamFrage('Team 4', 'erst_freigeben', 3, 0).knopf).toBeNull();
    expect(teamFrage('Team 4', 'bleibt', 0, 0).knopf).toBeNull();
  });

  it('übersetzt Ablehnung und Verbindungsfehler der Datenbank', () => {
    expect(fehlerText({ code: '42501', message: 'new row violates row-level security policy for table "team"' })).toBe(ABGELEHNT);
    expect(fehlerText({ message: 'permission denied for table mitarbeiter' })).toBe(ABGELEHNT);
    expect(fehlerText({ message: 'TypeError: Failed to fetch' })).toMatch(/Keine Verbindung/);
    expect(fehlerText({ message: 'etwas anderes' })).toBe('Konnte nicht löschen: etwas anderes');
  });
});
