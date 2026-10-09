import { describe, it, expect } from 'vitest';
import { benutzername, kontoAdresse, passwortVorschlag, ERSATZ_DOMAIN, rolleVorschlag, darfVergeben, FUNKTION_BUERO, KONTO_ROLLEN } from './benutzername';

describe('rolleVorschlag', () => {
  it('leitet die Rolle aus der Funktion ab', () => {
    expect(rolleVorschlag(FUNKTION_BUERO)).toBe('sekretariat');
    expect(rolleVorschlag('bauf')).toBe('bauf');
    expect(rolleVorschlag('gruppe')).toBe('chef');
    expect(rolleVorschlag('objekt')).toBe('chef');
    expect(rolleVorschlag('monteur')).toBe('monteur');
    expect(rolleVorschlag('lern2')).toBe('monteur');
  });
});

describe('darfVergeben', () => {
  it('Firmen-Zugang und Sekretariat dürfen alle vier Rollen', () => {
    for (const r of KONTO_ROLLEN) {
      expect(darfVergeben(null, r.key)).toBe(true);
      expect(darfVergeben('sekretariat', r.key)).toBe(true);
    }
  });
  it('der Bauführer alles ausser Sekretariat — Lohn sieht nur das Sekretariat', () => {
    expect(darfVergeben('bauf', 'monteur')).toBe(true);
    expect(darfVergeben('bauf', 'chef')).toBe(true);
    expect(darfVergeben('bauf', 'bauf')).toBe(true);
    expect(darfVergeben('bauf', 'sekretariat')).toBe(false);
  });
  it('Monteur und Chefmonteur gar nichts', () => {
    for (const r of KONTO_ROLLEN) {
      expect(darfVergeben('monteur', r.key)).toBe(false);
      expect(darfVergeben('chef', r.key)).toBe(false);
    }
  });
});

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
