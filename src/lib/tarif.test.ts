import { describe, it, expect } from 'vitest';
import {
  positionBetrag,
  minutenBetrag,
  stundenZuHundertstel,
  materialmiete,
  rechneRegie,
  formatChf,
  tarifNachCode,
  modellfallVersetzen,
  ETAPPE_MIN_RAPPEN,
} from './tarif';

describe('Referenzfall «Gerüst versetzen» (Konzept Anhang B)', () => {
  it('ergibt exakt Fr. 955.93', () => {
    const r = modellfallVersetzen();
    expect(r.positionen[0].betragRappen).toBe(43200); // 2×2h×108.–
    expect(r.positionen[1].betragRappen).toBe(16500); // Lieferwagen 1h
    expect(r.positionen[2].betragRappen).toBe(28000); // Etappe
    expect(r.zwischenRappen).toBe(87700);
    expect(r.materialmieteRappen).toBe(7893); // 9 %
    expect(r.totalRappen).toBe(95593);
    expect(formatChf(r.totalRappen)).toBe('Fr. 955.93');
  });

  it('alle Beträge sind Integer (nie Floats)', () => {
    const r = modellfallVersetzen();
    for (const p of r.positionen) expect(Number.isInteger(p.betragRappen)).toBe(true);
    expect(Number.isInteger(r.zwischenRappen)).toBe(true);
    expect(Number.isInteger(r.materialmieteRappen)).toBe(true);
    expect(Number.isInteger(r.totalRappen)).toBe(true);
  });
});

describe('positionBetrag', () => {
  it('rechnet Hundertstel-Mengen korrekt', () => {
    expect(positionBetrag({ code: 'x', bezeichnung: '', mengeHundertstel: 400, ansatzRappen: 10800 })).toBe(43200);
    expect(positionBetrag({ code: 'x', bezeichnung: '', mengeHundertstel: 150, ansatzRappen: 10000 })).toBe(15000); // 1.5 h Mitarbeiter
    expect(positionBetrag({ code: 'x', bezeichnung: '', mengeHundertstel: 1200, ansatzRappen: 160 })).toBe(1920); // 12 km PW
  });

  it('wirft bei Nicht-Integern', () => {
    expect(() => positionBetrag({ code: 'x', bezeichnung: '', mengeHundertstel: 150.5, ansatzRappen: 10000 })).toThrow();
    expect(() => positionBetrag({ code: 'x', bezeichnung: '', mengeHundertstel: 100, ansatzRappen: 108.5 })).toThrow();
  });
});

describe('minutenBetrag', () => {
  it('rechnet Minuten × Stundenansatz', () => {
    expect(minutenBetrag(120, 10800)).toBe(21600); // 2 h Monteur
    expect(minutenBetrag(90, 10800)).toBe(16200); // 1.5 h
    expect(minutenBetrag(50, 16800)).toBe(14000); // 50 min Bauführer
  });

  it('rundet auf ganze Rappen', () => {
    expect(minutenBetrag(1, 10000)).toBe(167); // 166.66… → 167
    expect(Number.isInteger(minutenBetrag(7, 12345))).toBe(true);
  });
});

describe('stundenZuHundertstel', () => {
  it('wandelt korrekt', () => {
    expect(stundenZuHundertstel(2)).toBe(200);
    expect(stundenZuHundertstel(2.5)).toBe(250);
    expect(stundenZuHundertstel(0.25)).toBe(25);
  });
});

describe('materialmiete', () => {
  it('9 % vom Zwischenbetrag, gerundet', () => {
    expect(materialmiete(87700)).toBe(7893);
    expect(materialmiete(100)).toBe(9);
    expect(materialmiete(50)).toBe(5); // 4.5 → 5
  });
});

describe('rechneRegie ohne Materialmiete', () => {
  it('lässt die Miete weg, wenn abgewählt', () => {
    const r = rechneRegie(
      [{ code: 'monteur', bezeichnung: '', mengeHundertstel: 100, ansatzRappen: 10800 }],
      { mitMaterialmiete: false },
    );
    expect(r.materialmieteRappen).toBe(0);
    expect(r.totalRappen).toBe(10800);
  });
});

describe('formatChf', () => {
  it('formatiert mit Schweizer Tausendertrennzeichen', () => {
    expect(formatChf(95593)).toBe('Fr. 955.93');
    expect(formatChf(1150000)).toBe("Fr. 11'500.00");
    expect(formatChf(5)).toBe('Fr. 0.05');
    expect(formatChf(0)).toBe('Fr. 0.00');
    expect(formatChf(-16800)).toBe('-Fr. 168.00');
    expect(formatChf(123456789)).toBe("Fr. 1'234'567.89");
  });
});

describe('Fixture-Integrität', () => {
  it('kennt die zentralen SGUV-Ansätze 2026/27', () => {
    expect(tarifNachCode('bauf').ansatz_rappen).toBe(16800);
    expect(tarifNachCode('monteur').ansatz_rappen).toBe(10800);
    expect(tarifNachCode('lieferwagen_35').ansatz_rappen).toBe(16500);
    expect(tarifNachCode('pw_km').ansatz_rappen).toBe(160);
    expect(ETAPPE_MIN_RAPPEN).toBe(28000);
  });

  it('wirft bei unbekanntem Code', () => {
    expect(() => tarifNachCode('gibts_nicht')).toThrow();
  });
});
