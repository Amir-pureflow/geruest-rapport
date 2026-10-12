import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Ohne Schrägstrich am Ende — sonst entstehen beim Anhängen doppelte Slashes. */
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Wie lange eine Anfrage höchstens dauern darf (13.10.2026). Ohne Grenze blieb eine Anfrage im WLAN mit Anmeldeseite
 * oder bei einem Balken Empfang ewig hängen — und weil die Warteschlange nie zwei Durchgänge gleichzeitig laufen lässt
 * (db.ts), wartete danach alles Senden dahinter. Grosszügig gewählt, damit Fotos und Sprachnotizen auch über 3G mit
 * schlechtem Empfang durchkommen. Eine abgebrochene Anfrage gilt als «keine Verbindung»: die Meldung bleibt in der
 * Warteschlange und geht beim nächsten Versuch nochmals (der Server dedupliziert).
 */
export function zeitlimitMs(url: string): number {
  if (url.includes('/storage/v1/')) return 5 * 60 * 1000;     // Fotos, Sprachnotizen
  if (url.includes('/functions/v1/')) return 2 * 60 * 1000;   // Transkription: Audio hin, Text zurück
  return 45 * 1000;                                           // Datenbank, Anmeldung
}

/**
 * Ohne Netz sofort scheitern (10.10.2026). supabase-js versucht Lese-Abfragen bei einem Netzfehler
 * dreimal nach 1, 2 und 4 Sekunden nochmals. Meldet das Handy «kein Netz», blieb die App so beim Start
 * rund 20 Sekunden weiss, bevor Vorrat und Warteschlange (Regel #4) zum Zug kamen. Als «AbortError»
 * gibt die Bibliothek den Fehler sofort zurück; der Text enthält weiter «Failed to fetch», damit
 * fehlerText() in entfernen.ts ihn als «Keine Verbindung» erkennt. Mit Netz bleibt alles wie bisher
 * (auch die Wiederholung bei einem kurzen Aussetzer) — aber nie länger als `zeitlimitMs`.
 */
const mitZeitlimit: typeof fetch = (input, init) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new DOMException('Failed to fetch (kein Netz)', 'AbortError'));
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const ms = zeitlimitMs(url);
  const steuerung = new AbortController();
  // Bricht der Aufrufer selbst ab (supabase-js `abortSignal`), gilt das auch hier
  const aussen = init?.signal;
  const weiter = () => steuerung.abort(aussen?.reason);
  if (aussen) {
    if (aussen.aborted) steuerung.abort(aussen.reason);
    else aussen.addEventListener('abort', weiter, { once: true });
  }
  const uhr = setTimeout(() => steuerung.abort(new DOMException(`Failed to fetch (Zeitüberschreitung nach ${Math.round(ms / 1000)} s)`, 'AbortError')), ms);
  return fetch(input, { ...init, signal: steuerung.signal })
    .catch((e: unknown) => {
      // Der eigene Abbruch kommt als «AbortError» mit dem Grund von oben — so liest ihn auch db.ts als Verbindungsfehler
      if (steuerung.signal.aborted && steuerung.signal.reason instanceof DOMException) throw steuerung.signal.reason;
      throw e;
    })
    .finally(() => {
      clearTimeout(uhr);
      aussen?.removeEventListener('abort', weiter);
    });
};

/** null, solange .env fehlt — die App läuft dann im lokalen Offline-Modus. */
export const supabase: SupabaseClient | null =
  supabaseUrl && key ? createClient(supabaseUrl, key, { global: { fetch: mitZeitlimit } }) : null;
