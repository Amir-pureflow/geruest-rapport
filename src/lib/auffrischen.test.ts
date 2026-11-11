import { describe, it, expect, vi } from 'vitest';
import { auffrischer, liveAusloeser, neuesteAnfrage } from './auffrischen';

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

describe('liveAusloeser — Änderungen aus der Datenbank (11.11.2026)', () => {
  const warten = () => new Promise((r) => setTimeout(r, 0));

  it('fünf Änderungen kurz hintereinander = ein Laden', async () => {
    vi.useFakeTimers();
    let n = 0;
    const live = liveAusloeser(() => { n++; }, () => true, 1500);
    for (let i = 0; i < 5; i++) { live.aenderung(); vi.advanceTimersByTime(300); }
    expect(n).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(n).toBe(1);
    vi.useRealTimers();
  });

  it('versteckte Seite lädt nicht, holt es beim Zurückkommen einmal nach', async () => {
    vi.useFakeTimers();
    let n = 0;
    let sichtbar = false;
    const live = liveAusloeser(() => { n++; }, () => sichtbar, 1500);
    live.aenderung(); live.aenderung();
    vi.advanceTimersByTime(5000);
    expect(n).toBe(0);
    sichtbar = true;
    expect(live.sichtbarGeworden()).toBe(true);
    expect(n).toBe(1);
    expect(live.sichtbarGeworden()).toBe(false);
    vi.useRealTimers();
  });

  it('Änderung während eines Ladens: genau ein Lauf danach', async () => {
    let n = 0;
    let fertig: () => void = () => undefined;
    const live = liveAusloeser(() => { n++; return new Promise<void>((r) => { fertig = r; }); }, () => true, 0);
    live.wiederVerbunden();
    expect(n).toBe(1);
    live.wiederVerbunden(); live.wiederVerbunden();
    fertig();
    await warten(); await warten();
    expect(n).toBe(2);
    fertig();
    await warten(); await warten();
    expect(n).toBe(2);
  });

  it('ein Fehler beim Laden stoppt nichts', async () => {
    let n = 0;
    const live = liveAusloeser(() => { n++; throw new Error('kein Netz'); }, () => true, 0);
    live.wiederVerbunden();
    await warten();
    live.wiederVerbunden();
    await warten();
    expect(n).toBe(2);
  });
});
