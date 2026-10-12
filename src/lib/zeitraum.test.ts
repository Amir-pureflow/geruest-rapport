import { describe, it, expect } from 'vitest';
import { iso } from './datum';
import { ankerAusUrl, ankerFuer, ersteWocheImMonat, jahresBereich, monatBlaettern, monatDerWoche, monatsErster } from './zeitraum';

const tag = (s: string) => new Date(`${s}T12:00:00`);

describe('zeitraum — Woche oder Monat im Export', () => {
  it('blättert vom 1. aus durch alle Monate, auch über den Jahreswechsel', () => {
    let m = monatsErster(tag('2026-10-13'));
    const vor: string[] = [];
    for (let i = 0; i < 4; i++) { m = monatBlaettern(m, 1); vor.push(iso(m)); }
    // Vorher blieb «Monat ›» im Oktober hängen: montag(1.11.2026) = 26.10.
    expect(vor).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
    m = monatsErster(tag('2026-03-31'));
    const zurueck: string[] = [];
    for (let i = 0; i < 4; i++) { m = monatBlaettern(m, -1); zurueck.push(iso(m)); }
    expect(zurueck).toEqual(['2026-02-01', '2026-01-01', '2025-12-01', '2025-11-01']);
  });

  it('eine Woche gehört dem Monat ihres Donnerstags', () => {
    expect(iso(monatDerWoche(tag('2026-10-26')))).toBe('2026-10-01'); // Do 29.10.
    expect(iso(monatDerWoche(tag('2026-09-28')))).toBe('2026-10-01'); // Do 1.10.
    expect(iso(monatDerWoche(tag('2026-12-28')))).toBe('2026-12-01'); // KW 53: Do 31.12.
  });

  it('erste Woche im Monat: die erste mit Donnerstag im Monat', () => {
    expect(iso(ersteWocheImMonat(tag('2026-11-01')))).toBe('2026-11-02'); // So 1.11. → Mo 2.11.
    expect(iso(ersteWocheImMonat(tag('2026-10-01')))).toBe('2026-09-28'); // Do 1.10. gehört schon dazu
    expect(iso(ersteWocheImMonat(tag('2026-06-01')))).toBe('2026-06-01'); // Mo 1.6.
  });

  it('Umschalten normalisiert den Anker — Monat → Woche → Monat bleibt beim selben Monat', () => {
    expect(iso(ankerFuer(tag('2026-10-26'), 'monat'))).toBe('2026-10-01');
    expect(iso(ankerFuer(tag('2026-09-28'), 'monat'))).toBe('2026-10-01');
    expect(iso(ankerFuer(tag('2026-06-01'), 'monat'))).toBe('2026-06-01');
    for (const erster of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-06-01', '2026-11-01', '2027-01-01']) {
      const woche = ankerFuer(tag(erster), 'woche');
      expect(woche.getDay()).toBe(1);
      expect(iso(ankerFuer(woche, 'monat'))).toBe(erster);
    }
    expect(iso(ankerFuer(tag('2026-10-14'), 'woche'))).toBe('2026-10-12');
  });

  it('liest den Monat aus der Adresse: der 1., und alte Links mit einem Montag', () => {
    const heute = tag('2026-10-14');
    expect(iso(ankerAusUrl('2026-11-01', 'monat', heute))).toBe('2026-11-01');
    // Alter Link der Sekretariats-Startseite: woche=montag(1.11.) = 26.10. → gemeint war der November
    expect(iso(ankerAusUrl('2026-10-26', 'monat', heute))).toBe('2026-11-01');
    expect(iso(ankerAusUrl('2026-09-28', 'monat', heute))).toBe('2026-10-01');
    // Montag ohne 1. in seiner Woche: Monat des Datums
    expect(iso(ankerAusUrl('2026-10-05', 'monat', heute))).toBe('2026-10-01');
    expect(iso(ankerAusUrl('2026-10-15', 'woche', heute))).toBe('2026-10-12');
  });

  it('ohne Datum: aktuelle Woche, am Montag und Dienstag die Vorwoche', () => {
    expect(iso(ankerAusUrl(null, 'woche', tag('2026-10-14')))).toBe('2026-10-12'); // Mi
    expect(iso(ankerAusUrl(null, 'woche', tag('2026-10-13')))).toBe('2026-10-05'); // Di
    expect(iso(ankerAusUrl('kaputt', 'woche', tag('2026-10-12')))).toBe('2026-10-05'); // Mo
    expect(iso(ankerAusUrl(null, 'monat', tag('2026-10-14')))).toBe('2026-10-01');
    // Di 3.11.: Vorwoche 26.10.–1.11. gehört dem Oktober — der Monat, der noch abgeschlossen wird
    expect(iso(ankerAusUrl(null, 'monat', tag('2026-11-03')))).toBe('2026-10-01');
  });

  it('Überstunden seit 1. Januar: Jahr des Beginns, höchstens bis 31.12.', () => {
    expect(jahresBereich('2026-10-12', '2026-10-18')).toEqual({ jahr: '2026', von: '2026-01-01', bis: '2026-10-18' });
    // KW 53: Montag 28.12.2026 bis Sonntag 3.1.2027
    expect(jahresBereich('2026-12-28', '2027-01-03')).toEqual({ jahr: '2026', von: '2026-01-01', bis: '2026-12-31' });
    expect(jahresBereich('2026-12-01', '2026-12-31')).toEqual({ jahr: '2026', von: '2026-01-01', bis: '2026-12-31' });
  });
});
