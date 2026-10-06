/**
 * Planung (06.10.2026, ersetzt das Board): welches Team wann auf welcher Baustelle ist — für einen Tag,
 * eine Woche oder länger. Die Zeilen stehen in `jahresplan` (Team, Baustelle, von, bis); Erfassung und
 * Tagesübersicht lesen daraus, welche Baustelle sie vorschlagen.
 *
 * Hier nur die Rechnerei, damit sie getestet ist: Ausschnitt im sichtbaren Fenster, Spuren für Einsätze,
 * die sich überschneiden (halber Tag hier, halber Tag dort), und die Schnellwahl der Zeiträume.
 */
import { addTage, ausIso, iso } from './datum';

export interface Zeitraum {
  von: string;
  bis: string;
}

/** Ganze Tage von `a` bis `b` (ISO-Daten), über Mittag gerechnet — Sommerzeit verschiebt nichts. */
export function tageZwischen(a: string, b: string): number {
  return Math.round((ausIso(b).getTime() - ausIso(a).getTime()) / 86400000);
}

/** Wo ein Einsatz im Fenster `start` + `tage` liegt — Indizes der Tage, und ob er links/rechts weitergeht. Ausserhalb: null. */
export function ausschnitt(p: Zeitraum, start: string, tage: number): { ab: number; bis: number; links: boolean; rechts: boolean } | null {
  const ab = tageZwischen(start, p.von);
  const bis = tageZwischen(start, p.bis);
  if (bis < 0 || ab > tage - 1) return null;
  return { ab: Math.max(0, ab), bis: Math.min(tage - 1, bis), links: ab < 0, rechts: bis > tage - 1 };
}

/**
 * Einsätze eines Teams auf Spuren verteilen: was sich zeitlich überschneidet, kommt in die nächste Spur.
 * Früher beginnende zuerst, damit die Hauptbaustelle oben bleibt.
 */
export function spuren<T extends Zeitraum>(plaene: T[], start: string, tage: number): { plan: T; spur: number; ab: number; bis: number; links: boolean; rechts: boolean }[] {
  const sichtbar = plaene
    .map((plan) => ({ plan, a: ausschnitt(plan, start, tage) }))
    .filter((x): x is { plan: T; a: NonNullable<ReturnType<typeof ausschnitt>> } => x.a !== null)
    .sort((x, y) => x.plan.von.localeCompare(y.plan.von) || y.plan.bis.localeCompare(x.plan.bis));
  const spurEnde: number[] = [];
  return sichtbar.map(({ plan, a }) => {
    let spur = spurEnde.findIndex((ende) => ende < a.ab);
    if (spur === -1) spur = spurEnde.length;
    spurEnde[spur] = a.bis;
    return { plan, spur, ...a };
  });
}

export type Schnellwahl = 'tag' | 'woche' | 'zwei' | 'vier';

/** Freitag derselben Woche (Sa/So: der Tag selbst — am Wochenende plant man nicht «bis Freitag»). */
function freitagVon(d: Date): Date {
  const wt = (d.getDay() + 6) % 7; // Mo = 0
  return wt <= 4 ? addTage(d, 4 - wt) : d;
}

/** Schnellwahl ab einem Tag: nur dieser Tag, bis Freitag, zwei oder vier Wochen (jeweils bis Freitag). */
export function zeitraumVorschlag(art: Schnellwahl, tag: Date): Zeitraum {
  const von = iso(tag);
  if (art === 'tag') return { von, bis: von };
  const wochen = art === 'woche' ? 0 : art === 'zwei' ? 1 : 3;
  return { von, bis: iso(addTage(freitagVon(tag), 7 * wochen)) };
}

/** Arbeitstage (Mo–Fr) im Zeitraum — für den Satz unter den Datumsfeldern. */
export function arbeitstage(z: Zeitraum): number {
  const n = tageZwischen(z.von, z.bis);
  let zahl = 0;
  for (let i = 0; i <= n; i++) {
    const wt = (addTage(ausIso(z.von), i).getDay() + 6) % 7;
    if (wt <= 4) zahl++;
  }
  return zahl;
}

/** Überschneiden sich zwei Zeiträume (Ränder zählen mit)? */
export function ueberschneiden(a: Zeitraum, b: Zeitraum): boolean {
  return a.von <= b.bis && b.von <= a.bis;
}
