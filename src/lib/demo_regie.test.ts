import { describe, it, expect } from 'vitest';
import { erzeugeDemoBetrieb } from './demo';
import { erzeugeDemoRegie } from './demo_regie';

const baustellen = Array.from({ length: 217 }, (_, i) => ({
  id: `b${i}`,
  konto_nr: String(903000 + i),
  bezeichnung: `Teststrasse ${i}`,
}));

const heute = new Date(2026, 8, 3, 12); // Do 3.9.2026
const userId = 'u1';
const betrieb = erzeugeDemoBetrieb({ baustellen, heute, userId });
const r = erzeugeDemoRegie(betrieb, { heute, userId });

/** Die Rapport-Stände, die die Regierapporte-Seite in ihre drei Spalten einsortiert. */
const STAENDE = ['entwurf', 'versendet', 'rueckfrage', 'frist_abgelaufen', 'bestaetigt'];

describe('Demodaten Regie — nur für Firmen mit MODUS_ERFASSUNG = regie', () => {
  it('hängt an den Meldungen mit Überstunden: dort entsteht der Regieverdacht', () => {
    const mitUeber = betrieb.meldungen.filter(
      (m) => m.normalfall && betrieb.eintraege.some((e) => e.tagesmeldung_id === m.id && e.ueber_min > 0),
    );
    expect(mitUeber.length).toBeGreaterThan(0);
    for (const rap of r.regierapporte) {
      expect(mitUeber.some((m) => m.id === rap.tagesmeldung_id)).toBe(true);
    }
  });

  it('jeder Rapport hat Positionen, und der Betrag ist deren Summe', () => {
    expect(r.regierapporte.length).toBeGreaterThan(0);
    for (const rap of r.regierapporte) {
      const pos = r.positionen.filter((p) => p.regierapport_id === rap.id);
      expect(pos.length).toBeGreaterThan(0);
      expect(rap.betrag_rappen).toBe(pos.reduce((s, p) => s + p.betrag_rappen, 0));
      // Materialmiete liegt immer oben drauf (SGUV) — sonst stimmt die Vorrechnung nicht
      expect(pos.some((p) => p.tarif_code === 'materialmiete')).toBe(true);
    }
  });

  it('alle fünf Stände kommen vor, damit auf der Regierapporte-Seite keine Spalte leer bleibt', () => {
    const gesehen = new Set(r.regierapporte.map((x) => x.status));
    for (const s of gesehen) expect(STAENDE).toContain(s);
    expect(gesehen.size).toBeGreaterThanOrEqual(3);
  });

  it('Entwürfe sind nie verschickt, Verschicktes hat Datum und Frist', () => {
    for (const rap of r.regierapporte) {
      if (rap.status === 'entwurf') {
        expect(rap.versendet_am).toBeNull();
        expect(rap.frist_bis).toBeNull();
        expect(r.zustellungen.some((z) => z.regierapport_id === rap.id)).toBe(false);
      } else {
        expect(rap.versendet_am).toBeTruthy();
        expect(rap.frist_bis).toBeTruthy();
        expect(r.zustellungen.some((z) => z.regierapport_id === rap.id && z.ereignis === 'gesendet')).toBe(true);
      }
      if (rap.status === 'bestaetigt') expect(rap.bestaetigt_am).toBeTruthy();
      else expect(rap.bestaetigt_am).toBeNull();
    }
  });

  it('Nummern sind eindeutig und fortlaufend ab RR-2026-0031', () => {
    const nummern = r.regierapporte.map((x) => x.nummer);
    expect(new Set(nummern).size).toBe(nummern.length);
    expect(nummern[0]).toBe('RR-2026-0031');
    for (const n of nummern) expect(n).toMatch(/^RR-2026-\d{4}$/);
  });

  it('jeder Rapport hat einen Zusatzauftrag, und offene Aufträge liegen in der Zukunft', () => {
    for (const rap of r.regierapporte) {
      expect(r.zusatzauftraege.some((za) => za.id === rap.zusatzauftrag_id)).toBe(true);
    }
    // Die sechs Planungs-Aufträge sind heute oder später — sie füllen die Trichterstufe «bestellt»
    const kuenftig = r.zusatzauftraege.filter((za) => za.geplant_fuer >= '2026-09-03');
    expect(kuenftig.length).toBeGreaterThanOrEqual(6);
    // Genau einer wurde nie Regie, mit Grund und Zeitpunkt
    const erledigt = r.zusatzauftraege.filter((za) => za.status === 'erledigt_ohne_regie');
    expect(erledigt).toHaveLength(1);
    expect(erledigt[0].erledigt_grund).toBe('abgesagt');
    expect(erledigt[0].erledigt_von).toBe(userId);
  });

  it('Mails gehen nur an reservierte .example-Adressen — aus einer Demo nie an echte Empfänger', () => {
    for (const rap of r.regierapporte) expect(rap.empfaenger_email.endsWith('.example')).toBe(true);
    for (const z of r.zustellungen) expect(z.an.endsWith('.example')).toBe(true);
  });

  it('gleicher Seed, gleiche Daten', () => {
    const nochmal = erzeugeDemoRegie(betrieb, { heute, userId });
    expect(nochmal.regierapporte.map((x) => `${x.nummer}:${x.status}:${x.betrag_rappen}`))
      .toEqual(r.regierapporte.map((x) => `${x.nummer}:${x.status}:${x.betrag_rappen}`));
  });
});

describe('Demodaten Regie «klein» — nur echte Kundenaufträge (08.10.2026)', () => {
  const k = erzeugeDemoBetrieb({ baustellen, heute, userId, umfang: 'klein' });
  const rk = erzeugeDemoRegie(k, { heute, userId });

  it('sechs Regierapporte, je ein Stand vertreten', () => {
    expect(rk.regierapporte).toHaveLength(6);
    expect(new Set(rk.regierapporte.map((x) => x.status))).toEqual(new Set(['bestaetigt', 'frist_abgelaufen', 'rueckfrage', 'versendet', 'entwurf']));
  });

  it('Zusatzaufträge: zwei offene Bestellungen (keine für heute), zwei, die zum Rapport wurden, einer abgesagt — keiner pro Überstunde', () => {
    expect(rk.zusatzauftraege).toHaveLength(5);
    // Für heute keiner — den legt Amir in der Vorführung live an (08.10.2026)
    expect(rk.zusatzauftraege.filter((za) => za.geplant_fuer === '2026-09-03')).toHaveLength(0);
    expect(rk.zusatzauftraege.filter((za) => za.geplant_fuer > '2026-09-03')).toHaveLength(2);
    // Keiner aufs Wochenende geplant
    for (const za of rk.zusatzauftraege) expect([0, 6]).not.toContain(new Date(za.geplant_fuer + 'T12:00:00').getDay());
    const mitRapport = rk.regierapporte.filter((x) => x.zusatzauftrag_id);
    expect(mitRapport).toHaveLength(2);
    for (const rap of mitRapport) expect(rk.zusatzauftraege.some((za) => za.id === rap.zusatzauftrag_id)).toBe(true);
    expect(rk.zusatzauftraege.filter((za) => za.status === 'erledigt_ohne_regie')).toHaveLength(1);
    for (const za of rk.zusatzauftraege) expect(za.besteller_rolle).toBe('Bauleitung');
  });
});
