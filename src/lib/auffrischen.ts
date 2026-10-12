/**
 * Büroseiten bleiben stundenlang offen (13.10.2026): der Bauführer lässt die Wochenübersicht im Tab stehen, das
 * Sekretariat die Startseite. Ohne Auffrischen zeigen sie den Stand vom Morgen — «alles freigegeben», obwohl am
 * Nachmittag drei Teams gemeldet haben.
 *
 * - `useAuffrischen(laden)`: lädt neu, sobald die Seite wieder sichtbar wird (Tab zurück, Fenster im Vordergrund) und
 *   alle 5 Minuten, solange sie sichtbar ist. Nie zwei Läufe gleichzeitig, und nicht öfter als alle 10 Sekunden.
 * - `neuesteAnfrage()`: wer zuletzt fragt, gewinnt. Wechselt jemand schnell die Woche, darf die langsame Antwort der
 *   alten Woche die neue nicht überschreiben.
 */
import { useEffect, useRef } from 'react';

export const AUFFRISCHEN_MS = 5 * 60 * 1000;
/** Fokus und «sichtbar» kommen oft zusammen — ein Lauf genügt. */
export const MINDESTABSTAND_MS = 10 * 1000;

/**
 * Zähler für Anfragen: `const aktuell = anfrage();` vor dem Laden, nach jeder Antwort `if (!aktuell()) return;`.
 * Nur die jüngste Anfrage bekommt `true`.
 */
export function neuesteAnfrage(): () => () => boolean {
  let zaehler = 0;
  return () => {
    const nr = ++zaehler;
    return () => nr === zaehler;
  };
}

/** `neuesteAnfrage()` einmal je Seite (bleibt über alle Darstellungen derselbe Zähler). */
export function useNeuesteAnfrage(): () => () => boolean {
  const ref = useRef<(() => () => boolean) | null>(null);
  if (!ref.current) ref.current = neuesteAnfrage();
  return ref.current;
}

/**
 * Der Auslöser ohne React (testbar): führt `laden` aus, ausser es läuft schon oder der letzte Start ist weniger als
 * `abstandMs` her. Gibt zurück, ob gestartet wurde. Fehler bleiben bei der Seite — sie zeigt sie selbst an.
 */
export function auffrischer(laden: () => unknown, abstandMs = MINDESTABSTAND_MS, jetzt: () => number = Date.now): () => Promise<boolean> {
  let laeuft = false;
  // Gerade erst geladen (die Seite lädt beim Öffnen selbst) — ein Fokus gleich danach braucht keinen zweiten Lauf
  let zuletzt = jetzt();
  return async () => {
    if (laeuft || jetzt() - zuletzt < abstandMs) return false;
    laeuft = true;
    zuletzt = jetzt();
    try {
      await laden();
    } catch {
      /* die Seite zeigt ihre Fehler selbst */
    } finally {
      laeuft = false;
    }
    return true;
  };
}

/**
 * Neu laden, wenn die Seite wieder sichtbar wird, und alle `abstandMs`, solange sie sichtbar ist. `laden` sollte still
 * laden (ohne «Lädt …» über der Seite) — sonst springt der Bildschirm alle fünf Minuten.
 */
export function useAuffrischen(laden: () => unknown, abstandMs = AUFFRISCHEN_MS): void {
  const ref = useRef(laden);
  useEffect(() => { ref.current = laden; });
  useEffect(() => {
    const los = auffrischer(() => ref.current());
    const sichtbar = () => document.visibilityState === 'visible';
    const wiederDa = () => { if (sichtbar()) void los(); };
    document.addEventListener('visibilitychange', wiederDa);
    window.addEventListener('focus', wiederDa);
    const takt = window.setInterval(wiederDa, abstandMs);
    return () => {
      document.removeEventListener('visibilitychange', wiederDa);
      window.removeEventListener('focus', wiederDa);
      window.clearInterval(takt);
    };
  }, [abstandMs]);
}
