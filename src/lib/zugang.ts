/**
 * Wem gehört die Warteschlange? (13.10.2026, vor dem Start bei der Gerüst GmbH)
 *
 * Eine Meldung, die auf dem Gerät wartet, darf nur mit der Anmeldung ihrer Firma hinaus. Sonst schreibt die Datenbank
 * sie der Firma zu, die gerade angemeldet ist (`default aktuelle_firma()`): Ein Teamgerät, auf dem erst die Gerüst GmbH
 * und danach We-Plan angemeldet war, hätte die wartenden Stunden der Gerüst GmbH bei We-Plan abgelegt.
 *
 * Darum merkt sich das Gerät, welche Firma zu welcher Anmeldung gehört: Benutzer (Auth-Konto) → Firma. Den Benutzer
 * kennt die Sitzung auch ohne Netz; die Firma kommt aus `aktuelle_firma()`, sobald die Datenbank antwortet
 * (`zugangPruefen()` in konto.ts). Jede neue Meldung trägt beides (db.ts), gesendet wird nur, was zur Anmeldung passt.
 */
const KEY = 'zugang-firma';

export interface Zugang {
  /** Auth-Konto (auth.users.id) */
  user: string;
  /** Firma laut `aktuelle_firma()` — null, solange die Datenbank für diesen Benutzer noch nichts gesagt hat */
  firma: string | null;
  /** Name der Firma, nur für den Bildschirm («wartet auf die Anmeldung von …») */
  name: string | null;
}

function lesen(): Zugang | null {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Zugang> | null;
    return x && typeof x.user === 'string'
      ? { user: x.user, firma: typeof x.firma === 'string' ? x.firma : null, name: typeof x.name === 'string' ? x.name : null }
      : null;
  } catch {
    return null; // kein Speicher (privater Modus, Test) — dann gilt nur, was im Arbeitsspeicher steht
  }
}

let stand: Zugang | null = lesen();

/** Die zuletzt gemerkte Anmeldung — sofort verfügbar, auch ohne Netz. */
export function zugang(): Zugang | null {
  return stand;
}

/** Firma zu diesem Benutzer — nur, wenn die gemerkte Anmeldung dieselbe ist. Ein anderer Benutzer: unbekannt. */
export function firmaVon(user: string | null): { firma: string | null; name: string | null } {
  return stand && user && stand.user === user ? { firma: stand.firma, name: stand.name } : { firma: null, name: null };
}

export function zugangMerken(z: Zugang): void {
  stand = z;
  try { localStorage.setItem(KEY, JSON.stringify(z)); } catch { /* egal */ }
}

/** Beim Abmelden: die nächste Anmeldung muss ihre Firma erst wieder von der Datenbank hören. */
export function zugangVergessen(): void {
  stand = null;
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
}

/** Was eine Meldung über ihre Anmeldung trägt. Alles leer = Meldung von vor dem 13.10.2026. */
export interface Herkunft {
  firma_id?: string | null;
  auth_user_id?: string | null;
}

/**
 * Darf diese Meldung mit der aktuellen Anmeldung hinaus?
 *  - Alt-Eintrag ohne Herkunft: gehört der Firma, die gerade angemeldet ist (so war es bisher).
 *  - Firma auf beiden Seiten bekannt: sie muss gleich sein.
 *  - Sonst (Firma noch unbekannt): nur derselbe Benutzer — ein Konto gehört immer zu genau einer Firma.
 */
export function gehoertZu(e: Herkunft, aktuell: { user: string | null; firma: string | null }): boolean {
  if (!e.firma_id && !e.auth_user_id) return true;
  if (e.firma_id && aktuell.firma) return e.firma_id === aktuell.firma;
  return !!e.auth_user_id && e.auth_user_id === aktuell.user;
}
