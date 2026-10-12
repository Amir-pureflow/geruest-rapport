// Wer ruft auf, und darf er das? — für alle Functions, die mit der Service-Role arbeiten (13.10.2026, Amir:
// «Die App darf keine Fehler haben»). Die Service-Role umgeht RLS; `verify_jwt` beweist nur, dass IRGENDEIN Schlüssel
// mitkam — auch der öffentliche anon-Schlüssel aus dem JavaScript. Darum hier: Firma und Rolle der Sitzung über die
// eigenen Datenbankfunktionen (`aktuelle_firma()`, `aktuelle_rolle()` aus 0041), mit dem JWT des Aufrufers.
// Ohne aktiven Zugang (anon, fremd, Person inaktiv) gibt es null.
//
// Beim Deploy über die CLI (`--use-api`) wird diese Datei mitgebündelt; über den MCP neben index.ts als `./zugang.ts`.
import { createClient } from 'npm:@supabase/supabase-js@2';

export interface Aufrufer {
  firma: string;
  /** 'buero' (Firmen-Zugang, Bauführer, Sekretariat), 'chef' oder 'monteur' */
  rolle: string;
}

export async function aufrufer(req: Request): Promise<Aufrufer | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const nutzer = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [f, r] = await Promise.all([nutzer.rpc('aktuelle_firma'), nutzer.rpc('aktuelle_rolle')]);
  if (f.error || r.error || typeof f.data !== 'string' || typeof r.data !== 'string') return null;
  return { firma: f.data, rolle: r.data };
}

/** Aufruf mit dem Service-Schlüssel selbst (Zeitplan/Server), nicht aus der App. */
export function istServer(req: Request): boolean {
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return !!schluessel && auth === schluessel;
}

/**
 * Ein Pfad aus einer Tabelle zeigt nur dann auf eine Datei, wenn er im Ordner seiner eigenen Zeile liegt
 * (`audio/<client_uuid>.…`, `fotos/<client_uuid>/…`, `rapporte/<id>…`). Die Pfade schreibt die App; ohne diese
 * Prüfung könnte eine Zeile auf die Datei einer fremden Firma zeigen, und die Function läse sie mit der Service-Role.
 */
export function pfadPasst(pfad: string | null | undefined, ...praefixe: string[]): boolean {
  if (!pfad || pfad.includes('..')) return false;
  return praefixe.some((p) => p.length > 0 && pfad.startsWith(p));
}

/** Text für HTML-Mails: alles, was aus der Datenbank oder der Anfrage kommt, wird entschärft. */
export function html(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Datum in der Schweiz als «JJJJ-MM-TT» — Deno läuft in UTC, Fristen gelten in Bern. */
export function zuerichDatum(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
