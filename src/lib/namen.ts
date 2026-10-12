/**
 * Anzeige von Personennamen in Auswahllisten. Beispiel-Daten (Arbnor 11.10.2026) tragen «(Bsp.)» im Namen — in Listen
 * steht dann der Name allein und daneben ein kleiner Zusatz «Beispiel», damit auch das Kürzel im Avatar stimmt.
 */
export function anzeigeName(name: string): { name: string; beispiel: boolean } {
  const m = name.match(/^(.*?)\s*\(Bsp\.\)\s*$/);
  return m ? { name: m[1], beispiel: true } : { name: name.trim(), beispiel: false };
}

/** Suche in Namen: jedes Wort der Eingabe muss im Namen vorkommen — ohne Gross/klein und Akzente («zielin» findet «Zieliński»). */
export function namePasst(name: string, suche: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const n = norm(name);
  return norm(suche).split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}
