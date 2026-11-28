/**
 * Phase 2 — Regie: Tarif, Positionen, Fahrzeug, Etappe, Materialmiete, Total — und derselbe Betrag im PDF.
 * Tarif = fixtures/tarife_sguv_2026.json (für alle Firmen gleich, gültig 01.04.2026–31.03.2027).
 * Das PDF wird mit dem ECHTEN Baustein der App gebaut (pdfBauen), nur das Zeichnen ist ersetzt (tests/ersatz/pdf-lib.ts).
 */
import { describe, expect, it } from 'vitest';
import { positionenAusEintraegen, summe, type RegiePosition } from '../../src/lib/regie';
import { formatChf, materialmiete, modellfallVersetzen, positionBetrag, rund5, tarifNachCode, totalAnzeige, ETAPPE_MIN_RAPPEN } from '../../src/lib/tarif';
import { pdfBauen, type RapportDaten } from '../../supabase/functions/_shared/rapport_pdf';
import { zeileMit } from '../ersatz/pdf-lib';

const person = (name: string, funktion: string, min: number) => ({ normal_min: Math.min(min, 504), ueber_min: Math.max(0, min - 504), mitarbeiter: { name, funktion } });

describe('Tarif', () => {
  it('Ansätze aus der SGUV-Liste', () => {
    expect(tarifNachCode('monteur').ansatz_rappen).toBe(10800);   // Fr. 108.00/h
    expect(tarifNachCode('gruppe').ansatz_rappen).toBe(12100);    // Fr. 121.00/h
    expect(tarifNachCode('lieferwagen_35').ansatz_rappen).toBe(16500); // Fr. 165.00/h
    expect(ETAPPE_MIN_RAPPEN).toBe(28000);                        // Fr. 280.00 pauschal
  });

  it('Modellfall aus dem Konzept: Fr. 955.93, auf 5 Rappen Fr. 955.95', () => {
    // 2 Monteure × 2.0 h = 4.00 h × 108.00 = 432.00
    // Lieferwagen 1.00 h × 165.00             = 165.00
    // Etappenzuschlag                          = 280.00
    // Zwischensumme                            = 877.00
    // Materialmiete 9 % von 877.00 = 78.93     →  955.93 → auf 5 Rappen 955.95
    const r = modellfallVersetzen();
    expect(r.zwischenRappen).toBe(87700);
    expect(r.materialmieteRappen).toBe(7893);
    expect(formatChf(r.totalRappen)).toBe('Fr. 955.95');
  });

  it('Materialmiete rundet auf den Rappen (Zwischenwert, wird erst im Total auf 5 Rappen gerundet)', () => {
    // 9 % von 3'393.75 = 305.4375 → 305.44 (kaufmännisch auf 1 Rappen).
    expect(materialmiete(339375)).toBe(30544);
  });

  // Entscheid Amir 28.11.2026: Das Total des Regierapports wird auf 5 Rappen gerundet.
  it('Total auf 5 Rappen (behoben 28.11.2026)', () => {
    // 3'699.19 → 3'699.20 · 955.93 → 955.95 · 12.02 → 12.00 · 12.03 → 12.05 · 0.02 → 0.00
    expect(modellfallVersetzen().totalRappen % 5).toBe(0);
    expect([369919, 95593, 1202, 1203, 2, 0].map(rund5)).toEqual([369920, 95595, 1200, 1205, 0, 0]);
  });

  it('Anzeige: alter, ungerundet versendeter Rapport behält seinen Betrag; veralteter Kopf → Zeilen gelten', () => {
    expect(totalAnzeige(369919, 369919)).toBe(369919); // vor der Regel versendet (Mail sagte 3'699.19)
    expect(totalAnzeige(369919, 369920)).toBe(369920); // neu: Kopf von der DB gerundet
    expect(totalAnzeige(369919, 339375)).toBe(369920); // Kopf veraltet → Zeilen auf 5 Rappen
    expect(totalAnzeige(369919, null)).toBe(369920);
  });
});

describe('Positionen aus den Stunden', () => {
  it('50 Minuten Monteur: Menge 0.83 h × 108.00 = 89.64 (nicht 90.00 aus Minuten)', () => {
    // 50 / 60 = 0.8333 → Menge 0.83 (Hundertstel 83); 83 × 108.00 / 100 = 89.64
    const [p] = positionenAusEintraegen([person('Luan', 'monteur', 50)]);
    expect(p.menge_hundertstel).toBe(83);
    expect(p.betrag_rappen).toBe(8964);
  });

  it('Beschriftung = Menge: 50 Min. → «0.83 h», 8.75 h, 8.4 h (behoben 28.11.2026)', () => {
    const [p, q, r] = positionenAusEintraegen([person('Luan', 'monteur', 50), person('Ana', 'monteur', 525), person('Ben', 'monteur', 504)]);
    expect(p.bezeichnung).toBe('Luan · 0.83 h');
    expect(q.bezeichnung).toBe('Ana · 8.75 h');
    expect(r.bezeichnung).toBe('Ben · 8.4 h');
  });

  it('Überstunden werden mit demselben Ansatz verrechnet (kein Zuschlag)', () => {
    // 10 h = 600 Min. (504 normal + 96 über) → Menge 10.00 × 108.00 = 1'080.00 — ohne Überstundenzuschlag.
    // Ob ein Zuschlag gilt: Frage an Amir.
    const [p] = positionenAusEintraegen([person('Luan', 'monteur', 600)]);
    expect(p.betrag_rappen).toBe(108000);
  });

  it('Unbekannte Funktion (z. B. Büro) fällt auf den Monteursansatz zurück', () => {
    const [p] = positionenAusEintraegen([person('Sekretärin', 'buero', 60)]);
    expect(p.ansatz_rappen).toBe(10800);
    expect(p.tarif_code).toBe('buero'); // so landet «buero» als Text auf dem PDF (siehe PDF-Test unten)
  });

  it('Team: Gruppenleiter + 2 Monteure je 8.75 h, Lieferwagen 1 h, Etappe, Materialmiete → Fr. 3\'699.19', () => {
    // 8.75 h = 525 Min. → Menge 875
    // Gruppenleiter 8.75 × 121.00 = 1'058.75
    // Monteur       8.75 × 108.00 =   945.00  (× 2 = 1'890.00)
    // Lieferwagen   1.00 × 165.00 =   165.00
    // Etappe                       =   280.00
    // Zwischensumme                = 3'393.75
    // Materialmiete 9 %            =   305.44 (305.4375)
    // Total                        = 3'699.19
    const pers = positionenAusEintraegen([person('Nuhi', 'gruppe', 525), person('Ismail', 'monteur', 525), person('Luan', 'monteur', 525)]);
    expect(pers.map((p) => p.betrag_rappen)).toEqual([105875, 94500, 94500]);
    const zwischen = summe(pers) + tarifNachCode('lieferwagen_35').ansatz_rappen + ETAPPE_MIN_RAPPEN;
    expect(zwischen).toBe(339375);
    expect(zwischen + materialmiete(zwischen)).toBe(369919);
    expect(rund5(zwischen + materialmiete(zwischen))).toBe(369920); // Total auf 5 Rappen
  });

  it('Betrag einer Position = Menge × Ansatz, auch bei km-Ansätzen mit Rappen-Rest', () => {
    // Personenwagen 3.33 km × 1.60 = 5.328 → 5.33
    expect(positionBetrag({ code: 'pw_km', bezeichnung: '', mengeHundertstel: 333, ansatzRappen: 160 })).toBe(533);
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function rapport(positionen: RegiePosition[], kopfBetrag: number | null): RapportDaten {
  return {
    nummer: 'R-0001', betrag_rappen: kopfBetrag, beschrieb: 'Gerüst versetzen', erstellt_am: '2026-11-23T10:00:00Z',
    frist_tage: 3, link: 'http://127.0.0.1:3000/b/test', arbeitsdatum: '2026-11-23',
    kunde: { name: 'Testkunde AG', adresse: 'Teststrasse 1, 3000 Bern', ansprechperson: 'Frau Muster' },
    baustelle: { bezeichnung: 'Testplatz 5', konto_nr: '900001', strasse: 'Testplatz 5', plz: '3000', ort: 'Bern' },
    sachbearbeiter: 'Test', positionen, firma: { FIRMA_NAME: 'Testbau A AG' },
  };
}
const zusatz = (code: string, betrag: number, menge = 100): RegiePosition => ({ tarif_code: code, bezeichnung: code, menge_hundertstel: menge, ansatz_rappen: betrag, betrag_rappen: betrag });
const teamPositionen = (): RegiePosition[] => {
  const pers = positionenAusEintraegen([person('Nuhi', 'gruppe', 525), person('Ismail', 'monteur', 525), person('Luan', 'monteur', 525)]);
  const lw = zusatz('lieferwagen_35', 16500);
  const et = zusatz('etappe', 28000);
  const zw = summe([...pers, lw, et]);
  return [...pers, lw, et, zusatz('materialmiete', materialmiete(zw))];
};

describe('Regierapport-PDF (echter Baustein)', () => {
  it('Alter, vor der 5-Rappen-Regel versendeter Rapport: PDF zeigt weiter den Betrag aus der Mail', async () => {
    const pos = teamPositionen();
    await pdfBauen(rapport(pos, summe(pos)));
    expect(zeileMit('Summe:')).toEqual(['Summe:', "3'699.19"]);
    expect(zeileMit('Rundung')).toEqual([]);
  });

  it("PDF-Summe auf 5 Rappen mit eigener Rundungszeile: 3'699.19 + 0.01 = 3'699.20 (behoben 28.11.2026)", async () => {
    const pos = teamPositionen();
    await pdfBauen(rapport(pos, rund5(summe(pos))));
    expect(zeileMit('Rundung')).toEqual(['Rundung', '0.01']);
    expect(zeileMit('Summe:')).toEqual(['Summe:', "3'699.20"]);
  });

  it('Jede Tabellenzeile: Menge × Preis = Summe', async () => {
    // Monteur: 2 Personen zusammengefasst → 17.500 h × 108.00 = 1'890.00
    await pdfBauen(rapport(teamPositionen(), 369919));
    expect(zeileMit('Gerüstmonteur/in')).toEqual(['Gerüstmonteur/in', 'h', '17.500', '108.00', "1'890.00"]);
    expect(zeileMit('Gruppenleiter/in')).toEqual(['Gruppenleiter/in', 'h', '8.750', '121.00', "1'058.75"]);
    expect(zeileMit('Lieferwagen bis 3,5 t')).toEqual(['Lieferwagen bis 3,5 t', 'h', '1.000', '165.00', '165.00']);
    expect(zeileMit('Materialmiete (9 % pro Monat)')).toEqual(['Materialmiete (9 % pro Monat)', 'pa', '1.000', '305.44', '305.44']);
  });

  it('Veralteter Kopf-Betrag: PDF rechnet aus den Zeilen (behoben 28.11.2026)', async () => {
    // Szenario: Bauführer schaltet «Materialmiete» ein; die Zeile wird gespeichert, das Nachführen des Kopf-Betrags
    // (RegieDetail.betragAktualisieren, eigene Anfrage ohne Fehlerprüfung) scheitert oder die App wird geschlossen.
    // Kopf bleibt 3'393.75, Zeilen ergeben 3'699.19 → PDF zeigt 3'393.75 unter Zeilen, die 3'699.19 ergeben.
    const pos = teamPositionen();
    await pdfBauen(rapport(pos, 339375));
    expect(zeileMit('Summe:')).toEqual(['Summe:', "3'699.20"]);
  });

  it('Funktion ohne Tarifklasse erscheint als Gerüstmonteur/in, nie als Code «buero» (behoben 28.11.2026)', async () => {
    await pdfBauen(rapport(positionenAusEintraegen([person('Sekretärin', 'buero', 60)]), 10800));
    expect(zeileMit('buero')).toEqual([]);
    expect(zeileMit('Gerüstmonteur/in')).toEqual(['Gerüstmonteur/in', 'h', '1.000', '108.00', '108.00']);
  });

  it('Unbekannter Code mit eigenem Ansatz: «Weitere Leistung» statt Code', async () => {
    await pdfBauen(rapport([{ tarif_code: 'buero', bezeichnung: 'X · 1.0 h', menge_hundertstel: 100, ansatz_rappen: 9500, betrag_rappen: 9500 }], 9500));
    expect(zeileMit('buero')).toEqual([]);
    expect(zeileMit('Weitere Leistung')).toEqual(['Weitere Leistung', 'h', '1.000', '95.00', '95.00']);
  });
});
