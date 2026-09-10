/**
 * Abfragen für die Diagramme der Büro-Startseiten.
 *
 * Liegt getrennt von den Seiten, weil sich Bauführer und Sekretariat den Trichter
 * teilen. Alles rechnet in Minuten und Rappen als Integer (CLAUDE.md #6) —
 * umgerechnet wird erst bei der Ausgabe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addTage, iso, montag, WOCHENTAGE, kurz } from './datum';
import type { Stufe } from '../ui/Diagramm';

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

const STUFEN: { key: string; titel: string; zu: string }[] = [
  { key: 'bestellt', titel: 'bestellt', zu: '/zusatzauftrag' },
  { key: 'gemeldet', titel: 'gemeldet', zu: '/heute' },
  { key: 'im_regierapport', titel: 'im Regierapport', zu: '/regie' },
  { key: 'beim_kunden', titel: 'beim Kunden', zu: '/regie' },
  { key: 'bestaetigt', titel: 'bestätigt', zu: '/regie' },
];

export interface TrichterDaten {
  stufen: Stufe[];
  ohneMeldung: number;
  erledigtOhneRegie: number;
}

/**
 * Wo stehen die Zusatzaufträge? Liest die Sicht `zusatzauftrag_stand` — der Stand
 * wird abgeleitet, nie geklickt (CLAUDE.md, Entscheid 06.09.).
 */
export async function trichter(c: SupabaseClient, tageZurueck = 60): Promise<TrichterDaten> {
  const seit = new Date();
  seit.setDate(seit.getDate() - tageZurueck);
  const { data } = await c
    .from('zusatzauftrag_stand')
    .select('stand,ohne_meldung')
    .gte('bestellt_am', seit.toISOString());

  const zeilen = (data ?? []) as { stand: string; ohne_meldung: boolean }[];
  const zaehler = new Map<string, number>();
  for (const z of zeilen) zaehler.set(z.stand, (zaehler.get(z.stand) ?? 0) + 1);

  return {
    stufen: STUFEN.map((s) => ({ ...s, anzahl: zaehler.get(s.key) ?? 0 })),
    ohneMeldung: zeilen.filter((z) => z.ohne_meldung).length,
    erledigtOhneRegie: zaehler.get('erledigt_ohne_regie') ?? 0,
  };
}

export interface RegieMonat {
  label: string;
  offenRappen: number;
  bestaetigtRappen: number;
  hervor?: boolean;
}

const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Verschickte Regie je Monat, davon bestätigt. «Verschickt» zählt nach Versanddatum. */
export async function regieMonate(c: SupabaseClient, anzahl = 6): Promise<RegieMonat[]> {
  const heute = new Date();
  const start = new Date(heute.getFullYear(), heute.getMonth() - (anzahl - 1), 1, 12);
  const monate: RegieMonat[] = [];
  for (let i = 0; i < anzahl; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1, 12);
    monate.push({
      label: MONAT_KURZ[d.getMonth()],
      offenRappen: 0,
      bestaetigtRappen: 0,
      hervor: d.getMonth() === heute.getMonth() && d.getFullYear() === heute.getFullYear(),
    });
  }

  const { data } = await c
    .from('regierapport')
    .select('betrag_rappen,versendet_am,status')
    .neq('status', 'entwurf')
    .gte('versendet_am', start.toISOString());

  for (const r of (data ?? []) as { betrag_rappen: number | null; versendet_am: string | null; status: string }[]) {
    if (!r.versendet_am) continue;
    const d = new Date(r.versendet_am);
    const index = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    if (index < 0 || index >= anzahl) continue;
    const betrag = r.betrag_rappen ?? 0;
    if (r.status === 'bestaetigt') monate[index].bestaetigtRappen += betrag;
    else monate[index].offenRappen += betrag;
  }
  return monate;
}

export interface TeamStand {
  id: string;
  bezeichnung: string;
  /** Wen der Bauführer anruft, wenn die Meldung fehlt. */
  chefmonteur: string | null;
  gemeldetUm: string | null;
  baustelle: string | null;
  /** Mehrere Baustellen am selben Tag — dann zählt die Zahl statt eines Namens. */
  anzahlMeldungen: number;
  abweichung: boolean;
}

/**
 * Stand aller aktiven Teams für einen Tag: hat gemeldet, wann, wo, mit Abweichung.
 * Bewusst kein Ranking und keine Bewertung — nur «gemeldet / noch nicht» (CLAUDE.md «Nicht bauen»).
 */
export async function teamStand(c: SupabaseClient, datum: Date): Promise<TeamStand[]> {
  const tagIso = iso(datum);
  const [teams, meldungen] = await Promise.all([
    c.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
    c
      .from('tagesmeldung')
      .select('team_id,erfasst_am,normalfall,abweichung_typ,baustelle:baustelle_id(konto_nr,bezeichnung)')
      .eq('datum', tagIso),
  ]);

  type TeamZeile = { id: string; bezeichnung: string; chefmonteur: { name: string } | { name: string }[] | null };
  type MeldZeile = {
    team_id: string | null;
    erfasst_am: string | null;
    normalfall: boolean;
    abweichung_typ: string | null;
    baustelle: { konto_nr: string; bezeichnung: string | null } | { konto_nr: string; bezeichnung: string | null }[] | null;
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
        anzahlMeldungen: liste.length,
        abweichung: liste.some((m) => !m.normalfall || !!m.abweichung_typ),
      };
    })
    .sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
}

export interface FristEintrag {
  id: string;
  bezeichnung: string;
  kontoNr: string;
  betragRappen: number;
  tage: number;
  ueberfaellig: boolean;
}

/** Was liegt beim Kunden und wie lange schon? Ältestes zuerst — das ist die Arbeitsliste. */
export async function fristen(c: SupabaseClient, grenze = 6): Promise<FristEintrag[]> {
  const heuteIso = iso(new Date());
  const { data } = await c
    .from('regierapport')
    .select('id,betrag_rappen,versendet_am,frist_bis,status,baustelle:baustelle_id(bezeichnung,konto_nr)')
    .in('status', ['versendet', 'rueckfrage', 'frist_abgelaufen'])
    .order('versendet_am', { ascending: true })
    .limit(grenze);

  type Zeile = {
    id: string;
    betrag_rappen: number | null;
    versendet_am: string | null;
    frist_bis: string | null;
    status: string;
    baustelle: { bezeichnung: string | null; konto_nr: string } | { bezeichnung: string | null; konto_nr: string }[] | null;
  };

  const jetzt = Date.now();
  return ((data ?? []) as unknown as Zeile[]).map((r) => {
    const b = Array.isArray(r.baustelle) ? r.baustelle[0] : r.baustelle;
    return {
      id: r.id,
      // Baustellen ohne Bezeichnung über die Konto-Nr. ansprechen (wie in der Doppelmeldung)
      bezeichnung: b?.bezeichnung || `Baustelle ${b?.konto_nr ?? ''}`.trim(),
      kontoNr: b?.konto_nr ?? '',
      betragRappen: r.betrag_rappen ?? 0,
      tage: r.versendet_am ? Math.max(0, Math.floor((jetzt - new Date(r.versendet_am).getTime()) / 86400000)) : 0,
      ueberfaellig: r.status === 'frist_abgelaufen' || (!!r.frist_bis && r.frist_bis < heuteIso),
    };
  });
}
