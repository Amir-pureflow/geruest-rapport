// Tarifklassen für alles, was der KUNDE sieht: das PDF (rapport_pdf.ts) und den Bestätigungslink (bestaetigung).
// Der Kunde sieht Klassen («Gerüstmonteur/in 17.50 h»), nie Namen der Mitarbeitenden (Entscheid Amir 28.11.2026).
// Das Total rechnet sich aus den Zeilen und wird auf 5 Rappen gerundet — wie in der App (src/lib/tarif.ts rund5)
// und in der Datenbank (regie_rund5, Migration 0056).
//
// Beim Deploy über die CLI (`--use-api`) wird diese Datei mitgebündelt; über den MCP neben index.ts als `./tarifklassen.ts`.

/** Tarifcodes → Kundenbezeichnung, Einheit, Gruppe (Quelle: fixtures/tarife_sguv_2026.json). */
export const TARIF: Record<string, { text: string; me: string; gruppe: 'personal' | 'fahrzeuge' | 'zuschlag' }> = {
  bauf: { text: 'Bauführer/in', me: 'h', gruppe: 'personal' },
  objekt: { text: 'Objektleiter/in', me: 'h', gruppe: 'personal' },
  gruppe: { text: 'Gruppenleiter/in', me: 'h', gruppe: 'personal' },
  monteur: { text: 'Gerüstmonteur/in', me: 'h', gruppe: 'personal' },
  mitarbeiter: { text: 'Gerüstbaumitarbeiter/in', me: 'h', gruppe: 'personal' },
  lern3: { text: 'Lernende 3. Lehrjahr', me: 'h', gruppe: 'personal' },
  lern2: { text: 'Lernende 2. Lehrjahr', me: 'h', gruppe: 'personal' },
  lern1: { text: 'Lernende 1. Lehrjahr', me: 'h', gruppe: 'personal' },
  lieferwagen_35: { text: 'Lieferwagen bis 3,5 t', me: 'h', gruppe: 'fahrzeuge' },
  transporter_8: { text: 'Mannschaftstransporter bis 8 Pers.', me: 'h', gruppe: 'fahrzeuge' },
  lkw_16: { text: 'Lastwagen bis 16 t', me: 'h', gruppe: 'fahrzeuge' },
  lkw_16_kran: { text: 'Lastwagen bis 16 t mit Kran', me: 'h', gruppe: 'fahrzeuge' },
  lkw_32: { text: 'Lastwagen bis 32 t', me: 'h', gruppe: 'fahrzeuge' },
  lkw_32_kran: { text: 'Lastwagen bis 32 t mit Kran', me: 'h', gruppe: 'fahrzeuge' },
  zug_4wd_6: { text: 'Zugfahrzeug 4WD bis 6 t', me: 'h', gruppe: 'fahrzeuge' },
  anhaenger_12: { text: 'Anhänger 2-achsig bis 12 t', me: 'h', gruppe: 'fahrzeuge' },
  etappe: { text: 'Etappenzuschlag', me: 'pa', gruppe: 'zuschlag' },
  materialmiete: { text: 'Materialmiete (9 % pro Monat)', me: 'pa', gruppe: 'zuschlag' },
};

/** Ansatz Gerüstmonteur/in — Rückfall für Funktionen ohne Tarifklasse (wie src/lib/tarif.ts RUECKFALL_ANSATZ_RAPPEN). */
const RUECKFALL_ANSATZ_RAPPEN = 10800;

const ORDNUNG = ['bauf', 'objekt', 'gruppe', 'monteur', 'mitarbeiter', 'lern3', 'lern2', 'lern1'];

export interface Position { tarif_code: string; bezeichnung: string; menge_hundertstel: number; ansatz_rappen: number; betrag_rappen: number }
export interface Klassenzeile { code: string; text: string; me: string; menge: number; ansatz: number; summe: number }

/** 1'234.56 — ohne «Fr.», wie im SORBA-Ausdruck. */
export function chf(rappen: number): string {
  const v = Math.round(rappen);
  const ganz = Math.floor(Math.abs(v) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const rp = (Math.abs(v) % 100).toString().padStart(2, '0');
  return `${v < 0 ? '-' : ''}${ganz}.${rp}`;
}

/** Auf 5 Rappen runden, kaufmännisch: 369919 → 369920, 95593 → 95595. */
export function rund5(rappen: number): number {
  const v = Math.round(rappen);
  return Math.sign(v) * Math.round(Math.abs(v) / 5) * 5;
}

/**
 * Positionen nach Tarifklasse zusammenfassen. Unbekannte Codes (alte Rapporte mit «buero» o. ä.) erscheinen als
 * «Weitere Leistung» statt als interner Code.
 */
export function gruppieren(positionen: Position[]): { personal: Klassenzeile[]; rest: Klassenzeile[] } {
  const m = new Map<string, Klassenzeile>();
  for (const p of positionen) {
    // Unbekannter Code (Funktion ohne Tarifklasse, z. B. «buero») mit dem Monteursansatz = so wird er verrechnet → als
    // Gerüstmonteur/in zeigen. Mit anderem Ansatz: «Weitere Leistung». Nie den internen Code (Prüfung 28.11.2026).
    const code = TARIF[p.tarif_code] ? p.tarif_code : p.ansatz_rappen === RUECKFALL_ANSATZ_RAPPEN ? 'monteur' : p.tarif_code;
    // Gleiche Klasse, anderer Ansatz → eigene Zeile, sonst stimmt «Menge × Preis = Summe» nicht.
    const schluessel = `${code}|${p.ansatz_rappen}`;
    const info = TARIF[code] ?? { text: 'Weitere Leistung', me: 'h' };
    const e = m.get(schluessel) ?? { code, text: info.text, me: info.me, menge: 0, ansatz: p.ansatz_rappen, summe: 0 };
    e.menge += p.menge_hundertstel;
    e.summe += p.betrag_rappen;
    m.set(schluessel, e);
  }
  const alle = [...m.values()];
  const rang = (c: string) => { const i = ORDNUNG.indexOf(c); return i < 0 ? 99 : i; };
  const personal = alle.filter((z) => TARIF[z.code]?.gruppe === 'personal').sort((a, b) => rang(a.code) - rang(b.code));
  const rest = alle.filter((z) => TARIF[z.code]?.gruppe !== 'personal');
  return { personal, rest };
}

/**
 * Total in Rappen: Summe der Zeilen, Rundungsdifferenz, Total.
 * Der Kopf-Betrag (seit 0056 von der DB = Zeilen auf 5 Rappen) gilt, wenn er höchstens 2 Rappen von der Summe abweicht —
 * so behalten Rapporte, die VOR der 5-Rappen-Regel versendet wurden, ihren Betrag aus der Mail (3'699.19).
 * Weicht er mehr ab, ist er veraltet (Prüfung 28.11.2026: Kopf 3'393.75 unter Zeilen 3'699.19) → die Zeilen gelten.
 */
export function totalAusZeilen(positionen: Position[], kopf?: number | null): { summe: number; rundung: number; total: number } {
  const summe = positionen.reduce((s, p) => s + p.betrag_rappen, 0);
  const total = kopf != null && Math.abs(kopf - summe) <= 2 ? kopf : rund5(summe);
  return { summe, rundung: total - summe, total };
}
