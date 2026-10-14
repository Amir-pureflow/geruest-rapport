import { describe, expect, it } from 'vitest';
import { englischGewaehlt, uebersetzen } from './englisch';

describe('Englische Oberfläche (nur Demo-Firma)', () => {
  it('übersetzt feste Texte und lässt Leerraum vorn und hinten stehen', () => {
    expect(uebersetzen('Tag melden')).toBe('Report day');
    expect(uebersetzen(' Tag melden ')).toBe(' Report day ');
    expect(uebersetzen('Wochenübersicht')).toBe('Week overview');
  });
  it('übersetzt Texte mit Zahlen und Daten über Muster', () => {
    expect(uebersetzen('Fr 9.10.2026')).toBe('Fri 9.10.2026');
    expect(uebersetzen('16 von 20')).toBe('16 of 20');
    expect(uebersetzen('Alle 42 Tage ohne Hinweis freigeben')).toBe('Approve all 42 days without a flag');
    expect(uebersetzen('Luca Russo ist in Team 4')).toBe('Luca Russo is in Team 4');
    expect(uebersetzen('Heute · Fr 9. Okt.')).toBe('Today · Fri 9 Oct');
    expect(uebersetzen('Dienstag (morgen):')).toBe('Tuesday (tomorrow):');
    expect(uebersetzen('Gespeichert ✓ und gesendet')).toBe('Saved ✓ and sent');
  });
  it('lässt Namen, Baustellen und Unbekanntes unverändert', () => {
    expect(uebersetzen('Neubau Wankdorffeld, Baufeld C')).toBeNull();
    expect(uebersetzen('Francesco Gallo')).toBeNull();
    expect(uebersetzen('')).toBeNull();
  });
  it('ist ohne Schalter aus (echte Firmen und Geräte ohne Wahl bleiben deutsch)', () => {
    expect(englischGewaehlt()).toBe(false);
  });
});
