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

// ── Einsatzplanung je Tag (Mehmeti, 10.10.2026) ────────────────────────────────────────────────

/** Eine Person ist an einem Tag in einem anderen Team (Tabelle `einsatz_person`, Migration 0036). */
export interface Versetzung {
  datum: string;
  mitarbeiter_id: string;
  team_id: string;
}

export interface TagesBesetzung {
  /** Wer an dem Tag im Team ist: feste Mitglieder ohne die Versetzten, plus die Eingeteilten */
  ids: string[];
  /** Aus einem anderen Team (oder ohne Team) für den Tag eingeteilt */
  dazu: string[];
  /** Feste Mitglieder, die an dem Tag in einem anderen Team sind */
  weg: { id: string; nach: string }[];
}

/**
 * Wer ist an `datum` in welchem Team? `basis` = feste Mitglieder je Team (team_mitglied), `versetzt` = Einteilungen für
 * einzelne Tage. Eine Versetzung ins eigene Team ändert nichts. Teams ohne Eintrag in `basis` (neues Zusatzteam) zählen
 * mit, sobald jemand dorthin eingeteilt ist.
 */
export function besetzung(basis: Map<string, string[]>, versetzt: Versetzung[], datum: string): Map<string, TagesBesetzung> {
  const stamm = new Map<string, string>();
  for (const [team, ids] of basis) for (const id of ids) if (!stamm.has(id)) stamm.set(id, team);
  const heute = new Map<string, string>();
  for (const v of versetzt) if (v.datum === datum) heute.set(v.mitarbeiter_id, v.team_id);
  const out = new Map<string, TagesBesetzung>();
  const team = (id: string) => {
    let t = out.get(id);
    if (!t) { t = { ids: [], dazu: [], weg: [] }; out.set(id, t); }
    return t;
  };
  for (const [teamId, ids] of basis) {
    const t = team(teamId);
    for (const id of ids) {
      const ziel = heute.get(id);
      if (stamm.get(id) !== teamId) continue; // zweimal fest eingetragen: zählt im ersten Team
      if (ziel && ziel !== teamId) t.weg.push({ id, nach: ziel });
      else t.ids.push(id);
    }
  }
  for (const [id, ziel] of heute) {
    if (stamm.get(id) === ziel) continue;
    const t = team(ziel);
    t.ids.push(id);
    t.dazu.push(id);
  }
  return out;
}

/** Einen Tag aus einem Einsatz herausschneiden («nur an diesem Tag andere Baustelle»): was davor und danach bleibt. */
export function ohneTag(p: Zeitraum, tag: string): { vorher: Zeitraum | null; nachher: Zeitraum | null } {
  if (tag < p.von || tag > p.bis) return { vorher: { ...p }, nachher: null };
  const d = ausIso(tag);
  return {
    vorher: tag > p.von ? { von: p.von, bis: iso(addTage(d, -1)) } : null,
    nachher: tag < p.bis ? { von: iso(addTage(d, 1)), bis: p.bis } : null,
  };
}

export type PlanIst = 'wie-geplant' | 'anders' | 'nichts' | 'ohne-plan' | null;

/**
 * Plan gegen Ist für einen Team-Tag (Kontrolle, wenn die Woche vorbei ist): gemeldete Baustellen gegen geplante.
 * `nichts` = geplant, aber keine Meldung; `ohne-plan` = gemeldet ohne Plan; null = weder noch.
 */
export function planIst(geplant: string[], gemeldet: string[]): PlanIst {
  if (gemeldet.length === 0) return geplant.length > 0 ? 'nichts' : null;
  if (geplant.length === 0) return 'ohne-plan';
  return gemeldet.every((b) => geplant.includes(b)) ? 'wie-geplant' : 'anders';
}

/** Nächster freier Teamname: «Team 7», wenn es Team 1–6 gibt. */
export function naechsterTeamName(namen: string[]): string {
  const zahlen = namen.map((n) => /^team\s*(\d+)$/i.exec(n.trim())?.[1]).filter((x): x is string => !!x).map(Number);
  return `Team ${zahlen.length ? Math.max(...zahlen) + 1 : namen.length + 1}`;
}
