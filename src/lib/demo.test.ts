import { describe, it, expect } from 'vitest';
import { erzeugeDemoBetrieb } from './demo';

const baustellen = Array.from({ length: 217 }, (_, i) => ({
  id: `b${i}`,
  konto_nr: String(903000 + i),
  bezeichnung: `Teststrasse ${i}`,
}));

const heute = new Date(2026, 8, 3, 12); // Do 3.9.2026
const d = erzeugeDemoBetrieb({ baustellen, heute, userId: 'u1' });

describe('Demo-Betrieb — Struktur wie im Gespräch mit Arbnor', () => {
  it('75 Mitarbeitende: 45 fest, 30 temporär, 5 Bauführer, 20 Chefmonteure', () => {
    expect(d.mitarbeiter).toHaveLength(75);
    expect(d.mitarbeiter.filter((m) => m.typ === 'intern')).toHaveLength(45);
    expect(d.mitarbeiter.filter((m) => m.typ === 'temporaer')).toHaveLength(30);
    expect(d.mitarbeiter.filter((m) => m.funktion === 'bauf')).toHaveLength(5);
    expect(d.mitarbeiter.filter((m) => m.funktion === 'gruppe')).toHaveLength(20);
    expect(new Set(d.mitarbeiter.map((m) => m.name)).size).toBe(75);
  });

  it('20 Teams à 3–4 Personen, je ein Vorarbeiter, alle Temporären verteilt', () => {
    expect(d.teams).toHaveLength(20);
    for (const t of d.teams) {
      const mitglieder = d.teamMitglieder.filter((m) => m.team_id === t.id);
      expect(mitglieder.length).toBeGreaterThanOrEqual(3);
      expect(mitglieder.length).toBeLessThanOrEqual(4);
      expect(mitglieder.some((m) => m.mitarbeiter_id === t.chefmonteur_id)).toBe(true);
      const chef = d.mitarbeiter.find((m) => m.id === t.chefmonteur_id);
      expect(chef?.funktion).toBe('gruppe');
    }
    expect(d.teamMitglieder).toHaveLength(70);
  });

  it('30 Kunden mit reservierten .example-Mails, alle 217 Konten zugeordnet', () => {
    expect(d.kunden).toHaveLength(30);
    for (const k of d.kunden) expect(k.email.endsWith('.example')).toBe(true);
    expect(d.baustellen).toHaveLength(217);
    expect(d.baustellen.every((b) => b.kunde_id)).toBe(true);
    expect(d.baustellen.filter((b) => b.status === 'fertig_gemeldet').every((b) => b.fertigstellung_am)).toBe(true);
  });

  it('Planung: kein Team steht je auf zwei Baustellen gleichzeitig', () => {
    for (const t of d.teams) {
      const e = d.jahresplan.filter((j) => j.team_id === t.id).sort((a, b) => a.von.localeCompare(b.von));
      for (let i = 1; i < e.length; i++) expect(e[i].von > e[i - 1].bis).toBe(true);
    }
  });

  it('Planung: mindestens drei Einsätze pro Team, einer deckt heute', () => {
    expect(d.jahresplan.length).toBeGreaterThanOrEqual(60);
    const heuteIso = '2026-09-03';
    for (const t of d.teams) {
      const bloecke = d.jahresplan.filter((j) => j.team_id === t.id);
      expect(bloecke.some((b) => b.von <= heuteIso && b.bis >= heuteIso)).toBe(true);
    }
  });

  it('Fünf Wochen Meldungen: ältere Wochen freigegeben, Vorwoche und aktuelle Woche offen, Zeit in Integer-Minuten', () => {
    expect(d.meldungen.length).toBeGreaterThan(350);
    expect(d.eintraege.length).toBeGreaterThan(1000);
    for (const m of d.meldungen) {
      expect(m.datum <= '2026-09-03').toBe(true);
      // Vorwoche bleibt offen — im Video wird sie geprüft und freigegeben
      const woche = m.datum < '2026-08-24' ? 'freigegeben' : 'offen';
      expect(m.status).toBe(woche);
    }
    for (const e of d.eintraege) {
      expect(Number.isInteger(e.normal_min)).toBe(true);
      expect(Number.isInteger(e.ueber_min)).toBe(true);
      expect(e.konto_nr).toMatch(/^\d{6}$/);
    }
    const freigegebene = d.eintraege.filter((e) => e.status === 'freigegeben');
    expect(d.freigaben).toHaveLength(freigegebene.length);
  });

  it('Nur normale Tage (seit 17.09. kein Abweichungs-Ablauf); Überstunden kommen mit Sprachnotiz, wie das Wochenblatt', () => {
    expect(d.meldungen.every((m) => m.normalfall && m.abweichung_typ === null)).toBe(true);
    const mitUeber = d.meldungen.filter((m) => d.eintraege.some((e) => e.tagesmeldung_id === m.id && e.ueber_min > 0));
    expect(mitUeber.length).toBeGreaterThan(5);
    for (const m of mitUeber) expect(m.transkript).toBeTruthy();
    // Bemerkungen zum Tag ohne Überstunden gibt es auch
    const nurNotiz = d.meldungen.filter((m) => m.transkript && !mitUeber.includes(m));
    expect(nurNotiz.length).toBeGreaterThan(0);
    for (const e of d.eintraege) {
      expect(e.normal_min).toBeLessThanOrEqual(504);
      // Zeiten von–bis und Minuten passen zusammen — wie bei einer echten Meldung
      expect(e.normal_min + e.ueber_min).toBe((e.bis_min! - e.von_min!) + (e.bis2_min! - e.von2_min!));
    }
  });

  it('ist reproduzierbar (gleicher Seed = gleiche Daten)', () => {
    const d2 = erzeugeDemoBetrieb({ baustellen, heute, userId: 'u1' });
    expect(d2.mitarbeiter.map((m) => m.name)).toEqual(d.mitarbeiter.map((m) => m.name));
    expect(d2.meldungen.length).toBe(d.meldungen.length);
  });

  it('Baustellen und Kunden sind erfunden — nie die echte Kontenliste', () => {
    const original = new Set(baustellen.map((b) => b.bezeichnung));
    for (const b of d.baustellen) expect(original.has(b.bezeichnung ?? '')).toBe(false);
    expect(d.baustellen.filter((b) => b.status === 'aktiv')).toHaveLength(80);
    for (const k of d.kunden) expect(k.name).not.toMatch(/SBB|Post |Stadt Bern|Kanton/);
  });

  it('Notizen stehen im Original und auf Deutsch, Team 3 spricht Italienisch', () => {
    const team3 = d.teams.find((t) => t.bezeichnung === 'Team 3')!;
    expect(d.mitarbeiter.find((m) => m.id === team3.chefmonteur_id)?.sprache).toBe('it');
    const fremd = d.meldungen.filter((m) => m.transkript_sprache && m.transkript_sprache !== 'de');
    expect(new Set(fremd.map((m) => m.transkript_sprache))).toEqual(new Set(['it', 'fr', 'pl', 'pt']));
    for (const m of fremd) {
      expect(m.transkript).toBeTruthy();
      expect(m.transkript_quelle).toBeTruthy();
      expect(m.transkript_quelle).not.toBe(m.transkript);
    }
  });

  it('heute haben 16 von 20 Teams gemeldet, zwei davon mit Überstunden — Team 3 noch nicht (es meldet im Video)', () => {
    const heuteMeldungen = d.meldungen.filter((m) => m.datum === '2026-09-03');
    expect(heuteMeldungen).toHaveLength(16);
    const mitUeber = heuteMeldungen.filter((m) => d.eintraege.some((e) => e.tagesmeldung_id === m.id && e.ueber_min > 0));
    expect(mitUeber).toHaveLength(2);
    const team3 = d.teams.find((t) => t.bezeichnung === 'Team 3')!;
    expect(heuteMeldungen.some((m) => m.team_id === team3.id)).toBe(false);
  });
});

describe('Demo-Betrieb «klein» — für Vorführungen (08.10.2026)', () => {
  const k = erzeugeDemoBetrieb({ baustellen, heute, userId: 'u1', umfang: 'klein' });
  const ueberstunden = (m: { id: string }) => k.eintraege.some((e) => e.tagesmeldung_id === m.id && e.ueber_min > 0);

  it('17 Leute: 2 Bauführer, 5 Teams à 3 (Vorarbeiter, Monteur, Temporärer), 6 Kunden', () => {
    expect(k.umfang).toBe('klein');
    expect(k.mitarbeiter).toHaveLength(17);
    expect(k.mitarbeiter.filter((m) => m.funktion === 'bauf')).toHaveLength(2);
    expect(k.teams).toHaveLength(5);
    for (const t of k.teams) expect(k.teamMitglieder.filter((m) => m.team_id === t.id)).toHaveLength(3);
    expect(k.kunden).toHaveLength(6);
  });

  it('jede Sprache genau einmal: Team 1 Deutsch, 2 Französisch, 3 Italienisch, 4 Portugiesisch, 5 Polnisch', () => {
    const sprachen = k.teams.map((t) => k.mitarbeiter.find((m) => m.id === t.chefmonteur_id)?.sprache);
    expect(sprachen).toEqual(['de', 'fr', 'it', 'pt', 'pl']);
  });

  it('drei Wochen, keine Zufallsabweichungen: ein Tag ohne Notiz hat 8.0 h für alle', () => {
    expect(k.meldungen.every((m) => m.datum >= '2026-08-17')).toBe(true);
    const ruhig = k.meldungen.filter((m) => !m.transkript);
    for (const m of ruhig) {
      const e = k.eintraege.filter((x) => x.tagesmeldung_id === m.id);
      expect(e).toHaveLength(3);
      for (const x of e) expect(x.normal_min + x.ueber_min).toBe(480);
    }
  });

  it('heute: 4 von 5 Teams gemeldet, Team 3 noch nicht (meldet live), Team 5 mit Überstunden', () => {
    const heuteM = k.meldungen.filter((m) => m.datum === '2026-09-03');
    expect(heuteM).toHaveLength(4);
    const team3 = k.teams.find((t) => t.bezeichnung === 'Team 3')!;
    const team5 = k.teams.find((t) => t.bezeichnung === 'Team 5')!;
    expect(heuteM.some((m) => m.team_id === team3.id)).toBe(false);
    expect(heuteM.filter(ueberstunden).map((m) => m.team_id)).toEqual([team5.id]);
  });

  it('Vorwoche offen mit vier Überstunden-Fällen, ältere Woche freigegeben', () => {
    const vorwoche = k.meldungen.filter((m) => m.datum >= '2026-08-24' && m.datum <= '2026-08-30');
    expect(vorwoche.every((m) => m.status === 'offen')).toBe(true);
    expect(vorwoche.filter(ueberstunden)).toHaveLength(4);
    expect(k.meldungen.filter((m) => m.datum < '2026-08-24').every((m) => m.status === 'freigegeben')).toBe(true);
  });

  it('12 aktive Baustellen; abgeschlossene Konten ohne Kunde, damit die Kundenliste kurz bleibt', () => {
    expect(k.baustellen.filter((b) => b.status === 'aktiv')).toHaveLength(12);
    expect(k.baustellen.filter((b) => b.status === 'abgeschlossen').every((b) => b.kunde_id === null)).toBe(true);
    expect(k.baustellen.filter((b) => b.status !== 'abgeschlossen').every((b) => b.kunde_id)).toBe(true);
  });

  it('der grosse Betrieb bleibt der Standard (Video)', () => {
    expect(d.umfang).toBe('gross');
    expect(d.teams).toHaveLength(20);
  });
});
