/**
 * SGUV-Tarifrechner.
 *
 * Harte Regeln (CLAUDE.md #6):
 *  - Geld in RAPPEN als Integer, Zeit in MINUTEN als Integer.
 *  - Mengen als Hundertstel (2.00 h => 200), damit alles ganzzahlig bleibt.
 *  - Franken-Formatierung NUR über formatChf() bei der Ausgabe.
 *
 * Der vorgerechnete Betrag ist eine Entscheidungshilfe für den Bauführer —
 * der verbindliche Regierapport entsteht in SORBA (Bauplan §1).
 */
import tarife from '../../fixtures/tarife_sguv_2026.json';

export interface Position {
  code: string;
  bezeichnung: string;
  /** Menge in Hundertsteln der Einheit: 2.00 h => 200, 12 km => 1200 */
  mengeHundertstel: number;
  ansatzRappen: number;
}

export interface PositionMitBetrag extends Position {
  betragRappen: number;
}

export interface RegieRechnung {
  positionen: PositionMitBetrag[];
  zwischenRappen: number;
  materialmieteRappen: number;
  totalRappen: number;
}

function mussInt(wert: number, name: string): void {
  if (!Number.isInteger(wert)) {
    throw new Error(`${name} muss ganzzahlig sein, erhalten: ${wert}`);
  }
}

/** Betrag einer Position: Menge (Hundertstel) × Ansatz (Rappen pro Einheit). */
export function positionBetrag(p: Position): number {
  mussInt(p.mengeHundertstel, 'mengeHundertstel');
  mussInt(p.ansatzRappen, 'ansatzRappen');
  return Math.round((p.mengeHundertstel * p.ansatzRappen) / 100);
}

/** Betrag aus Minuten × Stundenansatz — für Zeiteinträge. */
export function minutenBetrag(minuten: number, ansatzProStundeRappen: number): number {
  mussInt(minuten, 'minuten');
  mussInt(ansatzProStundeRappen, 'ansatzProStundeRappen');
  return Math.round((minuten * ansatzProStundeRappen) / 60);
}

/** 2.5 (Stunden) => 250 Hundertstel. Wirft bei mehr als 2 Nachkommastellen. */
export function stundenZuHundertstel(stunden: number): number {
  const h = Math.round(stunden * 100);
  if (Math.abs(h - stunden * 100) > 1e-6) {
    throw new Error(`Stundenwert ${stunden} hat mehr als 2 Nachkommastellen`);
  }
  return h;
}

export function materialmiete(zwischenRappen: number): number {
  mussInt(zwischenRappen, 'zwischenRappen');
  return Math.round((zwischenRappen * tarife.zuschlaege.materialmiete_prozent) / 100);
}

export function rechneRegie(
  positionen: Position[],
  opts: { mitMaterialmiete?: boolean } = {},
): RegieRechnung {
  const mitMaterialmiete = opts.mitMaterialmiete ?? true;
  const mitBetrag: PositionMitBetrag[] = positionen.map((p) => ({
    ...p,
    betragRappen: positionBetrag(p),
  }));
  const zwischenRappen = mitBetrag.reduce((s, p) => s + p.betragRappen, 0);
  const materialmieteRappen = mitMaterialmiete ? materialmiete(zwischenRappen) : 0;
  return {
    positionen: mitBetrag,
    zwischenRappen,
    materialmieteRappen,
    totalRappen: zwischenRappen + materialmieteRappen,
  };
}

/** 95593 => "Fr. 955.93" · 1150000 => "Fr. 11'500.00" (Schweizer Tausender). */
export function formatChf(rappen: number): string {
  mussInt(rappen, 'rappen');
  const negativ = rappen < 0;
  const abs = Math.abs(rappen);
  const franken = Math.floor(abs / 100);
  const rest = abs % 100;
  const frankenStr = franken.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${negativ ? '-' : ''}Fr. ${frankenStr}.${rest.toString().padStart(2, '0')}`;
}

/** Tarif-Nachschlag nach Code (Personal + Fahrzeuge). */
export function tarifNachCode(code: string): { bezeichnung: string; ansatz_rappen: number; einheit: string } {
  const alle = [...tarife.personal, ...tarife.fahrzeuge];
  const t = alle.find((x) => x.code === code);
  if (!t) throw new Error(`Unbekannter Tarifcode: ${code}`);
  return t;
}

export const ETAPPE_MIN_RAPPEN: number = tarife.zuschlaege.etappe_min_rappen;

/**
 * Der Referenzfall aus dem Konzept (Anhang B): Gerüst versetzen,
 * 2 Monteure × 2 h + Lieferwagen 1 h + Etappenzuschlag + 9 % Materialmiete.
 * Erwartet: Fr. 955.93. Dient Tests und der Start-Demo.
 */
export function modellfallVersetzen(): RegieRechnung {
  return rechneRegie([
    { code: 'monteur', bezeichnung: '2 Monteure × 2.0 h', mengeHundertstel: 400, ansatzRappen: tarifNachCode('monteur').ansatz_rappen },
    { code: 'lieferwagen_35', bezeichnung: 'Lieferwagen 1.0 h', mengeHundertstel: 100, ansatzRappen: tarifNachCode('lieferwagen_35').ansatz_rappen },
    { code: 'etappe', bezeichnung: 'Etappenzuschlag', mengeHundertstel: 100, ansatzRappen: ETAPPE_MIN_RAPPEN },
  ]);
}
