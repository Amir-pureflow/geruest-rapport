/**
 * Wetter in der Planung (25.10.2026, Amir: «eine Wettervorschau pro Baustelle, z. B. Regen oder Sturm am Mittwoch»).
 *
 * Quelle: MeteoSchweiz, Lokalprognose (Open Data, «Quelle: MeteoSchweiz» muss sichtbar sein), geladen von der Function
 * `wetter-laden` (Migration 0054). Je Ort und Tag: Piktogramm-Nummer tagsüber, Höchst-/Tiefstwert, Regen (Tagessumme)
 * und die stärkste Böe zwischen 6 und 18 Uhr. Die Grafiken von MeteoSchweiz dürfen nicht verwendet werden — nur Nummer
 * und Bedeutung; die Zeichen sind eigene (lucide).
 *
 * Warnungen nach Zahlen, nicht nach Symbol — die zählen fürs Gerüst: Böen ab 50 km/h «windig», ab 75 km/h «Sturm»,
 * Regen ab 2 mm, ab 10 mm «viel Regen», Schnee und Gewitter nach dem Symbol, Frost ab −2 °C.
 */

export interface WetterTag {
  datum: string;
  symbol: number | null;
  tmax: number | null;
  tmin: number | null;
  regen_mm: number | null;
  boe_kmh: number | null;
}

export type WetterArt = 'sonnig' | 'teils' | 'bewoelkt' | 'nebel' | 'regen' | 'schneeregen' | 'schnee' | 'gewitter';

// Piktogramm-Nummern von MeteoSchweiz (Tag 1–42, Nacht 101–142), am 25.10.2026 mit den Regenmengen der Prognose
// abgeglichen; Gewitter nach der verbreiteten Zuordnung (12, 13, 23–25, 32, 36–42)
const ARTEN: [WetterArt, number[]][] = [
  ['gewitter', [12, 13, 23, 24, 25, 32, 36, 37, 38, 39, 40, 41, 42]],
  ['schnee', [8, 11, 16, 19, 22, 30, 34]],
  ['schneeregen', [7, 10, 15, 18, 21, 31]],
  ['regen', [6, 9, 14, 17, 20, 29, 33]],
  ['nebel', [27, 28]],
  ['bewoelkt', [4, 5, 35]],
  ['teils', [2, 3]],
  ['sonnig', [1, 26]],
];
const ART_VON = new Map(ARTEN.flatMap(([art, nummern]) => nummern.map((n) => [n, art] as const)));

/** Was am Tag vorherrscht — nach dem Symbol, ohne Symbol nach Regen und Temperatur */
export function wetterArt(w: Pick<WetterTag, 'symbol' | 'regen_mm' | 'tmax'>): WetterArt {
  const n = w.symbol !== null && w.symbol > 100 ? w.symbol - 100 : w.symbol;
  const art = n !== null ? ART_VON.get(n) : undefined;
  if (art) return art;
  if ((w.regen_mm ?? 0) >= 1) return (w.tmax ?? 10) <= 1 ? 'schnee' : 'regen';
  return 'teils';
}

export type WarnArt = 'sturm' | 'gewitter' | 'schnee' | 'starkregen' | 'wind' | 'regen' | 'frost';
export interface Warnung { art: WarnArt; text: string; stark: boolean }

export const WIND_KMH = 50;
export const STURM_KMH = 75;
const rund = (x: number) => Math.round(x);

/** Was fürs Gerüst zählt, das Wichtigste zuerst. Leer = nichts Besonderes. */
export function warnungen(w: WetterTag): Warnung[] {
  const out: Warnung[] = [];
  const art = wetterArt(w);
  const boe = w.boe_kmh ?? 0;
  const regen = w.regen_mm ?? 0;
  if (boe >= STURM_KMH) out.push({ art: 'sturm', text: `Sturm, Böen bis ${rund(boe)} km/h`, stark: true });
  if (art === 'gewitter') out.push({ art: 'gewitter', text: 'Gewitter', stark: true });
  if (art === 'schnee' || art === 'schneeregen') out.push({ art: 'schnee', text: art === 'schnee' ? `Schnee${regen >= 1 ? ` (${rund(regen)} mm)` : ''}` : 'Schneeregen', stark: art === 'schnee' });
  if (regen >= 10 && art !== 'schnee') out.push({ art: 'starkregen', text: `Viel Regen, ${rund(regen)} mm`, stark: true });
  if (boe >= WIND_KMH && boe < STURM_KMH) out.push({ art: 'wind', text: `Windig, Böen bis ${rund(boe)} km/h`, stark: false });
  if (regen >= 2 && regen < 10 && art !== 'schnee' && art !== 'schneeregen') out.push({ art: 'regen', text: `Regen, ${regen < 5 ? regen.toFixed(1).replace('.0', '') : rund(regen)} mm`, stark: false });
  if (w.tmin !== null && w.tmin <= -2) out.push({ art: 'frost', text: `Frost, bis ${rund(w.tmin)} °C`, stark: w.tmin <= -6 });
  return out;
}

const WORT: Record<WetterArt, string> = {
  sonnig: 'sonnig', teils: 'teils sonnig', bewoelkt: 'bewölkt', nebel: 'Nebel', regen: 'Regen', schneeregen: 'Schneeregen', schnee: 'Schnee', gewitter: 'Gewitter',
};

/** «4–9 °C» */
export function temperaturText(w: Pick<WetterTag, 'tmin' | 'tmax'>): string | null {
  if (w.tmin !== null && w.tmax !== null) return `${rund(w.tmin)}–${rund(w.tmax)} °C`;
  return w.tmax !== null ? `bis ${rund(w.tmax)} °C` : null;
}

/** «Regen · 4–9 °C · 12 mm · Böen bis 80 km/h» — für Tooltip und Tag */
export function wetterText(w: WetterTag): string {
  const teile = [WORT[wetterArt(w)]];
  const t = temperaturText(w);
  if (t) teile.push(t);
  if ((w.regen_mm ?? 0) >= 0.5) teile.push(`${(w.regen_mm ?? 0) < 5 ? (w.regen_mm ?? 0).toFixed(1).replace('.0', '') : rund(w.regen_mm ?? 0)} mm`);
  if ((w.boe_kmh ?? 0) >= 30) teile.push(`Böen bis ${rund(w.boe_kmh ?? 0)} km/h`);
  return teile.join(' · ');
}

/** Mehrere Orte am selben Tag (Team mit zwei Baustellen): die Warnungen zusammen, jede Art einmal, die stärkste */
export function warnungenZusammen(tage: WetterTag[]): Warnung[] {
  const beste = new Map<WarnArt, Warnung>();
  for (const w of tage) for (const x of warnungen(w)) if (!beste.has(x.art) || (x.stark && !beste.get(x.art)!.stark)) beste.set(x.art, x);
  const reihe: WarnArt[] = ['sturm', 'gewitter', 'schnee', 'starkregen', 'wind', 'regen', 'frost'];
  return reihe.filter((a) => beste.has(a)).map((a) => beste.get(a)!);
}
