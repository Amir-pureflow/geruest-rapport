/**
 * Zwei Baustellen am selben Tag (Amir/Arbnor 16.11.2026): Team 1 war Mo–Di auf Schwarzenburg geplant, dann kam für
 * Mo zusätzlich die Bienenstrasse dazu — die App speicherte beides, der Chefmonteur sah am Montag zwei Baustellen ohne
 * Reihenfolge. Neu fragt der Einsatz-Dialog, was mit der bisherigen Baustelle passieren soll:
 *
 *  - verschieben: die bisherige Baustelle — und was direkt danach kommt — rutscht hinter den neuen Einsatz. Gezählt wird
 *    in Arbeitstagen (Mo–Fr ohne Berner Feiertage): ein Einsatz von zwei Arbeitstagen bleibt zwei Arbeitstage lang.
 *  - streichen: die Tage des neuen Einsatzes fallen bei der bisherigen Baustelle weg, sonst bleibt alles.
 *  - beides mit Zeiten: beide Baustellen bleiben am Tag, mit Beginnzeit — die frühere zuerst. Weil die Beginnzeit am
 *    ganzen Einsatz hängt, bekommt die bisherige Baustelle für die gemeinsamen Tage einen eigenen Abschnitt.
 *
 * Alles rein rechnerisch (testbar). Der Dialog führt die Schritte aus.
 */
import { addTage, ausIso, iso } from './datum';
import { istArbeitstag } from './feiertage';

export interface PlanAbschnitt { id: string; von: string; bis: string; beginn_min: number | null }

/** Was mit einem bestehenden Einsatz passiert: Zeitraum (und Beginn) ändern, einen Teil neu anlegen, ganz löschen. */
export type Schritt =
  | { art: 'aendern'; id: string; von: string; bis: string; beginn_min?: number | null }
  | { art: 'neu'; vorlage: string; von: string; bis: string; beginn_min?: number | null }
  | { art: 'loeschen'; id: string };

const tagVor = (d: string) => iso(addTage(ausIso(d), -1));
const tagNach = (d: string) => iso(addTage(ausIso(d), 1));

/** Letzter Arbeitstag vor `d` — ein Teil «davor» endet am Freitag, nicht am Sonntag. */
export function letzterArbeitstagVor(d: string): string {
  let t = tagVor(d);
  for (let i = 0; i < 30 && !istArbeitstag(t); i++) t = tagVor(t);
  return t;
}

/** Teil vor `x` und Teil nach `y` eines Einsatzes — auf Arbeitstagen, leer wenn nichts übrig bleibt. */
function teile(p: { von: string; bis: string }, x: string, y: string) {
  const davorBis = letzterArbeitstagVor(x);
  const danachVon = naechsterArbeitstagNach(y);
  return {
    davor: p.von < x && davorBis >= p.von ? { von: p.von, bis: davorBis } : null,
    danach: p.bis > y && danachVon <= p.bis ? { von: danachVon, bis: p.bis } : null,
  };
}

export function naechsterArbeitstagNach(d: string): string {
  let t = tagNach(d);
  for (let i = 0; i < 30 && !istArbeitstag(t); i++) t = tagNach(t);
  return t;
}

/** Arbeitstage von–bis (mindestens 1, auch wenn der Einsatz nur an einem Samstag liegt). */
export function arbeitstage(von: string, bis: string): number {
  let n = 0;
  for (let t = von; t <= bis; t = tagNach(t)) if (istArbeitstag(t)) n++;
  return Math.max(1, n);
}

/** Ab `von` (ein Arbeitstag) `n` Arbeitstage weit: der letzte dieser Tage. */
export function arbeitstagePlus(von: string, n: number): string {
  let t = istArbeitstag(von) ? von : naechsterArbeitstagNach(von);
  for (let i = 1; i < n; i++) t = naechsterArbeitstagNach(t);
  return t;
}

/** Überschneiden sich zwei Zeiträume (ganze Tage, beide Enden eingeschlossen)? */
export function ueberschneiden(a: { von: string; bis: string }, b: { von: string; bis: string }): boolean {
  return a.von <= b.bis && b.von <= a.bis;
}

/**
 * Verschieben: bisherige Einsätze des Teams, die den neuen überschneiden, rutschen hinter ihn — und was dann wieder
 * kollidiert, rutscht mit (Kette). Beginnt ein bisheriger Einsatz vor dem neuen, bleibt der Teil davor stehen und der
 * Rest kommt nach dem neuen. Was danach mit Abstand folgt, bleibt, wo es ist.
 * `andere`: alle Einsätze des Teams, die am oder nach dem Start des neuen enden (ohne den neuen selbst).
 */
export function verschieben(neu: { von: string; bis: string }, andere: PlanAbschnitt[]): Schritt[] {
  const schritte: Schritt[] = [];
  const liste = [...andere].filter((p) => p.bis >= neu.von).sort((a, b) => a.von.localeCompare(b.von) || a.bis.localeCompare(b.bis));
  let belegtBis = neu.bis;
  for (const p of liste) {
    if (p.von > belegtBis) break; // Lücke: der Rest kollidiert nicht mehr
    if (p.von < neu.von) {
      // Teil davor bleibt, der Rest (in Arbeitstagen) kommt nach dem neuen Einsatz
      const rest = arbeitstage(neu.von, p.bis);
      const davorBis = letzterArbeitstagVor(neu.von);
      if (davorBis >= p.von) schritte.push({ art: 'aendern', id: p.id, von: p.von, bis: davorBis });
      const start = naechsterArbeitstagNach(belegtBis);
      const ende = arbeitstagePlus(start, rest);
      if (davorBis >= p.von) schritte.push({ art: 'neu', vorlage: p.id, von: start, bis: ende });
      else schritte.push({ art: 'aendern', id: p.id, von: start, bis: ende });
      belegtBis = ende;
    } else {
      const laenge = arbeitstage(p.von, p.bis);
      const start = naechsterArbeitstagNach(belegtBis);
      const ende = arbeitstagePlus(start, laenge);
      schritte.push({ art: 'aendern', id: p.id, von: start, bis: ende });
      belegtBis = ende;
    }
  }
  return schritte;
}

/** Streichen: die Tage des neuen Einsatzes fallen bei jedem überschneidenden bisherigen Einsatz weg. */
export function streichen(neu: { von: string; bis: string }, andere: PlanAbschnitt[]): Schritt[] {
  const schritte: Schritt[] = [];
  for (const p of andere) {
    if (!ueberschneiden(p, neu)) continue;
    const { davor, danach } = teile(p, neu.von, neu.bis);
    if (davor) {
      schritte.push({ art: 'aendern', id: p.id, ...davor });
      if (danach) schritte.push({ art: 'neu', vorlage: p.id, ...danach });
    } else if (danach) {
      schritte.push({ art: 'aendern', id: p.id, ...danach });
    } else {
      schritte.push({ art: 'loeschen', id: p.id });
    }
  }
  return schritte;
}

/**
 * Beides mit Zeiten: die bisherigen Einsätze bekommen für die gemeinsamen Tage einen eigenen Abschnitt mit
 * `beginnAlt`; Tage davor und danach behalten ihre bisherige Beginnzeit. Der neue Einsatz bekommt `beginnNeu` (setzt der
 * Dialog selbst).
 */
export function mitZeiten(neu: { von: string; bis: string }, andere: PlanAbschnitt[], beginnAlt: number): Schritt[] {
  const schritte: Schritt[] = [];
  for (const p of andere) {
    if (!ueberschneiden(p, neu)) continue;
    const mitteVon = p.von > neu.von ? p.von : neu.von;
    const mitteBis = p.bis < neu.bis ? p.bis : neu.bis;
    const { davor, danach } = teile(p, mitteVon, mitteBis);
    if (!davor && !danach) {
      schritte.push({ art: 'aendern', id: p.id, von: p.von, bis: p.bis, beginn_min: beginnAlt });
      continue;
    }
    if (davor) {
      schritte.push({ art: 'aendern', id: p.id, ...davor });
      schritte.push({ art: 'neu', vorlage: p.id, von: mitteVon, bis: mitteBis, beginn_min: beginnAlt });
    } else {
      schritte.push({ art: 'aendern', id: p.id, von: mitteVon, bis: mitteBis, beginn_min: beginnAlt });
    }
    if (danach) schritte.push({ art: 'neu', vorlage: p.id, ...danach });
  }
  return schritte;
}

/**
 * Doppelt geplant ohne klare Reihenfolge: zwei oder mehr Einsätze eines Teams am selben Tag, und nicht jeder hat eine
 * eigene Beginnzeit. Mit verschiedenen Zeiten ist es gewollt (Weg «beides mit Zeiten») und kein Konflikt.
 */
export function ohneReihenfolge(einsaetzeAmTag: { beginn_min?: number | null }[]): boolean {
  if (einsaetzeAmTag.length < 2) return false;
  const zeiten = einsaetzeAmTag.map((e) => e.beginn_min ?? null);
  if (zeiten.some((z) => z === null)) return true;
  return new Set(zeiten).size < zeiten.length;
}
