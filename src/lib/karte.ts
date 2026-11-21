/**
 * Tageskarte (24.10.2026, Amir: «so etwas wäre auch krass — mit Karte und wo Einsätze geplant sind», Screenshot Caturix):
 * je Baustelle ein Punkt mit den Teams und Leuten des Tages. Hier nur die Rechnerei (getestet), die Karte zeichnet
 * src/ui/Landkarte.tsx.
 */
import { hatKoordinaten, type Lage } from './adresse';
import type { KartenPerson } from './tageskarte';

export interface PunktBaustelle extends Lage { id: string; konto_nr: string; bezeichnung: string | null }
export interface PunktTeam {
  teamId: string; team: string; chef: string | null; leute: number; soll: number | null; beginn_min: number | null;
  /** Für die Detailkarte (25.10.2026): Treffpunkt, Hinweis und wer an dem Tag da ist, fehlt oder weg ist */
  treffpunkt?: string | null; hinweis?: string | null; personen?: KartenPerson[];
  /** Ist das Team an diesem Tag auf mehreren Baustellen: die wievielte (nach Beginn) und wie viele (21.11.2026) */
  reihe?: number; stopps?: number;
}
export interface KartenPunkt { baustelle: PunktBaustelle; teams: PunktTeam[]; leute: number }

/**
 * Einsätze eines Tages → Punkte: Teams auf derselben Baustelle teilen sich einen Punkt (Leute zusammengezählt), ein
 * Team auf zwei Baustellen steht an beiden. Ohne geprüften Ort: eigene Liste — die Karte kann sie nicht zeigen.
 */
export function punkteAm(o: {
  einsaetze: { team_id: string | null; soll_leute?: number | null; beginn_min?: number | null; treffpunkt?: string | null; hinweis?: string | null; baustelle: PunktBaustelle | null }[];
  teams: Map<string, { name: string; chef: string | null }>;
  /** Leute je Team an diesem Tag (ohne Abwesende) */
  leute: Map<string, number>;
  /** Wer je Team an diesem Tag da ist, dazukommt, fehlt (für die Detailkarte) */
  personen?: Map<string, KartenPerson[]>;
}): { mitOrt: KartenPunkt[]; ohneOrt: KartenPunkt[] } {
  const je = new Map<string, KartenPunkt>();
  for (const e of o.einsaetze) {
    if (!e.baustelle || !e.team_id) continue;
    const t = o.teams.get(e.team_id);
    if (!t) continue; // inaktives Team
    const p = je.get(e.baustelle.id) ?? { baustelle: e.baustelle, teams: [], leute: 0 };
    if (!p.teams.some((x) => x.teamId === e.team_id)) {
      const n = o.leute.get(e.team_id) ?? 0;
      p.teams.push({
        teamId: e.team_id, team: t.name, chef: t.chef, leute: n, soll: e.soll_leute ?? null, beginn_min: e.beginn_min ?? null,
        treffpunkt: e.treffpunkt ?? null, hinweis: e.hinweis ?? null, personen: o.personen?.get(e.team_id) ?? [],
      });
      p.leute += n;
    }
    je.set(e.baustelle.id, p);
  }
  // Ein Team auf mehreren Baustellen: Reihenfolge nach Beginn (21.11.2026, Amir: zweimal «Team 1» verwirrt) — ohne Zeit zuletzt
  const jeTeam = new Map<string, PunktTeam[]>();
  for (const p of je.values()) for (const t of p.teams) jeTeam.set(t.teamId, [...(jeTeam.get(t.teamId) ?? []), t]);
  for (const liste of jeTeam.values()) {
    if (liste.length < 2) continue;
    liste.sort((a, b) => (a.beginn_min ?? 24 * 60) - (b.beginn_min ?? 24 * 60));
    liste.forEach((t, i) => { t.reihe = i + 1; t.stopps = liste.length; });
  }
  const alle = [...je.values()]
    .map((p) => ({ ...p, teams: p.teams.sort((a, b) => a.team.localeCompare(b.team, 'de', { numeric: true })) }))
    .sort((a, b) => a.teams[0].team.localeCompare(b.teams[0].team, 'de', { numeric: true }));
  return { mitOrt: alle.filter((p) => hatKoordinaten(p.baustelle)), ohneOrt: alle.filter((p) => !hatKoordinaten(p.baustelle)) };
}

/**
 * Suchfeld der Karte: Team, Chefmonteur, Baustelle, Konto-Nr. oder Adresse. Jedes Wort muss am Anfang eines Wortes
 * passen — sonst fände «Team 2» auch Team 1, weil irgendwo eine 2 steht («Brünnenstrasse 120»).
 */
export function punktPasst(p: KartenPunkt, suche: string): boolean {
  const q = suche.trim().toLocaleLowerCase('de-CH');
  if (!q) return true;
  const woerter = [p.baustelle.konto_nr, p.baustelle.bezeichnung, p.baustelle.strasse, p.baustelle.plz, p.baustelle.ort, ...p.teams.flatMap((t) => [t.team, t.chef])]
    .filter(Boolean).join(' ').toLocaleLowerCase('de-CH').split(/[\s,.;:()/-]+/);
  return q.split(/\s+/).every((w) => woerter.some((x) => x.startsWith(w)));
}

/** Wege der Teams, die an einem Tag auf mehreren Baustellen sind — Baustellen in der Reihenfolge nach Beginn. */
export function wegeAm(punkte: KartenPunkt[]): { teamId: string; team: string; halte: { punkt: KartenPunkt; beginn_min: number | null; treffpunkt: string | null }[] }[] {
  const je = new Map<string, { teamId: string; team: string; halte: { punkt: KartenPunkt; beginn_min: number | null; treffpunkt: string | null; reihe: number }[] }>();
  for (const p of punkte) {
    for (const t of p.teams) {
      if (!t.stopps || t.stopps < 2 || !t.reihe) continue;
      const w = je.get(t.teamId) ?? { teamId: t.teamId, team: t.team, halte: [] };
      w.halte.push({ punkt: p, beginn_min: t.beginn_min, treffpunkt: t.treffpunkt ?? null, reihe: t.reihe });
      je.set(t.teamId, w);
    }
  }
  return [...je.values()]
    .filter((w) => w.halte.length >= 2)
    .map((w) => ({ teamId: w.teamId, team: w.team, halte: w.halte.sort((a, b) => a.reihe - b.reihe).map(({ punkt, beginn_min, treffpunkt }) => ({ punkt, beginn_min, treffpunkt })) }))
    .sort((a, b) => a.team.localeCompare(b.team, 'de', { numeric: true }));
}
