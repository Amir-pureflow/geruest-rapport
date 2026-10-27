import { describe, it, expect } from 'vitest';
import { warnungen, warnungenZusammen, wetterArt, wetterText, type WetterTag } from './wetter';

const tag = (o: Partial<WetterTag>): WetterTag => ({ datum: '2026-10-28', symbol: 3, tmax: 12, tmin: 5, regen_mm: 0, boe_kmh: 20, ...o });

describe('wetterArt — Piktogramm-Nummern von MeteoSchweiz', () => {
  it('Tag- und Nachtnummern, sonst nach Regen und Temperatur', () => {
    expect(wetterArt(tag({ symbol: 1 }))).toBe('sonnig');
    expect(wetterArt(tag({ symbol: 33 }))).toBe('regen');
    expect(wetterArt(tag({ symbol: 22 }))).toBe('schnee');
    expect(wetterArt(tag({ symbol: 123 }))).toBe('gewitter'); // Nacht = Tag + 100
    expect(wetterArt(tag({ symbol: null, regen_mm: 6, tmax: 0 }))).toBe('schnee');
    expect(wetterArt(tag({ symbol: 99, regen_mm: 6 }))).toBe('regen'); // unbekannt: nach der Menge
  });
});

describe('warnungen — was fürs Gerüst zählt', () => {
  it('ruhiger Tag: nichts', () => {
    expect(warnungen(tag({}))).toEqual([]);
    expect(warnungen(tag({ regen_mm: 1.5, boe_kmh: 45 }))).toEqual([]);
  });
  it('Sturm vor Regen, Wind erst ab 50 km/h', () => {
    const w = warnungen(tag({ symbol: 20, regen_mm: 14, boe_kmh: 82 }));
    expect(w.map((x) => x.art)).toEqual(['sturm', 'starkregen']);
    expect(w[0].text).toBe('Sturm, Böen bis 82 km/h');
    expect(warnungen(tag({ boe_kmh: 55 }))[0]).toMatchObject({ art: 'wind', stark: false });
  });
  it('Regen ab 2 mm, Schnee und Gewitter nach dem Symbol, Frost ab −2 °C', () => {
    expect(warnungen(tag({ symbol: 17, regen_mm: 4.1 }))[0].text).toBe('Regen, 4.1 mm');
    expect(warnungen(tag({ symbol: 19, regen_mm: 6, tmax: -1 })).map((x) => x.art)).toEqual(['schnee']);
    expect(warnungen(tag({ symbol: 13 })).map((x) => x.art)).toEqual(['gewitter']);
    expect(warnungen(tag({ tmin: -3 }))[0]).toMatchObject({ art: 'frost', text: 'Frost, bis -3 °C' });
  });
});

describe('wetterText', () => {
  it('Art, Temperatur, Regen und Böen in einer Zeile', () => {
    expect(wetterText(tag({ symbol: 9, tmin: 6.6, tmax: 13.9, regen_mm: 4.1, boe_kmh: 72.7 }))).toBe('Regen · 7–14 °C · 4.1 mm · Böen bis 73 km/h');
    expect(wetterText(tag({ symbol: 1, tmin: 3.9, tmax: 14.9, regen_mm: 0, boe_kmh: 9 }))).toBe('sonnig · 4–15 °C');
  });
});

describe('warnungenZusammen — Team mit zwei Baustellen am Tag', () => {
  it('jede Art einmal, die stärkere zählt, Reihenfolge nach Wichtigkeit', () => {
    const a = tag({ symbol: 17, regen_mm: 3 });
    const b = tag({ symbol: 20, regen_mm: 12, boe_kmh: 60 });
    expect(warnungenZusammen([a, b]).map((x) => x.art)).toEqual(['starkregen', 'wind', 'regen']);
  });
});
