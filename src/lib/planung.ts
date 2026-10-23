/**
 * Planung (06.10.2026, ersetzt das Board): welches Team wann auf welcher Baustelle ist — für einen Tag,
 * eine Woche oder länger. Die Zeilen stehen in `jahresplan` (Team, Baustelle, von, bis); Erfassung und
 * Tagesübersicht lesen daraus, welche Baustelle sie vorschlagen.
 *
 * Hier nur die Rechnerei, damit sie getestet ist: Ausschnitt im sichtbaren Fenster, Spuren für Einsätze,
 * die sich überschneiden (halber Tag hier, halber Tag dort), und die Schnellwahl der Zeiträume.
 */
import { addTage, ausIso, iso } from './datum';
import { istArbeitstag } from './feiertage';

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

/** Arbeitstage (Mo–Fr ohne Feiertage) im Zeitraum — für den Satz unter den Datumsfeldern. */
export function arbeitstage(z: Zeitraum): number {
  const n = tageZwischen(z.von, z.bis);
  let zahl = 0;
  for (let i = 0; i <= n; i++) if (istArbeitstag(addTage(ausIso(z.von), i))) zahl++;
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

// ── Verlauf, Plan vom Montag, Tatsächlich (Migration 0038, Mehmeti 10.10.2026) ─────────────────

/** Ein Eintrag aus `plan_verlauf`: jede Änderung an Einsätzen und Einteilungen, vom Auslöser mitgeschrieben. */
export interface VerlaufZeile {
  tabelle: 'jahresplan' | 'einsatz_person';
  datensatz_id: string;
  aktion: 'neu' | 'geaendert' | 'geloescht';
  vorher: Record<string, unknown> | null;
  nachher: Record<string, unknown> | null;
  zeit: string;
}

/** Ein Einsatz, wie er in `jahresplan` steht (ohne verknüpfte Baustelle). */
export interface PlanStand {
  id: string;
  team_id: string | null;
  baustelle_id: string | null;
  von: string;
  bis: string;
}

function planAus(o: Record<string, unknown>): PlanStand {
  return { id: String(o.id), team_id: (o.team_id as string | null) ?? null, baustelle_id: (o.baustelle_id as string | null) ?? null, von: String(o.von), bis: String(o.bis) };
}

/**
 * Der Plan zu einem früheren Zeitpunkt (z. B. Montag früh): vom heutigen Stand rückwärts durch den Verlauf — was nach
 * `zeitpunkt` neu kam, fällt weg, Geändertes und Gelöschtes kommt in den alten Zustand zurück. Einsätze von vor dem
 * Verlauf (vor 0038) bleiben, wie sie sind. Zeiten werden als Zeitpunkte verglichen, nicht als Text.
 */
export function planAm(jetzt: PlanStand[], verlauf: VerlaufZeile[], zeitpunkt: string): PlanStand[] {
  const grenze = Date.parse(zeitpunkt);
  const stand = new Map(jetzt.map((p) => [p.id, { ...p }]));
  const spaeter = verlauf
    .filter((v) => v.tabelle === 'jahresplan' && Date.parse(v.zeit) > grenze)
    .sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit));
  for (const v of spaeter) {
    if (v.aktion === 'neu') stand.delete(v.datensatz_id);
    else if (v.vorher) stand.set(v.datensatz_id, planAus(v.vorher));
  }
  return [...stand.values()];
}

/** Gemeldete Tage → Balken: dieselbe Baustelle an aufeinanderfolgenden Daten ist ein Balken. */
export function istBalken(tage: { team_id: string; datum: string; baustelle_id: string }[]): PlanStand[] {
  const einmal = [...new Map(tage.map((t) => [`${t.team_id}|${t.baustelle_id}|${t.datum}`, t])).values()]
    .sort((a, b) => a.team_id.localeCompare(b.team_id) || a.baustelle_id.localeCompare(b.baustelle_id) || a.datum.localeCompare(b.datum));
  const out: PlanStand[] = [];
  for (const t of einmal) {
    const letzter = out[out.length - 1];
    if (letzter && letzter.team_id === t.team_id && letzter.baustelle_id === t.baustelle_id && iso(addTage(ausIso(letzter.bis), 1)) === t.datum) {
      letzter.bis = t.datum;
    } else {
      out.push({ id: `ist|${t.team_id}|${t.baustelle_id}|${t.datum}`, team_id: t.team_id, baustelle_id: t.baustelle_id, von: t.datum, bis: t.datum });
    }
  }
  return out;
}

export interface EinteilungsGruppe {
  mitarbeiter_id: string;
  team_id: string | null;
  aktion: 'neu' | 'geaendert' | 'geloescht';
  zeit: string;
  tage: string[];
}

/**
 * Einteilungen fürs Lesen bündeln: «bis Freitag» schreibt eine Zeile je Tag — im Verlauf soll es eine Zeile sein
 * («Luan Do 15.–Fr 16.10.: in Team 7»). Gleiche Person, gleiches Team, gleiche Aktion, gleiche Minute = eine Gruppe.
 */
export function einteilungenBuendeln(verlauf: VerlaufZeile[]): EinteilungsGruppe[] {
  const gruppen = new Map<string, EinteilungsGruppe>();
  for (const v of verlauf) {
    if (v.tabelle !== 'einsatz_person') continue;
    const d = (v.nachher ?? v.vorher) as Record<string, unknown> | null;
    if (!d) continue;
    const ma = String(d.mitarbeiter_id);
    const team = (d.team_id as string | null) ?? null;
    const minute = new Date(Date.parse(v.zeit)).toISOString().slice(0, 16);
    const key = `${ma}|${team}|${v.aktion}|${minute}`;
    const g = gruppen.get(key) ?? { mitarbeiter_id: ma, team_id: team, aktion: v.aktion, zeit: v.zeit, tage: [] };
    g.tage.push(String(d.datum));
    gruppen.set(key, g);
  }
  return [...gruppen.values()].map((g) => ({ ...g, tage: [...new Set(g.tage)].sort() })).sort((a, b) => Date.parse(a.zeit) - Date.parse(b.zeit));
}

// ── Änderungshinweis für den Chefmonteur (11.10.2026, Amir: Umplanungen müssen das Team erreichen) ──────────

export type HinweisArt = 'baustelle' | 'weg' | 'dazu' | 'zurueck' | 'nicht-mehr';
export interface PlanHinweis {
  tag: string;
  art: HinweisArt;
  /** jüngste Änderung, die zu diesem Hinweis gehört */
  zeit: string;
  /** baustelle: Baustellen, die vorher für den Tag geplant waren */
  alt?: string[];
  mitarbeiter_id?: string;
  /** weg: in welches Team */
  team_id?: string | null;
}

/**
 * Was hat sich seit `seit` für dieses Team an den Tagen `tage` geändert? Verglichen wird der Stand von damals mit dem
 * von jetzt — nicht die einzelnen Schritte: Wird ein Einsatz gelöscht und gleich wieder gleich angelegt (z. B. Demo neu
 * geladen), ist nichts geändert. Baustelle (geplant jetzt ≠ geplant damals) und Leute (eigene Leute in einem anderen
 * Team, Fremde dazu, zurück). Die App zeigt daraus auf der Startseite «Plan geändert» und markiert im Teamgerät die neu
 * geplante Baustelle.
 *
 * Baustelle nur, wenn für den Tag damals schon etwas geplant war: Ein Tag, der neu verplant wird, ist keine Umplanung —
 * sonst hätte jedes Team am Montag «Plan geändert», weil die Woche am Freitag geplant wurde (und nach dem Laden der
 * Demo, die alle Teams neu anlegt, jedes Teamgerät).
 *
 * `jetzt` = heutige Einsätze des Teams, `einteilungen` = heutige Einteilungen an diesen Tagen (alle Teams).
 */
export function planHinweise(
  teamId: string, mitglieder: string[], tage: string[], verlauf: VerlaufZeile[], seit: string,
  jetzt: PlanStand[], einteilungen: { mitarbeiter_id: string; team_id: string; datum: string }[],
): PlanHinweis[] {
  const grenze = Date.parse(seit);
  const neu = verlauf.filter((v) => Date.parse(v.zeit) > grenze);
  const damals = planAm(jetzt, verlauf, seit);
  const zuletzt = (pruef: (v: VerlaufZeile) => boolean) => neu.filter(pruef).reduce((z, v) => (Date.parse(v.zeit) > Date.parse(z) ? v.zeit : z), seit);
  const deckt = (o: Record<string, unknown> | null, tag: string) => !!o && String(o.von) <= tag && String(o.bis) >= tag;
  const out: PlanHinweis[] = [];
  for (const tag of tage) {
    // Baustelle: was jetzt für den Tag geplant ist gegen damals
    const auf = (liste: PlanStand[]) => [...new Set(liste.filter((p) => p.team_id === teamId && p.von <= tag && p.bis >= tag).map((p) => p.baustelle_id ?? ''))].sort();
    const vorher = auf(damals), nachher = auf(jetzt);
    if (vorher.length > 0 && vorher.join() !== nachher.join()) {
      out.push({ tag, art: 'baustelle', zeit: zuletzt((v) => v.tabelle === 'jahresplan' && ((deckt(v.vorher, tag) && v.vorher?.team_id === teamId) || (deckt(v.nachher, tag) && v.nachher?.team_id === teamId))), alt: vorher.filter((x) => !nachher.includes(x)) });
    }
    // Leute: Einteilung damals (rückwärts aus dem Verlauf) gegen jetzt, je Person
    const jetztTeam = new Map(einteilungen.filter((e) => e.datum === tag).map((e) => [e.mitarbeiter_id, e.team_id] as const));
    const damalsTeam = new Map(jetztTeam);
    const geaendertAm = new Map<string, string>();
    for (const v of [...neu].filter((x) => x.tabelle === 'einsatz_person').sort((x, y) => Date.parse(y.zeit) - Date.parse(x.zeit))) {
      const e = (v.nachher ?? v.vorher) as Record<string, unknown> | null;
      if (!e || String(e.datum) !== tag) continue;
      const ma = String(e.mitarbeiter_id);
      if (!geaendertAm.has(ma)) geaendertAm.set(ma, v.zeit);
      if (v.aktion === 'neu') damalsTeam.delete(ma);
      else if (v.vorher) damalsTeam.set(ma, String(v.vorher.team_id));
    }
    for (const [ma, zeit] of geaendertAm) {
      const vor = damalsTeam.get(ma) ?? null, nach = jetztTeam.get(ma) ?? null;
      if (vor === nach) continue;
      const eigen = mitglieder.includes(ma);
      if (eigen) {
        if (nach && nach !== teamId) out.push({ tag, art: 'weg', zeit, mitarbeiter_id: ma, team_id: nach });
        else if (!nach && vor && vor !== teamId) out.push({ tag, art: 'zurueck', zeit, mitarbeiter_id: ma });
      } else if (nach === teamId) out.push({ tag, art: 'dazu', zeit, mitarbeiter_id: ma });
      else if (vor === teamId) out.push({ tag, art: 'nicht-mehr', zeit, mitarbeiter_id: ma });
    }
  }
  return out;
}

/** Heute und der nächste Arbeitstag (Fr → Mo, über Feiertage hinweg) — die Tage, für die der Chefmonteur Änderungen sehen muss. */
export function heuteUndNaechster(heute: Date): string[] {
  let n = addTage(heute, 1);
  while (!istArbeitstag(n)) n = addTage(n, 1);
  return [iso(heute), iso(n)];
}

// ── Konfliktliste (24.10.2026, Caturix-Analyse «Als Nächstes» Nr. 1) ──────────────────────────────

/** Ein Einsatz mit dem, was die Konfliktliste braucht (`soll_leute` seit Migration 0049, sonst null). */
export interface EinsatzSoll extends Zeitraum {
  team_id: string | null;
  baustelle_id: string | null;
  soll_leute: number | null;
}

export type KonfliktArt = 'ohne-leute' | 'chef-fehlt' | 'unter-soll' | 'abwesend-eingeteilt' | 'eingeteilt-ohne-einsatz' | 'ohne-einsatz';

export interface Konflikt {
  art: KonfliktArt;
  datum: string;
  team_id: string;
  /** Person, um die es geht (abwesend eingeteilt, Chefmonteur fehlt) */
  mitarbeiter_id?: string;
  /** Leute an dem Tag (ohne Abwesende) */
  ist?: number;
  soll?: number;
  /** Baustelle des Einsatzes mit dem höchsten Soll bzw. die erste geplante */
  baustelle_id?: string | null;
  /** Chefmonteur fehlt: in welchem Team er an dem Tag ist (sonst abwesend) */
  nach_team?: string;
}

const RANG: Record<KonfliktArt, number> = { 'ohne-leute': 0, 'chef-fehlt': 1, 'unter-soll': 2, 'abwesend-eingeteilt': 3, 'eingeteilt-ohne-einsatz': 4, 'ohne-einsatz': 5 };

/**
 * Was in der Planung zu lösen ist — wenige Regeln, damit die Liste ernst genommen wird (lieber eine Meldung zu wenig
 * als zehn, die niemand liest). Nur Arbeitstage (Mo–Fr ohne Feiertage), je Team und Tag:
 *
 *  - ohne-leute: ein Einsatz ist geplant, aber niemand ist da (alle abwesend, versetzt oder nie eingeteilt)
 *  - chef-fehlt: der Chefmonteur des Teams ist abwesend oder in einem anderen Team — wer meldet den Tag?
 *  - unter-soll: weniger Leute da, als der Einsatz braucht (nur wenn «Leute nötig» gesetzt ist; bei zwei Einsätzen am
 *    Tag gilt das grössere Soll)
 *  - abwesend-eingeteilt: jemand ist für den Tag in ein Team eingeteilt, aber abwesend gemeldet
 *  - eingeteilt-ohne-einsatz: Leute sind eingeteilt, das Team hat an dem Tag aber keine Baustelle
 *  - ohne-einsatz: ein Team mit Leuten hat keine Baustelle — nur für `ohneEinsatzTage` (heute und der nächste
 *    Arbeitstag), sonst stünde jede noch nicht geplante Zukunftswoche voll
 *
 * Mehrere Teams auf derselben Baustelle sind normal (Glossar) und kein Konflikt; ein Team auf zwei Baustellen am selben
 * Tag auch nicht (halber Tag hier, halber Tag dort — der Einsatz-Dialog weist darauf hin).
 */
export function konflikte(o: {
  tage: string[];
  teams: { id: string; chefmonteur_id: string | null }[];
  basis: Map<string, string[]>;
  versetzt: Versetzung[];
  plaene: EinsatzSoll[];
  /** datum → (Person → Art der Abwesenheit) */
  abwesend: Map<string, Map<string, string>>;
  ohneEinsatzTage?: string[];
}): Konflikt[] {
  const out: Konflikt[] = [];
  for (const datum of o.tage) {
    if (!istArbeitstag(datum)) continue;
    const bz = besetzung(o.basis, o.versetzt, datum);
    const abw = o.abwesend.get(datum) ?? new Map<string, string>();
    for (const team of o.teams) {
      const b = bz.get(team.id) ?? { ids: [], dazu: [], weg: [] };
      const da = b.ids.filter((id) => !abw.has(id));
      const n = da.length;
      const einsaetze = o.plaene.filter((p) => p.team_id === team.id && p.von <= datum && p.bis >= datum);
      for (const id of b.dazu) if (abw.has(id)) out.push({ art: 'abwesend-eingeteilt', datum, team_id: team.id, mitarbeiter_id: id });
      if (einsaetze.length > 0) {
        const mitSoll = einsaetze.filter((p) => p.soll_leute !== null).sort((x, y) => (y.soll_leute ?? 0) - (x.soll_leute ?? 0));
        const haupt = mitSoll[0] ?? einsaetze[0];
        if (n === 0) {
          out.push({ art: 'ohne-leute', datum, team_id: team.id, ist: 0, soll: mitSoll[0]?.soll_leute ?? undefined, baustelle_id: haupt.baustelle_id });
          continue;
        }
        const chef = team.chefmonteur_id;
        if (chef && (o.basis.get(team.id) ?? []).includes(chef) && !da.includes(chef)) {
          const weg = b.weg.find((w) => w.id === chef);
          out.push({ art: 'chef-fehlt', datum, team_id: team.id, mitarbeiter_id: chef, baustelle_id: haupt.baustelle_id, ...(weg ? { nach_team: weg.nach } : {}) });
        }
        const soll = mitSoll[0]?.soll_leute;
        if (soll !== undefined && soll !== null && n < soll) out.push({ art: 'unter-soll', datum, team_id: team.id, ist: n, soll, baustelle_id: haupt.baustelle_id });
      } else if (b.dazu.length > 0) {
        out.push({ art: 'eingeteilt-ohne-einsatz', datum, team_id: team.id, ist: b.dazu.length });
      } else if (n > 0 && o.ohneEinsatzTage?.includes(datum)) {
        out.push({ art: 'ohne-einsatz', datum, team_id: team.id, ist: n });
      }
    }
  }
  return out.sort((x, y) => x.datum.localeCompare(y.datum) || RANG[x.art] - RANG[y.art]);
}

/** Ein Konflikt über mehrere aufeinanderfolgende Arbeitstage: `datum` = erster Tag, `bis` = letzter. */
export interface KonfliktBlock extends Konflikt { bis: string; tage: number }

/**
 * Derselbe Konflikt an aufeinanderfolgenden Arbeitstagen wird eine Zeile («Mo 26.10. – Fr 30.10.: 3 von 4 Leuten»):
 * fehlt einem Team für einen zweiwöchigen Einsatz eine Person, stünden sonst zehn gleiche Zeilen in der Liste.
 * Gleich heisst: dieselbe Art, dasselbe Team, dieselbe Person, Zahlen und Baustelle. Wochenende und Feiertage
 * dazwischen unterbrechen nicht.
 */
export function konflikteBuendeln(liste: Konflikt[]): KonfliktBlock[] {
  const schluessel = (k: Konflikt) => [k.art, k.team_id, k.mitarbeiter_id ?? '', k.ist ?? '', k.soll ?? '', k.baustelle_id ?? '', k.nach_team ?? ''].join('|');
  const naechsterArbeitstag = (d: string) => { let n = addTage(ausIso(d), 1); while (!istArbeitstag(n)) n = addTage(n, 1); return iso(n); };
  const offen = new Map<string, KonfliktBlock>();
  const bloecke: KonfliktBlock[] = [];
  for (const k of [...liste].sort((x, y) => x.datum.localeCompare(y.datum))) {
    const s = schluessel(k);
    const b = offen.get(s);
    if (b && naechsterArbeitstag(b.bis) === k.datum) { b.bis = k.datum; b.tage++; continue; }
    const neu = { ...k, bis: k.datum, tage: 1 };
    offen.set(s, neu);
    bloecke.push(neu);
  }
  return bloecke.sort((x, y) => x.datum.localeCompare(y.datum) || RANG[x.art] - RANG[y.art]);
}
