/**
 * Abfragen für Diagramm und Team-Board der Bauführer-Startseite.
 *
 * Alles rechnet in Minuten als Integer (CLAUDE.md #6) — umgerechnet wird erst bei der Ausgabe.
 * Die Regie-Abfragen (Trichter der Zusatzaufträge, Regie je Monat, Fristen) liegen seit 20.09.
 * in archiv/regie-und-board/ — SORBA macht die Regie, nicht die App.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addTage, iso, montag, WOCHENTAGE, kurz } from './datum';

export interface WochenTag {
  label: string;
  datum: string;
  /** Teams, bei denen an diesem Tag noch mindestens ein Eintrag auf die Freigabe wartet — die Arbeit des Bauführers. */
  offen: number;
  /** Teams, deren Tag komplett freigegeben ist. */
  freigegeben: number;
}

/**
 * Teams je Tag der Woche, aufgeteilt nach Freigabestand.
 *
 * Stunden waren hier eine Firmensumme ohne Frage dahinter («64 h am Dienstag» — wie viele Leute?).
 * Der Bauführer denkt in Teams, wie die Wochenübersicht: «8 Teams offen, 2 freigegeben» versteht
 * er sofort. Ein Team-Tag gilt als freigegeben, wenn alle seine Einträge freigegeben sind.
 */
export async function wochenTeams(c: SupabaseClient, bezug: Date): Promise<WochenTag[]> {
  const mo = montag(bezug);
  const tage: WochenTag[] = WOCHENTAGE.map((label, i) => ({
    label,
    datum: kurz(addTage(mo, i)),
    offen: 0,
    freigegeben: 0,
  }));
  const { data } = await c
    .from('zeiteintrag')
    .select('status,tagesmeldung!inner(datum,team_id)')
    .gte('tagesmeldung.datum', iso(mo))
    .lte('tagesmeldung.datum', iso(addTage(mo, 6)));

  // Tag → Team → hat noch offene Einträge?
  const proTag: Map<string, boolean>[] = tage.map(() => new Map());
  for (const z of (data ?? []) as unknown as {
    status: string;
    tagesmeldung: { datum: string; team_id: string | null } | { datum: string; team_id: string | null }[];
  }[]) {
    // Supabase liefert die verknüpfte Zeile je nach Version als Objekt oder als Liste
    const tm = Array.isArray(z.tagesmeldung) ? z.tagesmeldung[0] : z.tagesmeldung;
    if (!tm?.datum) continue;
    const index = Math.round((new Date(tm.datum + 'T12:00:00').getTime() - mo.getTime()) / 86400000);
    if (index < 0 || index > 6) continue;
    const team = tm.team_id ?? 'ohne-team';
    const bisher = proTag[index].get(team) ?? false;
    proTag[index].set(team, bisher || z.status !== 'freigegeben');
  }
  proTag.forEach((teams, i) => {
    for (const offen of teams.values()) {
      if (offen) tage[i].offen += 1;
      else tage[i].freigegeben += 1;
    }
  });
  return tage;
}

export interface TeamStand {
  id: string;
  bezeichnung: string;
  /** Wen der Bauführer anruft, wenn die Meldung fehlt. */
  chefmonteur: string | null;
  gemeldetUm: string | null;
  baustelle: string | null;
  /** Verschiedene Baustellen am selben Tag — dann zählt die Zahl statt eines Namens. */
  anzahlBaustellen: number;
  /** Überstunden gemeldet (oder eine Abweichung aus alten Daten) — der Bauführer liest die Notiz. */
  abweichung: boolean;
}

/**
 * Stand aller aktiven Teams für einen Tag: hat gemeldet, wann, wo, mit Überstunden.
 * Bewusst kein Ranking und keine Bewertung — nur «gemeldet / noch nicht» (CLAUDE.md «Nicht bauen»).
 */
export async function teamStand(c: SupabaseClient, datum: Date): Promise<TeamStand[]> {
  const tagIso = iso(datum);
  const [teams, meldungen] = await Promise.all([
    c.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
    c
      .from('tagesmeldung')
      .select('team_id,erfasst_am,normalfall,abweichung_typ,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(ueber_min)')
      .eq('datum', tagIso),
  ]);

  type TeamZeile = { id: string; bezeichnung: string; chefmonteur: { name: string } | { name: string }[] | null };
  type MeldZeile = {
    team_id: string | null;
    erfasst_am: string | null;
    normalfall: boolean;
    abweichung_typ: string | null;
    baustelle: { konto_nr: string; bezeichnung: string | null } | { konto_nr: string; bezeichnung: string | null }[] | null;
    zeiteintrag: { ueber_min: number }[] | null;
  };

  const proTeam = new Map<string, MeldZeile[]>();
  for (const m of (meldungen.data ?? []) as unknown as MeldZeile[]) {
    if (!m.team_id) continue;
    const liste = proTeam.get(m.team_id) ?? [];
    liste.push(m);
    proTeam.set(m.team_id, liste);
  }

  return ((teams.data ?? []) as unknown as TeamZeile[])
    .map((t) => {
      const chef = Array.isArray(t.chefmonteur) ? t.chefmonteur[0] : t.chefmonteur;
      const liste = (proTeam.get(t.id) ?? []).sort((a, b) => (a.erfasst_am ?? '').localeCompare(b.erfasst_am ?? ''));
      const erste = liste[0];
      const b = erste ? (Array.isArray(erste.baustelle) ? erste.baustelle[0] : erste.baustelle) : null;
      return {
        id: t.id,
        bezeichnung: t.bezeichnung,
        chefmonteur: chef?.name ?? null,
        gemeldetUm: erste?.erfasst_am
          ? new Date(erste.erfasst_am).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
          : null,
        baustelle: b ? b.bezeichnung || `Konto ${b.konto_nr}` : null,
        anzahlBaustellen: new Set(liste.map((m) => (Array.isArray(m.baustelle) ? m.baustelle[0] : m.baustelle)?.konto_nr ?? '')).size,
        abweichung: liste.some((m) => !m.normalfall || !!m.abweichung_typ || (m.zeiteintrag ?? []).some((z) => z.ueber_min > 0)),
      };
    })
    .sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
}
