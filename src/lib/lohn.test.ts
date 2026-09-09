import { describe, it, expect } from 'vitest';
import {
  lohnZeilen,
  wochenSpalten,
  wochenImMonat,
  monatsGrenzen,
  monatsSpalten,
  temporaerBueroBlaetter,
  ueberstunden,
  blattName,
  type LohnEintrag,
  type LohnPerson,
} from './lohn';
import { iso } from './datum';

const huber: LohnPerson = { id: 'p1', name: 'Huber Peter', typ: 'intern', temporaerbuero: null };
const ali: LohnPerson = { id: 'p2', name: 'Ali Kamal', typ: 'temporaer', temporaerbuero: 'Adecco' };
const nowak: LohnPerson = { id: 'p3', name: 'Nowak Piotr', typ: 'temporaer', temporaerbuero: 'Manpower' };

function e(p: LohnPerson, datum: string, normal: number, ueber = 0, extra: Partial<LohnEintrag> = {}): LohnEintrag {
  return { datum, mitarbeiter: p, normal_min: normal, ueber_min: ueber, oev: false, km: 0, konto_nr: '903673', ...extra };
}

// KW 37/2026: Mo 7.9. – So 13.9.
const MO = '2026-09-07';
const DI = '2026-09-08';
const MI = '2026-09-09';

describe('lohnZeilen — Person × Tag', () => {
  it('summiert Minuten je Tag und je Person, Integer bleiben Integer', () => {
    const z = lohnZeilen([
      e(huber, MO, 480), e(huber, MO, 60, 30, { konto_nr: '903674' }), e(huber, DI, 450),
      e(ali, MO, 480, 60),
    ]);
    expect(z.map((x) => x.person.name)).toEqual(['Ali Kamal', 'Huber Peter']);
    const h = z[1];
    expect(h.proTag[MO]).toBe(570);
    expect(h.proTag[DI]).toBe(450);
    expect(h.normal_min).toBe(990);
    expect(h.ueber_min).toBe(30);
    expect(h.total_min).toBe(1020);
    for (const v of Object.values(h.proTag)) expect(Number.isInteger(v)).toBe(true);
  });

  it('ordnet die Tage der Woche Mo–So zu', () => {
    const z = lohnZeilen([e(huber, MO, 480), e(huber, MI, 240), e(huber, '2026-09-13', 120)]);
    expect(wochenSpalten(z[0], new Date(2026, 8, 7))).toEqual([480, 0, 240, 0, 0, 0, 120]);
    // Wochenstart darf auch mitten in der Woche liegen — es zählt der Montag
    expect(wochenSpalten(z[0], new Date(2026, 8, 10))).toEqual([480, 0, 240, 0, 0, 0, 120]);
  });

  it('zählt öV und km pro Tag nur einmal, auch bei zwei Konten am selben Tag', () => {
    const z = lohnZeilen([
      e(huber, MO, 240, 0, { km: 30 }), e(huber, MO, 240, 0, { km: 30, konto_nr: '903674' }),
      e(huber, DI, 480, 0, { oev: true }), e(huber, DI, 60, 0, { oev: true, konto_nr: '903674' }),
      e(huber, MI, 480, 0, { oev: true }),
    ]);
    expect(z[0].km).toBe(30);
    expect(z[0].oevTage).toBe(2);
  });

  it('wirft bei Dezimalminuten', () => {
    expect(() => lohnZeilen([e(huber, MO, 7.5)])).toThrow(/ganzzahlig/);
  });
});

describe('Monat', () => {
  it('liefert alle Montage, deren Woche den Monat berührt', () => {
    const w = wochenImMonat(2026, 8).map(iso); // September 2026: 1.9. ist ein Dienstag
    expect(w[0]).toBe('2026-08-31');
    expect(w[w.length - 1]).toBe('2026-09-28');
    expect(w).toHaveLength(5);
    expect(monatsGrenzen(2026, 8)).toEqual({ von: '2026-09-01', bis: '2026-09-30' });
  });

  it('summiert je Woche', () => {
    const z = lohnZeilen([e(huber, '2026-09-01', 480), e(huber, MO, 480), e(huber, DI, 120), e(huber, '2026-09-30', 60)]);
    const wochen = wochenImMonat(2026, 8);
    expect(monatsSpalten(z[0], wochen)).toEqual([480, 600, 0, 0, 60]);
    expect(z[0].total_min).toBe(1140);
  });
});

describe('temporaerBueroBlaetter — je Büro ein Blatt', () => {
  it('gruppiert nach Büro, Person × Tag × Konto, mit Personensummen', () => {
    const b = temporaerBueroBlaetter([
      e(huber, MO, 480),
      e(ali, MO, 480, 60), e(ali, MO, 60, 0, { konto_nr: '903674' }), e(ali, DI, 480),
      e(nowak, MO, 420),
      e({ ...ali, id: 'p4', name: 'Baum Leo', temporaerbuero: 'Adecco' }, DI, 300),
    ]);
    expect(b.map((x) => x.buero)).toEqual(['Adecco', 'Manpower']);
    const adecco = b[0];
    expect(adecco.zeilen.map((z) => [z.name, z.datum, z.konto_nr, z.normal_min, z.ueber_min])).toEqual([
      ['Ali Kamal', MO, '903673', 480, 60],
      ['Ali Kamal', MO, '903674', 60, 0],
      ['Ali Kamal', DI, '903673', 480, 0],
      ['Baum Leo', DI, '903673', 300, 0],
    ]);
    expect(adecco.personen).toEqual([
      { name: 'Ali Kamal', normal_min: 1020, ueber_min: 60, total_min: 1080 },
      { name: 'Baum Leo', normal_min: 300, ueber_min: 0, total_min: 300 },
    ]);
    expect(adecco.total_min).toBe(1380);
    expect(b[1].total_min).toBe(420);
  });

  it('Festangestellte erscheinen nicht; Temporäre ohne Büro landen unter «ohne Büro»', () => {
    const b = temporaerBueroBlaetter([e(huber, MO, 480), e({ ...ali, temporaerbuero: null }, MO, 480)]);
    expect(b).toHaveLength(1);
    expect(b[0].buero).toBe('ohne Büro');
  });
});

describe('ueberstunden — Zeitraum und seit Jahresbeginn', () => {
  it('summiert ueber_min getrennt, Personen aus beiden Mengen', () => {
    const zeitraum = [e(huber, MO, 480, 60), e(huber, DI, 480, 30)];
    const jahr = [e(huber, '2026-01-12', 480, 120), ...zeitraum, e(ali, '2026-03-03', 480, 45)];
    const u = ueberstunden(zeitraum, jahr);
    expect(u).toEqual([
      { person: ali, zeitraum_min: 0, jahr_min: 45 },
      { person: huber, zeitraum_min: 90, jahr_min: 210 },
    ]);
  });
});

describe('blattName', () => {
  it('kürzt, säubert und macht eindeutig', () => {
    const v = new Set<string>();
    expect(blattName('Adecco', v)).toBe('Adecco');
    expect(blattName('Adecco', v)).toBe('Adecco 2');
    expect(blattName('Man/power: Bern [AG]', v)).toBe('Man power  Bern  AG');
    expect(blattName('Ein sehr langer Name eines Temporärbüros AG', v).length).toBeLessThanOrEqual(31);
  });
});
