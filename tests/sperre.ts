/**
 * Sperre gegen die echte Datenbank und die Live-App — läuft vor JEDEM Test (setupFiles).
 *
 * 1. Ist eine Supabase-Adresse gesetzt, die nicht lokal ist, bricht der ganze Testlauf sofort ab.
 * 2. Jede Netzanfrage an einen anderen Rechner als 127.0.0.1/localhost scheitert mit «GESPERRT».
 *    Damit gehen auch keine Aufrufe an Azure, Mistral, Resend, MeteoSchweiz oder geo.admin hinaus (keine Kosten).
 */
const ERLAUBT = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function istLokal(url: string): boolean {
  try {
    return ERLAUBT.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const adresse = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? process.env.VITE_SUPABASE_URL;
if (adresse && !istLokal(adresse)) {
  throw new Error(`GESPERRT: Testlauf mit nicht-lokaler Supabase-Adresse (${new URL(adresse).hostname}). Abbruch.`);
}

const echtesFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!istLokal(url)) throw new Error(`GESPERRT: Netzanfrage im Test an ${url}`);
  return echtesFetch(input, init);
}) as typeof fetch;
