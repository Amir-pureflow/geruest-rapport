// Lieferwagen für Subunternehmer (Migration 0036, Arbnor 10.10.2026).
import type { LieferwagenExportZeile } from './excel';

/** Meldung mit «Lieferwagen der Firma gebraucht» — mit den Leuten, die an dem Tag dabei waren (Zeiteinträge) */
export interface LieferZeile {
  datum: string;
  team_id: string | null;
  team: { bezeichnung: string } | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag?: { mitarbeiter: { name: string; typ: string; subunternehmer_firma?: string | null } | null }[] | null;
}

/**
 * Lieferwagen-Tage (Arbnor, 10.10.2026): pro Team und Tag einmal verrechnen, auch wenn das Team an zwei Baustellen
 * gemeldet hat — die Baustellen stehen dann zusammen in einer Zeile. Betrag = Tagessatz aus den Einstellungen.
 * `subunternehmer` = die Externen, die an dem Tag in der Meldung standen (Amir 13.10.2026: das Back-Office muss wissen,
 * wem es die Fr. 100 abzieht — das Team allein sagt das nicht, Leute werden auch mitten in der Woche versetzt);
 * `firmen` = ihre Firmen (0040, in der Verwaltung erfasst), ohne Doppelte.
 */
export function lieferwagenTage(zeilen: LieferZeile[], tagRp: number): LieferwagenExportZeile[] {
  const tage = new Map<string, { datum: string; team: string; konten: Set<string>; externe: Set<string>; firmen: Set<string> }>();
  for (const z of zeilen) {
    const key = `${z.team_id ?? '—'}|${z.datum}`;
    const t = tage.get(key) ?? { datum: z.datum, team: z.team?.bezeichnung ?? 'ohne Team', konten: new Set<string>(), externe: new Set<string>(), firmen: new Set<string>() };
    if (z.baustelle) t.konten.add(`${z.baustelle.konto_nr}${z.baustelle.bezeichnung ? ' ' + z.baustelle.bezeichnung : ''}`);
    for (const e of z.zeiteintrag ?? []) {
      if (e.mitarbeiter?.typ !== 'extern') continue;
      t.externe.add(e.mitarbeiter.name);
      if (e.mitarbeiter.subunternehmer_firma?.trim()) t.firmen.add(e.mitarbeiter.subunternehmer_firma.trim());
    }
    tage.set(key, t);
  }
  return [...tage.values()]
    .map((t) => ({
      datum: t.datum, team: t.team, baustellen: [...t.konten].join(' · '),
      firmen: [...t.firmen].sort((a, b) => a.localeCompare(b, 'de')).join(', '),
      subunternehmer: [...t.externe].sort((a, b) => a.localeCompare(b, 'de')).join(', '), betrag_rp: tagRp,
    }))
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.team.localeCompare(b.team, 'de', { numeric: true }));
}
