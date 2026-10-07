/**
 * Suche in Listen (08.10.2026, Amir: «Wenn ich C eingebe, kommt immer etwas mit A am Anfang»).
 * Vorher galt jeder Name, der die Buchstaben irgendwo enthält («Ar*c*hivstrasse» für «c»), alphabetisch sortiert.
 * Jetzt nach Rang: Anfang des Namens → Anfang eines Wortes → irgendwo im Text (erst ab 3 Zeichen, sonst passt fast alles).
 * Gross/klein und Akzente/Umlaute spielen keine Rolle: «bruck» findet «Brückenstrasse».
 */

/** Klein, ohne Akzente (ü → u, é → e), ß → ss. */
export function normalisieren(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').trim();
}

/** Rang eines Textes für eine Suche — kleiner ist besser, null = kein Treffer. */
export function suchRang(text: string, suche: string): number | null {
  const t = normalisieren(text);
  const q = normalisieren(suche);
  if (!q) return null;
  if (t.startsWith(q)) return 0;
  if (t.split(/[\s,./()_+-]+/).some((w) => w.startsWith(q))) return 1;
  if (q.length >= 3 && t.includes(q)) return 2;
  return null;
}

export interface Suchbar { konto_nr: string; bezeichnung: string | null }

/**
 * Baustellen suchen: Kontonummer von vorne (ab 3 Ziffern auch mittendrin), Name nach Rang; bei gleichem Rang
 * alphabetisch. Leere Suche = leere Liste (die Aufrufer entscheiden, was sie dann zeigen).
 */
export function baustellenSuchen<T extends Suchbar>(liste: readonly T[], suche: string, max = 8): T[] {
  const q = suche.trim();
  if (!q) return [];
  const ziffern = /^\d+$/.test(q);
  const bewertet: { b: T; rang: number }[] = [];
  for (const b of liste) {
    const nr = ziffern ? (b.konto_nr.startsWith(q) ? 0 : q.length >= 3 && b.konto_nr.includes(q) ? 2 : null) : null;
    const name = suchRang(b.bezeichnung ?? '', q);
    const rang = Math.min(nr ?? 9, name ?? 9);
    if (rang < 9) bewertet.push({ b, rang });
  }
  return bewertet
    .sort((x, y) => x.rang - y.rang || (x.b.bezeichnung ?? '').localeCompare(y.b.bezeichnung ?? '', 'de') || x.b.konto_nr.localeCompare(y.b.konto_nr))
    .slice(0, max)
    .map((x) => x.b);
}
