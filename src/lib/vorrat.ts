/**
 * Vorrat für den Start ohne Netz (10.10.2026, Amir: «melde trotzdem» muss auch auf der Baustelle ohne Empfang gelten).
 *
 * Was das Teamgerät zuletzt mit Netz geladen hat — die Teams, die Leute des Teams, die Baustellen-Kacheln —,
 * bleibt im Gerät liegen. Startet die App draussen ohne Netz, nimmt die Erfassung diesen Stand statt leerer
 * Listen; gemeldet wird wie immer über die Warteschlange (db.ts) und gesendet, sobald Netz da ist.
 * Mit Netz wird der Vorrat bei jedem Laden erneuert, beim Abmelden gelöscht (anderes Konto, andere Firma).
 */
const PRAEFIX = 'vorrat:';

export function vorratLesen<T>(name: string): T | null {
  try {
    const s = localStorage.getItem(PRAEFIX + name);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function vorratSchreiben(name: string, wert: unknown): void {
  try {
    localStorage.setItem(PRAEFIX + name, JSON.stringify(wert));
  } catch {
    /* Speicher voll oder privater Modus — dann eben ohne Vorrat */
  }
}

/** Alles weg (beim Abmelden). */
export function vorratLeeren(): void {
  try {
    const weg: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PRAEFIX)) weg.push(k);
    }
    for (const k of weg) localStorage.removeItem(k);
  } catch {
    /* egal */
  }
}
