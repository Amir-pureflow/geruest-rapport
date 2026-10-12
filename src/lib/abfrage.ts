/**
 * Abfragen, die nichts verschlucken (13.10.2026, vor dem Start bei der Gerüst GmbH).
 *
 * Die gehostete Supabase-API liefert höchstens 1000 Zeilen pro Antwort. `.limit(5000)` hebt das NICHT auf — der Rest
 * fehlt still, und eine Summe stimmt dann einfach nicht. Wer mehr als ein paar hundert Zeilen erwarten kann (Stunden
 * eines Monats, Baustellen über Jahre, Verlauf der Planung), holt seitenweise mit `.range()`.
 *
 * Seitenweise geht nur mit fester Reihenfolge: zuletzt IMMER nach einer eindeutigen Spalte sortieren (meist `id`),
 * sonst kann dieselbe Zeile auf zwei Seiten stehen und eine andere auf keiner.
 */

/** Zeilen pro Seite — nie grösser als die Obergrenze der API (1000), sonst endet `alle()` nach der ersten Seite. */
export const SEITE = 1000;

type Antwort = { data: unknown; error: { message: string } | null };

/**
 * Alle Zeilen einer Abfrage, Seite für Seite. `bau(von, bis)` baut die Abfrage samt `.order(…, eindeutig zuletzt)` und
 * hängt `.range(von, bis)` an. Ein Fehler auf irgendeiner Seite wirft — lieber «konnte nicht laden» als eine halbe Liste.
 */
export async function alle<T>(bau: (von: number, bis: number) => PromiseLike<Antwort>, seite = SEITE): Promise<T[]> {
  const out: T[] = [];
  for (let von = 0; ; von += seite) {
    const { data, error } = await bau(von, von + seite - 1);
    if (error) throw new Error(error.message);
    const teil = (data ?? []) as T[];
    out.push(...teil);
    if (teil.length < seite) return out;
  }
}

/**
 * Wie `alle()`, aber mit der Antwort einer einzelnen Abfrage (`{ data, error }`) statt einer Ausnahme — für Seiten, die
 * mehrere Abfragen nebeneinander laden und jeden Fehler einzeln behandeln.
 */
export function alleOderFehler<T>(bau: (von: number, bis: number) => PromiseLike<Antwort>): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return alle<T>(bau).then(
    (data) => ({ data, error: null }),
    (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
  );
}

/**
 * Lange Listen für `.in(…)` in Stücke teilen — jede id steht in der Adresse der Anfrage, und die ist nicht beliebig
 * lang. 100 ids sind gut 3.6 kB.
 */
export function stuecke<T>(liste: readonly T[], groesse = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < liste.length; i += groesse) out.push(liste.slice(i, i + groesse));
  return out;
}
