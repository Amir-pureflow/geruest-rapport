/**
 * Phase 2 — Lohn, Wochensummen, Temporärbüro, Subunternehmer und das Excel (echter Baustein, danach wieder eingelesen).
 * Woche: Mo 23.11.–So 29.11.2026 (KW 48).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { lohnZeilen, mitAbwesenheiten, temporaerBueroBlaetter, subunternehmerBlaetter, ueberstunden, wochenSpalten, type LohnEintrag, type LohnPerson } from '../../src/lib/lohn';
import { bueroExcel } from '../../src/lib/excel';

const ana: LohnPerson = { id: 'p-ana', name: 'Ana Test', typ: 'intern', temporaerbuero: null };
const ben: LohnPerson = { id: 'p-ben', name: 'Ben Temp', typ: 'temporaer', temporaerbuero: 'Adecco Test' };
const ben2: LohnPerson = { id: 'p-ben2', name: 'Ben Temp', typ: 'temporaer', temporaerbuero: 'Adecco Test' }; // gleicher Name, andere Person
const sub: LohnPerson = { id: 'p-sub', name: 'Sami Sub', typ: 'extern', temporaerbuero: null, subunternehmer_firma: 'Gerüst Sub GmbH' };
const e = (datum: string, p: LohnPerson, normal: number, ueber: number, konto = '900001', km = 0): LohnEintrag => ({ datum, mitarbeiter: p, normal_min: normal, ueber_min: ueber, oev: false, km, konto_nr: konto });

describe('Lohn: Woche je Person', () => {
  it('Ana: Mo 8.75 h, Di zwei Baustellen, Mi 8.4 h → Woche 25.90 h, davon 0.70 h Überstunden', () => {
    // Mo: 504 + 21 = 525
    // Di: Baustelle A 285 normal (km 12) + Baustelle B 219 normal + 21 über (km 12) = 525, km zählt einmal (12)
    // Mi: 504
    // Woche: 525 + 525 + 504 = 1554 Min. = 25.90 h; Über 21 + 21 = 42 Min. = 0.70 h; km 12
    const [z] = lohnZeilen([
      e('2026-11-23', ana, 504, 21),
      e('2026-11-24', ana, 285, 0, '900001', 12), e('2026-11-24', ana, 219, 21, '900002', 12),
      e('2026-11-25', ana, 504, 0),
    ]);
    expect(z.total_min).toBe(1554);
    expect(z.ueber_min).toBe(42);
    expect(z.km).toBe(12);
    expect(wochenSpalten(z, new Date(2026, 10, 23, 12))).toEqual([525, 525, 504, 0, 0, 0, 0]);
  });

  it('Abwesenheit steht daneben, nicht im Total', () => {
    // Do Ferien 504 Min. bezahlt → abwesend 504, total bleibt 525
    const [z] = mitAbwesenheiten(lohnZeilen([e('2026-11-23', ana, 504, 21)]), [{ datum: '2026-11-26', mitarbeiter: ana, art: 'ferien', minuten: 504 }]);
    expect(z.total_min).toBe(525);
    expect(z.abwesend_min).toBe(504);
  });

  it('Überstunden Zeitraum und seit Jahresbeginn', () => {
    // Zeitraum: 21 + 21 = 42; Jahr: 42 + 120 (Oktober) = 162
    const zr = [e('2026-11-23', ana, 504, 21), e('2026-11-24', ana, 504, 21)];
    const [u] = ueberstunden(zr, [...zr, e('2026-10-05', ana, 504, 120)]);
    expect(u.zeitraum_min).toBe(42);
    expect(u.jahr_min).toBe(162);
  });
});

describe('Temporärbüro und Subunternehmer', () => {
  it('Nur Temporäre im Büro-Blatt, Feste und Subunternehmer nicht', () => {
    const b = temporaerBueroBlaetter([e('2026-11-23', ana, 504, 0), e('2026-11-23', ben, 504, 21), e('2026-11-23', sub, 504, 0)]);
    expect(b.map((x) => x.buero)).toEqual(['Adecco Test']);
    expect(b[0].zeilen.map((z) => z.name)).toEqual(['Ben Temp']);
    expect(b[0].total_min).toBe(525); // 504 + 21
    expect(subunternehmerBlaetter([e('2026-11-23', sub, 504, 0)])[0].buero).toBe('Gerüst Sub GmbH');
  });

  it('zwei Temporäre mit gleichem Namen: zwei Summen, mit Nummer unterscheidbar (behoben 28.11.2026)', () => {
    // Ben Temp (p-ben) 525 Min., Ben Temp (p-ben2) 504 Min. → zwei Summenzeilen 525 und 504 (vorher eine mit 1029)
    const [b] = temporaerBueroBlaetter([e('2026-11-23', ben, 504, 21), e('2026-11-23', ben2, 504, 0)]);
    expect(b.personen.length).toBe(2);
    expect(b.personen.map((p) => p.total_min).sort()).toEqual([504, 525]);
    expect(new Set(b.personen.map((p) => p.name)).size).toBe(2);
    expect(b.zeilen.every((z) => /^Ben Temp \([12]\)$/.test(z.name))).toBe(true);
  });
});

describe('Excel (echter Baustein, wieder eingelesen)', () => {
  let datei: Blob | null = null;
  const echt = { create: URL.createObjectURL, doc: (globalThis as { document?: unknown }).document };
  beforeEach(() => {
    datei = null;
    URL.createObjectURL = ((b: Blob) => { datei = b; return 'blob:test'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ click() {}, remove() {}, set href(_: string) {}, set download(_: string) {} }),
      body: { appendChild() {} },
    };
  });
  afterEach(() => {
    URL.createObjectURL = echt.create;
    (globalThis as { document?: unknown }).document = echt.doc;
  });

  it('Temporärbüro-Excel: jede Zeile genau einmal, Summen stimmen, Stunden mit zwei Stellen', async () => {
    // Ben: Mo 504+21 (Konto 900001), Di 285 (900001) + 240 (900002) → drei Zeilen
    // Normal 504 + 285 + 219 = 1008 = 16.80 h; Über 21 + 21 = 42 = 0.70 h; Total 1050 = 17.50 h
    const [b] = temporaerBueroBlaetter([
      e('2026-11-23', ben, 504, 21), e('2026-11-24', ben, 285, 0, '900001'), e('2026-11-24', ben, 219, 21, '900002'),
    ]);
    await bueroExcel(b, { zeitraum: 'KW 48', filter: [] }, 'test.xlsx');
    expect(datei).not.toBeNull();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await datei!.arrayBuffer());
    const ws = wb.worksheets[0];
    const werte: unknown[][] = [];
    ws.eachRow((r) => werte.push((r.values as unknown[]).slice(1)));
    const datenZeilen = werte.filter((r) => r[0] === 'Ben Temp');
    expect(datenZeilen.length).toBe(3 + 1); // 3 Tageszeilen + 1 Zeile in «Summe je Person»
    const summeZeile = werte.find((r) => typeof r[0] === 'string' && (r[0] as string).startsWith('Summe Ben'));
    const ergebnis = (v: unknown) => (typeof v === 'object' && v && 'result' in v ? (v as { result: number }).result : v);
    expect(summeZeile?.slice(4, 7).map(ergebnis)).toEqual([16.8, 0.7, 17.5]);
    // Format der Stundenspalten
    const zelle = ws.getRow(5).getCell(5);
    expect(zelle.numFmt).toMatch(/0\.00/);
  });
});
