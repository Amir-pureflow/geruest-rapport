import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Ohne Schrägstrich am Ende — sonst entstehen beim Anhängen doppelte Slashes. */
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Ohne Netz sofort scheitern (10.10.2026). supabase-js versucht Lese-Abfragen bei einem Netzfehler
 * dreimal nach 1, 2 und 4 Sekunden nochmals. Meldet das Handy «kein Netz», blieb die App so beim Start
 * rund 20 Sekunden weiss, bevor Vorrat und Warteschlange (Regel #4) zum Zug kamen. Als «AbortError»
 * gibt die Bibliothek den Fehler sofort zurück; der Text enthält weiter «Failed to fetch», damit
 * fehlerText() in entfernen.ts ihn als «Keine Verbindung» erkennt. Mit Netz bleibt alles wie bisher
 * (auch die Wiederholung bei einem kurzen Aussetzer).
 */
const ohneWiederholung: typeof fetch = (input, init) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new DOMException('Failed to fetch (kein Netz)', 'AbortError'));
  return fetch(input, init);
};

/** null, solange .env fehlt — die App läuft dann im lokalen Offline-Modus. */
export const supabase: SupabaseClient | null =
  supabaseUrl && key ? createClient(supabaseUrl, key, { global: { fetch: ohneWiederholung } }) : null;
