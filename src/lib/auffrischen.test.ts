import { describe, it, expect } from 'vitest';
import { auffrischer, neuesteAnfrage } from './auffrischen';

describe('neuesteAnfrage — wer zuletzt fragt, gewinnt', () => {
  it('nur die jüngste Anfrage ist aktuell', () => {
    const anfrage = neuesteAnfrage();
    const a = anfrage();
    expect(a()).toBe(true);
    const b = anfrage();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
  });

  it('zwei Seiten zählen getrennt', () => {
    const x = neuesteAnfrage();
    const y = neuesteAnfrage();
    const a = x();
    y();
    expect(a()).toBe(true);
  });
});

describe('auffrischer — nie zwei Läufe gleichzeitig, nicht zu oft', () => {
  it('überspringt, solange ein Lauf läuft, und hält den Mindestabstand', async () => {
    let zeit = 0;
    let laeufe = 0;
    let fertig: () => void = () => {};
    const los = auffrischer(() => { laeufe++; return new Promise<void>((r) => { fertig = r; }); }, 10_000, () => zeit);
    // gleich nach dem Öffnen: die Seite hat eben selbst geladen
    expect(await los()).toBe(false);
    zeit = 20_000;
    const erster = los();
    zeit = 40_000;
    expect(await los()).toBe(false); // läuft noch
    fertig();
    expect(await erster).toBe(true);
    expect(laeufe).toBe(1);
    zeit = 25_000;
    expect(await los()).toBe(false); // erst 5 s seit dem letzten Start
    zeit = 31_000;
    const zweiter = los();
    fertig();
    expect(await zweiter).toBe(true);
    expect(laeufe).toBe(2);
  });

  it('ein Fehler beim Laden blockiert den nächsten Lauf nicht', async () => {
    let zeit = 0;
    let laeufe = 0;
    const los = auffrischer(() => { laeufe++; throw new Error('Zeitüberschreitung'); }, 1000, () => zeit);
    zeit = 5000;
    expect(await los()).toBe(true);
    zeit = 10_000;
    expect(await los()).toBe(true);
    expect(laeufe).toBe(2);
  });
});
