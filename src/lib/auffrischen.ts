/**
 * Büroseiten bleiben stundenlang offen (13.10.2026): der Bauführer lässt die Wochenübersicht im Tab stehen, das
 * Sekretariat die Startseite. Ohne Auffrischen zeigen sie den Stand vom Morgen — «alles freigegeben», obwohl am
 * Nachmittag drei Teams gemeldet haben.
 *
 * - `useAuffrischen(laden)`: lädt neu, sobald die Seite wieder sichtbar wird (Tab zurück, Fenster im Vordergrund) und
 *   alle 5 Minuten, solange sie sichtbar ist. Nie zwei Läufe gleichzeitig, und nicht öfter als alle 10 Sekunden.
 * - `neuesteAnfrage()`: wer zuletzt fragt, gewinnt. Wechselt jemand schnell die Woche, darf die langsame Antwort der
 *   alten Woche die neue nicht überschreiben.
 *
 * Live (Arbnor, 11.11.2026): «Meldet der Chefmonteur, muss der Bauführer es sofort sehen.» `useAuffrischen` hört
 * zusätzlich über Supabase Realtime auf die Tabellen mit Meldungen, Stunden, Fotos, Planung … und lädt wenige
 * Sekunden nach einer Änderung neu. Schonend: eine Verbindung je Seite, mehrere Änderungen kurz hintereinander
 * (eine Meldung mit fünf Leuten = sechs Zeilen) geben einen einzigen Lauf, und eine Seite im Hintergrund lädt erst,
 * wenn man sie wieder anschaut. Reisst die Live-Verbindung ab, lädt die Seite jede Minute, bis sie wieder steht.
 */
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

export const AUFFRISCHEN_MS = 5 * 60 * 1000;
/** Ohne Live-Verbindung: so oft nachschauen. */
export const OHNE_LIVE_MS = 60 * 1000;
/** Änderungen so lange sammeln, bevor neu geladen wird. */
export const LIVE_SAMMELN_MS = 1500;
/** Tabellen, deren Änderungen die Büroseiten sofort zeigen (Migration 0055). */
export const LIVE_TABELLEN = ['tagesmeldung', 'zeiteintrag', 'foto', 'fehlmeldung', 'regierapport', 'zusatzauftrag', 'jahresplan', 'planaenderung', 'abwesenheit'] as const;
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
 * Der Live-Auslöser ohne React (testbar). `aenderung()` bei jeder gemeldeten Änderung: sammelt `sammelnMs` lang und
 * lädt dann einmal. Läuft gerade ein Laden, folgt genau ein weiterer Lauf danach (die Änderung kam vielleicht zu spät
 * für den laufenden). Ist die Seite versteckt, wird nur gemerkt — `sichtbarGeworden()` holt es nach.
 */
export function liveAusloeser(laden: () => unknown, sichtbar: () => boolean, sammelnMs = LIVE_SAMMELN_MS) {
  let uhr: ReturnType<typeof setTimeout> | null = null;
  let laeuft = false;
  let nochmals = false;
  let verpasst = false;

  async function lauf(): Promise<void> {
    if (laeuft) { nochmals = true; return; }
    laeuft = true;
    try {
      await laden();
    } catch {
      /* die Seite zeigt ihre Fehler selbst */
    } finally {
      laeuft = false;
    }
    if (nochmals) { nochmals = false; await lauf(); }
  }

  return {
    aenderung(): void {
      if (!sichtbar()) { verpasst = true; return; }
      if (uhr) clearTimeout(uhr);
      uhr = setTimeout(() => { uhr = null; void lauf(); }, sammelnMs);
    },
    /** true, wenn etwas nachgeholt wurde (dann braucht es kein zweites Laden für «wieder sichtbar»). */
    sichtbarGeworden(): boolean {
      if (!verpasst) return false;
      verpasst = false;
      void lauf();
      return true;
    },
    /** Verbindung war weg und steht wieder: was dazwischen kam, kennt niemand — einmal neu laden. */
    wiederVerbunden(): void { void lauf(); },
    stopp(): void { if (uhr) clearTimeout(uhr); uhr = null; },
  };
}

let kanalNr = 0;

/**
 * Neu laden, sobald sich in der Datenbank etwas ändert (live), wenn die Seite wieder sichtbar wird (Tab zurück,
 * Fenster im Vordergrund) und als Sicherheitsnetz alle `abstandMs` — ohne Live-Verbindung jede Minute. `laden`
 * sollte still laden (ohne «Lädt …» über der Seite), sonst springt der Bildschirm bei jeder Meldung.
 */
export function useAuffrischen(laden: () => unknown, abstandMs = AUFFRISCHEN_MS): void {
  const ref = useRef(laden);
  useEffect(() => { ref.current = laden; });
  useEffect(() => {
    const sichtbar = () => document.visibilityState === 'visible';
    const los = auffrischer(() => ref.current());
    const live = liveAusloeser(() => ref.current(), sichtbar);
    let liveSteht = false;
    let warSchonVerbunden = false;

    const wiederDa = () => {
      if (!sichtbar()) return;
      if (!live.sichtbarGeworden()) void los();
    };
    document.addEventListener('visibilitychange', wiederDa);
    window.addEventListener('focus', wiederDa);

    // Sicherheitsnetz: mit Live alle `abstandMs`, ohne jede Minute
    let seitLetztem = 0;
    const takt = window.setInterval(() => {
      seitLetztem += OHNE_LIVE_MS;
      if (!sichtbar()) return;
      if (!liveSteht || seitLetztem >= abstandMs) { seitLetztem = 0; void los(); }
    }, OHNE_LIVE_MS);

    const client = supabase;
    let kanal: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (client) {
      kanal = client.channel(`live-${++kanalNr}`);
      for (const tabelle of LIVE_TABELLEN) {
        kanal.on('postgres_changes', { event: '*', schema: 'public', table: tabelle }, () => live.aenderung());
      }
      kanal.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Nach einem Abriss: verpasste Änderungen holen
          if (warSchonVerbunden && !liveSteht) live.wiederVerbunden();
          liveSteht = true;
          warSchonVerbunden = true;
        } else {
          liveSteht = false;
        }
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', wiederDa);
      window.removeEventListener('focus', wiederDa);
      window.clearInterval(takt);
      live.stopp();
      if (client && kanal) void client.removeChannel(kanal);
    };
  }, [abstandMs]);
}
