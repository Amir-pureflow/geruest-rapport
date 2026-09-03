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

  it('20 Teams à 3–4 Personen, je ein Chefmonteur, alle Temporären verteilt', () => {
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

  it('Jahresplan: drei Blöcke pro Team, aktueller Block deckt heute', () => {
    expect(d.jahresplan).toHaveLength(60);
    const heuteIso = '2026-09-03';
    for (const t of d.teams) {
      const bloecke = d.jahresplan.filter((j) => j.team_id === t.id);
      expect(bloecke.some((b) => b.von <= heuteIso && b.bis >= heuteIso)).toBe(true);
    }
  });

  it('Fünf Wochen Meldungen: Vergangenes freigegeben, aktuelle Woche offen, Zeit in Integer-Minuten', () => {
    expect(d.meldungen.length).toBeGreaterThan(350);
    expect(d.eintraege.length).toBeGreaterThan(1000);
    for (const m of d.meldungen) {
      expect(m.datum <= '2026-09-03').toBe(true);
      const woche = m.datum < '2026-08-31' ? 'freigegeben' : 'offen';
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

  it('Abweichungen haben Transkript und Auslöser, Regierapporte rechnen in Rappen', () => {
    const ab = d.meldungen.filter((m) => !m.normalfall);
    expect(ab.length).toBeGreaterThan(10);
    for (const m of ab) {
      expect(m.abweichung_typ).toBeTruthy();
      expect(m.wer_hats_gewollt).toBeTruthy();
      expect(m.transkript).toBeTruthy();
    }
    expect(d.regierapporte.length).toBeGreaterThan(5);
    for (const r of d.regierapporte) {
      const pos = d.positionen.filter((p) => p.regierapport_id === r.id);
      const summe = pos.reduce((s, p) => s + p.betrag_rappen, 0);
      expect(summe).toBe(r.betrag_rappen);
      expect(Number.isInteger(r.betrag_rappen)).toBe(true);
      expect(r.nummer).toMatch(/^RR-2026-\d{4}$/);
      if (r.status === 'bestaetigt') {
        expect(d.zustellungen.filter((z) => z.regierapport_id === r.id).map((z) => z.ereignis)).toContain('bestaetigt');
      }
    }
    const stati = new Set(d.regierapporte.map((r) => r.status));
    expect(stati.has('bestaetigt')).toBe(true);
    expect(stati.has('versendet')).toBe(true);
  });

  it('offene Zusatzaufträge für die nächsten Tage vorhanden', () => {
    const offen = d.zusatzauftraege.filter((z) => z.status === 'offen');
    expect(offen.length).toBeGreaterThanOrEqual(6);
    expect(offen.some((z) => z.geplant_fuer === '2026-09-03')).toBe(true);
  });

  it('ist reproduzierbar (gleicher Seed = gleiche Daten)', () => {
    const d2 = erzeugeDemoBetrieb({ baustellen, heute, userId: 'u1' });
    expect(d2.mitarbeiter.map((m) => m.name)).toEqual(d.mitarbeiter.map((m) => m.name));
    expect(d2.meldungen.length).toBe(d.meldungen.length);
  });
});
