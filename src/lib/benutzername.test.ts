import { describe, it, expect } from 'vitest';
import { benutzername, kontoAdresse, passwortVorschlag, ERSATZ_DOMAIN } from './benutzername';

describe('benutzername', () => {
  it('macht vorname.nachname', () => {
    expect(benutzername('Ismail Vaiti')).toBe('ismail.vaiti');
    expect(benutzername('  Nuhi   Vaiti ')).toBe('nuhi.vaiti');
  });
  it('schreibt Umlaute aus und streicht Akzente', () => {
    expect(benutzername('Jürg Müller')).toBe('juerg.mueller');
    expect(benutzername('Gonçalo Simões')).toBe('goncalo.simoes');
    expect(benutzername('Krzysztof Wąsik')).toBe('krzysztof.wasik');
  });
  it('macht aus Bindestrich und Sonderzeichen einen Punkt', () => {
    expect(benutzername('Anna-Lena Graf')).toBe('anna.lena.graf');
    expect(benutzername("D'Amico, Luca")).toBe('d.amico.luca');
  });
});

describe('kontoAdresse', () => {
  it('nimmt die Domain der Firma', () => {
    expect(kontoAdresse('Arbnor Arifi', 'geruest.ch')).toBe('arbnor.arifi@geruest.ch');
    expect(kontoAdresse('Ismail Vaiti', ' Geruest.CH ')).toBe('ismail.vaiti@geruest.ch');
  });
  it('fällt ohne Domain auf die Ersatz-Domain zurück', () => {
    expect(kontoAdresse('Nuhi Vaiti', null)).toBe(`nuhi.vaiti@${ERSATZ_DOMAIN}`);
    expect(kontoAdresse('Nuhi Vaiti', '')).toBe(`nuhi.vaiti@${ERSATZ_DOMAIN}`);
  });
});

describe('passwortVorschlag', () => {
  it('hat Wort-Bindestrich-vier Ziffern und mindestens 8 Zeichen', () => {
    for (let i = 0; i < 50; i++) {
      const p = passwortVorschlag();
      expect(p).toMatch(/^[A-Z][a-z]+-\d{4}$/);
      expect(p.length).toBeGreaterThanOrEqual(8);
    }
  });
  it('bleibt bei Zufall nahe 1 im Bereich', () => {
    expect(passwortVorschlag(() => 0.9999)).toBe('Riegel-9999');
  });
});
