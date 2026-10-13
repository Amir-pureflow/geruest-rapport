/**
 * Startseite Chefmonteur: das eigene Team, der heutige Tag, die laufende Woche (Vorwochen erreichbar).
 * Ein Knopf («Tag melden») führt in die Erfassung; das Team ist dasselbe wie dort (TEAM_KEY).
 * Zeigt nur, was gemeldet und (im Regie-Modus) was bestellt ist — keine Urteile (CLAUDE.md #1).
 * Meldungen, die noch auf dem Gerät warten, erscheinen in der Woche mit «wartet auf Netz» (CLAUDE.md #4).
 *
 * Mit `MODUS_ERFASSUNG = regie` steht unten «Vom Kunden bestellt»: was die Bauleitung für die Baustellen
 * dieses Teams angeordnet hat. Ohne Regie gibt es die Liste nicht (Firmen-Schalter, 02.10.2026).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, Clock } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { kennzeichen } from '../lib/fahrzeug';
import { einstellungen } from '../lib/einstellungen';
import { taetigkeitText } from '../lib/zusatzauftrag';
import {
  flushNachSupabase, meldungBeiseitelegen, nochmalsVersuchen, offeneMeldungen, warteStand, warteschlangeBeobachten, zeilenAuslassen,
  type MeldungPayload, type WarteStand,
} from '../lib/db';
import { vorratLesen, vorratSchreiben } from '../lib/vorrat';
import { heuteUndNaechster, planHinweise, type VerlaufZeile } from '../lib/planung';
import { istDemoFirma } from '../lib/demo';
import { nachtragMoeglich } from '../lib/nachtrag';

export const TEAM_KEY = 'teamgeraet-team-id';
/** Zuletzt gewählte Teams auf diesem Gerät (max. 5, neuestes vorne) — gleiche Liste wie in der Erfassung. */
const ZULETZT_KEY = 'teamgeraet-zuletzt';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Zeit { id: string; normal_min: number; ueber_min: number; status: string; mitarbeiter: { name: string } | null }
interface Meldung {
  id: string; datum: string; normalfall: boolean; abweichung_typ: string | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: Zeit[];
  /** true = liegt noch in der Warteschlange auf diesem Gerät */
  lokal: boolean;
}
interface Plan { von: string; bis: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null }
/** Eine Korrektur des Bauführers an den Stunden (freigabe_log, Felder normal_min / ueber_min). */
interface Korrektur { zeiteintrag_id: string; feld: 'normal_min' | 'ueber_min'; alt: string | null; neu: string | null; begruendung: string | null; wann: string }
/** Nur im Regie-Modus: was der Kunde für die Baustellen dieses Teams bestellt hat. */
interface Auftrag { id: string; baustelle_id: string; taetigkeit: string; besteller_name: string; geplant_fuer: string | null; stand: string }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'Regie', warten: 'gewartet', kaputt: 'kaputt' };

/**
 * Stunden eines Tages je Person — so denkt der Chefmonteur («8.0 h»), nicht als Teamsumme («24.0 h»).
 * Alle gleich: eine Zahl; verschieden: von–bis. Zwei Baustellen am Tag zählen pro Person zusammen.
 */
function jePerson(eintraege: Zeit[]): string {
  const je = new Map<string, number>();
  for (const z of eintraege) {
    const k = z.mitarbeiter?.name ?? z.id;
    je.set(k, (je.get(k) ?? 0) + z.normal_min + z.ueber_min);
  }
  const werte = [...je.values()];
  if (werte.length === 0) return '';
  const lo = Math.min(...werte), hi = Math.max(...werte);
  return lo === hi ? `${stunden(lo)} h` : `${stunden(lo)}–${stunden(hi)} h`;
}

function zuletztLesen(): string[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function zuletztMerken(id: string): string[] {
  const liste = [id, ...zuletztLesen().filter((x) => x !== id)].slice(0, 5);
  localStorage.setItem(ZULETZT_KEY, JSON.stringify(liste));
  return liste;
}

/** Korrekturen je Zeiteintrag zusammenfassen: erster Alt-Wert → letzter Neu-Wert, letzter Grund. */
function korrekturenZusammenfassen(liste: Korrektur[]): Map<string, { feld: 'normal_min' | 'ueber_min'; alt: number; neu: number; grund: string | null }[]> {
  const sortiert = [...liste].sort((a, b) => a.wann.localeCompare(b.wann));
  const map = new Map<string, Map<string, { feld: 'normal_min' | 'ueber_min'; alt: number; neu: number; grund: string | null }>>();
  for (const k of sortiert) {
    const alt = Number(k.alt);
    const neu = Number(k.neu);
    if (!Number.isFinite(alt) || !Number.isFinite(neu)) continue;
    const je = map.get(k.zeiteintrag_id) ?? new Map();
    const vorher = je.get(k.feld);
    je.set(k.feld, { feld: k.feld, alt: vorher ? vorher.alt : alt, neu, grund: k.begruendung?.trim() || vorher?.grund || null });
    map.set(k.zeiteintrag_id, je);
  }
  const erg = new Map<string, { feld: 'normal_min' | 'ueber_min'; alt: number; neu: number; grund: string | null }[]>();
  for (const [id, je] of map) erg.set(id, [...je.values()].filter((x) => x.alt !== x.neu));
  return erg;
}

/**
 * Filter für `plan_verlauf` (0038): Zeilen, deren Stand vorher oder nachher dieses Team oder eine seiner Personen
 * betrifft — mehr braucht `planHinweise` nicht. Auch von der Erfassung benutzt.
 */
export function verlaufFilter(teamId: string, personen: string[]): string {
  const teile = [`vorher->>team_id.eq.${teamId}`, `nachher->>team_id.eq.${teamId}`];
  if (personen.length > 0) teile.push(`vorher->>mitarbeiter_id.in.(${personen.join(',')})`, `nachher->>mitarbeiter_id.in.(${personen.join(',')})`);
  return teile.join(',');
}

/** «Di 13.10.» aus «2026-10-13» */
function tagKurz(t: string | null): string {
  if (!t) return 'unbekannter Tag';
  const d = new Date(t + 'T12:00:00');
  return `${WOCHENTAGE[(d.getDay() + 6) % 7]} ${kurz(d)}`;
}

/**
 * Was auf diesem Gerät noch wartet — und was nicht von allein durchkommt (13.10.2026, vor dem Start bei der Gerüst GmbH).
 *
 * Vorher stand nur «geht automatisch raus». Lehnte der Server eine Meldung ab (Person im Büro gelöscht, Team weg),
 * sortierte das Senden im Hintergrund sie still aus — samt Sprachnotiz. Jetzt steht sie hier, bis der Chefmonteur
 * entscheidet: nochmals versuchen (nachdem das Büro es geklärt hat), ohne die eine Person abschliessen, oder — wenn der
 * Kopf nie durchkommt — beiseitelegen. Gelöscht wird dabei nichts (CLAUDE.md #8).
 *
 * Auch in der Erfassung (`nurProbleme`), damit es niemand übersieht. Meldungen einer anderen Firma auf diesem Gerät
 * warten sichtbar auf deren Anmeldung.
 */
export function Warteschlange({ nurProbleme = false }: { nurProbleme?: boolean }) {
  const [stand, setStand] = useState<WarteStand | null>(null);
  const [frage, setFrage] = useState<{ uuid: string; art: 'auslassen' | 'beiseite' } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const neu = useCallback(() => { void warteStand().then(setStand).catch(() => undefined); }, []);
  useEffect(() => {
    neu();
    return warteschlangeBeobachten(() => neu());
  }, [neu]);

  /** Entscheid ausführen, dann gleich senden — der Chefmonteur soll sehen, dass es durch ist. */
  async function tun(f: () => Promise<void>) {
    setLaeuft(true);
    try {
      await f();
      if (supabase && navigator.onLine) await flushNachSupabase(supabase).catch(() => undefined);
    } finally {
      setLaeuft(false);
      setFrage(null);
      neu();
    }
  }

  if (!stand) return null;
  const wartendOhneProblem = stand.offen - stand.probleme.length;
  const um = stand.fehlerZeit ? new Date(stand.fehlerZeit) : null;
  return (
    <>
      {!nurProbleme && wartendOhneProblem > 0 && (
        <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep" role="status">
          <p className="font-semibold">{wartendOhneProblem} Meldung{wartendOhneProblem === 1 ? '' : 'en'} noch nicht gesendet — geht automatisch raus.</p>
          {stand.fehlerText && (
            <p className="mt-0.5 text-xs">
              Letzter Versuch{um ? ` um ${String(um.getHours()).padStart(2, '0')}:${String(um.getMinutes()).padStart(2, '0')}` : ''}: {stand.fehlerText}
            </p>
          )}
        </div>
      )}
      {stand.probleme.map((p) => {
        const wer = p.namen.join(', ');
        return (
          <section key={p.client_uuid} className="space-y-2 rounded-[12px] border-2 border-amber/60 bg-amber-soft px-4 py-3 text-sm" role="alert">
            <p className="font-semibold text-amber-deep">Meldung vom {tagKurz(p.datum)} — {p.art === 'kopf' ? 'konnte nicht gesendet werden' : 'nicht ganz gesendet'}</p>
            <p className="text-ink">{p.text}</p>
            {frage?.uuid === p.client_uuid ? (
              <div className="space-y-2 rounded-[10px] bg-surface p-3">
                <p className="text-ink2">
                  {frage.art === 'auslassen'
                    ? `Ohne ${wer} abschliessen? Die Stunden von ${wer} an diesem Tag fehlen dann beim Bauführer — er kann sie in der Wochenübersicht nachtragen. Die Meldung bleibt auf diesem Gerät gespeichert.`
                    : 'Beiseitelegen? Die Meldung wird nicht mehr gesendet, bleibt aber mit Sprachnotiz und Fotos auf diesem Gerät. Danach den Tag neu melden.'}
                </p>
                <button type="button" disabled={laeuft} className="cta py-3 text-sm disabled:opacity-70" onClick={() => void tun(() => (frage.art === 'auslassen' ? zeilenAuslassen(p.client_uuid) : meldungBeiseitelegen(p.client_uuid)))}>
                  {laeuft ? 'Einen Moment …' : frage.art === 'auslassen' ? `Ja, ohne ${wer} abschliessen` : 'Ja, beiseitelegen'}
                </button>
                <button type="button" disabled={laeuft} className="btn-ghost w-full py-2 text-sm" onClick={() => setFrage(null)}>Abbrechen</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={laeuft} className="btn-ghost py-2 text-sm" onClick={() => void tun(() => nochmalsVersuchen(p.client_uuid))}>{laeuft ? 'Sendet …' : 'Nochmals versuchen'}</button>
                <button type="button" disabled={laeuft} className="btn-ghost py-2 text-sm" onClick={() => setFrage({ uuid: p.client_uuid, art: p.art === 'kopf' ? 'beiseite' : 'auslassen' })}>
                  {p.art === 'kopf' ? 'Beiseitelegen …' : `Ohne ${wer} abschliessen …`}
                </button>
              </div>
            )}
          </section>
        );
      })}
      {!nurProbleme && stand.fremd.map((f, i) => (
        <p key={i} className="rounded-[12px] bg-surface-2 px-4 py-2.5 text-xs text-ink2">
          {f.anzahl} Meldung{f.anzahl === 1 ? '' : 'en'} {f.name ? `von «${f.name}»` : 'einer anderen Anmeldung'} {f.anzahl === 1 ? 'wartet' : 'warten'} auf diesem Gerät — {f.anzahl === 1 ? 'sie geht' : 'sie gehen'} raus, sobald diese Firma hier wieder angemeldet ist.
        </p>
      ))}
    </>
  );
}

export function StartChef() {
  const [teams, setTeams] = useState<Team[]>([]);
  /** Teams liessen sich nicht laden und es gibt keinen Vorrat — dann das sagen, nicht «Keine Teams» (13.10.2026) */
  const [teamFehler, setTeamFehler] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [zuletzt, setZuletzt] = useState<string[]>(zuletztLesen);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [leute, setLeute] = useState<string[]>([]);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [korrekturen, setKorrekturen] = useState<Korrektur[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const regie = einstellungen().erfassung === 'regie';
  const [auftraege, setAuftraege] = useState<Auftrag[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(new Date()));
  const heute = new Date();
  const heuteIso = iso(heute);
  const dieseWocheIso = iso(montag(heute));
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));
  const istDieseWoche = vonIso === dieseWocheIso;
  const team = teams.find((t) => t.id === teamId) ?? null;

  const teamsLaden = useCallback(() => {
    if (!supabase) return;
    setTeamFehler(null);
    void supabase.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).order('bezeichnung').then(({ data, error }) => {
      // Ohne Netz (Start auf der Baustelle): die Teams vom letzten Mal — siehe lib/vorrat.ts
      if (!data) {
        const v = vorratLesen<Team[]>('teams-start');
        if (v) setTeams(v);
        else setTeamFehler(error?.message ?? 'keine Antwort');
        return;
      }
      const s = (data as unknown as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
      vorratSchreiben('teams-start', s);
      setTeams(s);
      const gespeichert = localStorage.getItem(TEAM_KEY);
      if (gespeichert && !s.some((t) => t.id === gespeichert)) { localStorage.removeItem(TEAM_KEY); setTeamId(null); }
    });
  }, []);
  useEffect(() => { teamsLaden(); }, [teamsLaden]);

  /** Meldungen aus der lokalen Warteschlange für Team + Woche — ohne Netz das Einzige, was wir sicher wissen. */
  const lokaleLaden = useCallback(async (planRows: Plan[]): Promise<Meldung[]> => {
    if (!teamId) return [];
    const offene = await offeneMeldungen();
    const liste: Meldung[] = [];
    for (const e of offene) {
      const p = e.payload as unknown as Partial<MeldungPayload>;
      if (p.team_id !== teamId || typeof p.datum !== 'string' || p.datum < vonIso || p.datum > bisIso || !Array.isArray(p.eintraege)) continue;
      const geplant = planRows.find((r) => r.baustelle?.id === p.baustelle_id)?.baustelle ?? null;
      const konto = geplant?.konto_nr ?? p.eintraege[0]?.konto_nr ?? '';
      liste.push({
        id: e.client_uuid, datum: p.datum, normalfall: p.normalfall ?? true, abweichung_typ: p.abweichung_typ ?? null,
        baustelle: geplant ?? (konto ? { konto_nr: konto, bezeichnung: null } : null),
        zeiteintrag: p.eintraege.map((z) => ({ id: z.id, normal_min: z.normal_min, ueber_min: z.ueber_min, status: 'offen', mitarbeiter: null })),
        lokal: true,
      });
    }
    return liste;
  }, [teamId, vonIso, bisIso]);

  /** `senden` = vorher die Warteschlange schieben. Nach einem Senden im Hintergrund nur neu laden (sonst liefe es im Kreis). */
  const laden = useCallback(async (senden = true) => {
    if (!supabase || !teamId) return;
    const c = supabase;
    setLaedt(true);
    setFehler(null);
    try {
      if (senden && navigator.onLine) {
        try { await flushNachSupabase(c); } catch { /* Senden klappt später — die Anzeige darf nicht daran scheitern */ }
      }
      const [mg, m, p] = await Promise.all([
        c.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(name,aktiv)').eq('team_id', teamId).is('bis', null),
        c.from('tagesmeldung').select('id,datum,normalfall,abweichung_typ,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(id,normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(name))').eq('team_id', teamId).gte('datum', vonIso).lte('datum', bisIso).order('datum'),
        c.from('jahresplan').select('von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).lte('von', bisIso).gte('bis', vonIso),
      ]);
      const fehlerObj = mg.error ?? m.error ?? p.error;
      if (fehlerObj) throw new Error(fehlerObj.message);
      setLeute(((mg.data ?? []) as unknown as { mitarbeiter: { name: string; aktiv: boolean } | null }[]).map((r) => r.mitarbeiter).filter((x): x is { name: string; aktiv: boolean } => !!x && x.aktiv).map((x) => x.name).sort());
      const planRows = (p.data ?? []) as unknown as Plan[];
      setPlan(planRows);
      const serverMeldungen = ((m.data ?? []) as unknown as Omit<Meldung, 'lokal'>[]).map((x) => ({ ...x, lokal: false }));
      const lokale = await lokaleLaden(planRows);
      setMeldungen([...serverMeldungen, ...lokale].sort((a, b) => a.datum.localeCompare(b.datum)));

      // Korrekturen des Bauführers an den Stunden dieser Woche (CLAUDE.md #7: alles im freigabe_log)
      const zeitIds = serverMeldungen.flatMap((x) => x.zeiteintrag.map((z) => z.id));
      if (zeitIds.length > 0) {
        const { data: k } = await c.from('freigabe_log').select('zeiteintrag_id,feld,alt,neu,begruendung,wann').in('zeiteintrag_id', zeitIds).in('feld', ['normal_min', 'ueber_min']).order('wann');
        setKorrekturen((k ?? []) as Korrektur[]);
      } else setKorrekturen([]);

      // Regie-Modus: offene Bestellungen der Bauleitung auf den Baustellen dieses Teams
      if (regie) {
        const baustellen = [...new Set(planRows.map((x) => x.baustelle?.id).filter((x): x is string => !!x))];
        if (baustellen.length > 0) {
          const { data: a } = await c
            .from('zusatzauftrag_stand')
            .select('id,baustelle_id,taetigkeit,besteller_name,geplant_fuer,stand')
            .in('baustelle_id', baustellen)
            .in('stand', ['bestellt', 'gemeldet'])
            .order('geplant_fuer');
          setAuftraege((a ?? []) as Auftrag[]);
        } else setAuftraege([]);
      }
    } catch (err) {
      // Ohne Netz: wenigstens die lokalen Meldungen zeigen, den Fehler ehrlich benennen
      setFehler(err instanceof Error ? err.message : String(err));
      try {
        const lokale = await lokaleLaden(plan);
        setMeldungen(lokale);
      } catch { /* dann eben nur der Fehlertext */ }
    } finally {
      setLaedt(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, vonIso, bisIso, lokaleLaden, regie]);
  useEffect(() => { void laden(); }, [laden]);
  // Ging im Hintergrund etwas hinaus (Netz zurück, App wieder vorne, Minutentakt): die Woche zeigt es gleich als gemeldet
  useEffect(() => warteschlangeBeobachten((erg) => { if (erg && erg.gesendet > 0) void laden(false); }), [laden]);

  function teamWaehlen(id: string) {
    localStorage.setItem(TEAM_KEY, id);
    setZuletzt(zuletztMerken(id));
    setWeitereTeams(0);
    setTeamId(id);
  }

  // Teamwahl: zuletzt genutzte zuerst (max. 5), der Rest in Fünferblöcken hinter «Weitere Teams …»
  const teamAuswahl = useMemo(() => {
    const vorneIds = zuletzt.filter((x, i, a) => a.indexOf(x) === i);
    const vorne = vorneIds.map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => !!t).slice(0, 5);
    const erste = vorne.length > 0 ? vorne : teams.slice(0, 5);
    const rest = teams.filter((t) => !erste.some((e) => e.id === t.id));
    // Ohne Beschriftung wirkt die erste Gruppe wie eine zufällige Reihenfolge (3, 2, 1, 8, 12 …).
    // Die Erfassung schreibt «· zuletzt» ans Team — hier fehlte das Gegenstück.
    return { erste, rest, ausVerlauf: vorne.length > 0 };
  }, [teams, zuletzt]);

  const korrekturJeZeit = useMemo(() => korrekturenZusammenfassen(korrekturen), [korrekturen]);

  /**
   * Plan geändert (11.10.2026, Amir): Umplanungen müssen das Team erreichen — «heute Viktoriastrasse statt Eigerplatz»,
   * «morgen ist Marco in Team 3». Aus dem Verlauf der Planung (0038), für heute und den nächsten Arbeitstag, Änderungen
   * der letzten drei Tage. Ohne Netz oder ohne Migration: nichts.
   */
  const [hinweise, setHinweise] = useState<{ key: string; tag: string; text: string; wann: string }[]>([]);
  useEffect(() => {
    setHinweise([]);
    if (!supabase || !teamId) return;
    const c = supabase;
    let veraltet = false;
    void (async () => {
      const tageH = heuteUndNaechster(new Date());
      const seit = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const mg = await c.from('team_mitglied').select('mitarbeiter_id').eq('team_id', teamId).is('bis', null);
      if (veraltet || mg.error) return;
      const mitglieder = ((mg.data ?? []) as { mitarbeiter_id: string }[]).map((x) => x.mitarbeiter_id);
      const verlauf = (gefiltert: boolean) => {
        const q = c.from('plan_verlauf').select('tabelle,datensatz_id,aktion,vorher,nachher,zeit').gte('zeit', seit);
        return (gefiltert ? q.or(verlaufFilter(teamId, mitglieder)) : q).order('zeit', { ascending: false }).limit(1000);
      };
      const [vlGefiltert, pl, ep] = await Promise.all([
        // Nur, was dieses Team betrifft — neueste zuerst, damit das Limit nie die jüngsten Änderungen abschneidet
        // (13.10.2026: vorher der Verlauf der ganzen Firma, älteste zuerst, bei 800 Zeilen abgeschnitten)
        verlauf(true),
        c.from('jahresplan').select('id,team_id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).lte('von', tageH[1]).gte('bis', tageH[0]),
        c.from('einsatz_person').select('mitarbeiter_id,team_id,datum').in('datum', tageH),
      ]);
      // Versteht die Datenbank den Filter nicht, wenigstens die neuesten Zeilen der Firma
      const vl = vlGefiltert.error ? await verlauf(false) : vlGefiltert;
      if (veraltet || vl.error || !vl.data) return;
      const plaeneJetzt = (pl.data ?? []) as unknown as { id: string; team_id: string; von: string; bis: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null }[];
      const roh = planHinweise(teamId, mitglieder, tageH, vl.data as VerlaufZeile[], seit,
        plaeneJetzt.map((p) => ({ id: p.id, team_id: p.team_id, baustelle_id: p.baustelle?.id ?? null, von: p.von, bis: p.bis })),
        ep.error ? [] : ((ep.data ?? []) as { mitarbeiter_id: string; team_id: string; datum: string }[]));
      if (roh.length === 0) return;
      const bsIds = [...new Set(roh.flatMap((h) => h.alt ?? []))];
      const maIds = [...new Set(roh.map((h) => h.mitarbeiter_id).filter((x): x is string => !!x))];
      const [bs, ma, tm] = await Promise.all([
        bsIds.length ? c.from('baustelle').select('id,konto_nr,bezeichnung').in('id', bsIds) : Promise.resolve({ data: [] }),
        maIds.length ? c.from('mitarbeiter').select('id,name').in('id', maIds) : Promise.resolve({ data: [] }),
        c.from('team').select('id,bezeichnung'),
      ]);
      if (veraltet) return;
      const bsName = new Map(((bs.data ?? []) as { id: string; konto_nr: string; bezeichnung: string | null }[]).map((b) => [b.id, b.bezeichnung ?? b.konto_nr]));
      const maName = new Map(((ma.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
      const tmName = new Map(((tm.data ?? []) as { id: string; bezeichnung: string }[]).map((t) => [t.id, t.bezeichnung]));
      const heuteIsoH = tageH[0];
      const tagText = (t: string) => (t === heuteIsoH ? 'Heute' : ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(t + 'T12:00:00').getDay()] + (iso(addTage(new Date(heuteIsoH + 'T12:00:00'), 1)) === t ? ' (morgen)' : ''));
      const wann = (z: string) => { const d = new Date(z); return `geändert ${WOCHENTAGE[(d.getDay() + 6) % 7]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      setHinweise(roh.map((h, i) => {
        const jetzt = plaeneJetzt.filter((p) => p.von <= h.tag && p.bis >= h.tag && p.baustelle);
        const jetztIds = jetzt.map((p) => p.baustelle!.id);
        const vorname = h.mitarbeiter_id ? (maName.get(h.mitarbeiter_id) ?? 'Jemand') : '';
        let text = '';
        if (h.art === 'baustelle') {
          const alt = (h.alt ?? []).filter((id) => !jetztIds.includes(id)).map((id) => bsName.get(id) ?? 'andere Baustelle');
          text = (jetzt.length ? jetzt.map((p) => p.baustelle!.bezeichnung ?? p.baustelle!.konto_nr).join(', ') : 'keine Baustelle geplant') + (alt.length ? ` — statt ${alt.join(', ')}` : '');
        } else if (h.art === 'weg') text = `${vorname} ist in ${tmName.get(h.team_id ?? '') ?? 'einem anderen Team'}`;
        else if (h.art === 'dazu') text = `${vorname} kommt zu euch`;
        else if (h.art === 'zurueck') text = `${vorname} ist wieder bei euch`;
        else text = `${vorname} kommt doch nicht`;
        return { key: `${h.tag}-${h.art}-${h.mitarbeiter_id ?? ''}-${i}`, tag: tagText(h.tag), text, wann: wann(h.zeit) };
      }));
    })();
    return () => { veraltet = true; };
  }, [teamId]);

  if (!teamId || (teams.length > 0 && !team)) {
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold">Welches Team?</h1>
          <p className="text-sm text-ink3">Einmal wählen — das Gerät merkt es sich. Das ist dann auch das Team in der Erfassung.</p>
          {/* Ohne Verlauf ist das schlicht die Liste 1…20 — dann EIN Gitter, sonst bleibt neben der
              fünften Kachel eine leere Zelle stehen. Zwei Gitter nur, wenn die erste Gruppe wirklich
              etwas anderes bedeutet («zuletzt benutzt»). */}
          {teamAuswahl.ausVerlauf ? (
            <>
              <p className="lbl mb-0 pt-1">Zuletzt auf diesem Gerät</p>
              <div className="grid grid-cols-2 gap-2">
                {teamAuswahl.erste.map((t) => (
                  <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                    {t.bezeichnung}
                    {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
                  </button>
                ))}
              </div>
              {weitereTeams > 0 && (
                <>
                  <p className="lbl mb-0 pt-1">Alle Teams</p>
                  <div className="grid grid-cols-2 gap-2">
                    {teamAuswahl.rest.slice(0, weitereTeams).map((t) => (
                      <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                        {t.bezeichnung}
                        {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {[...teamAuswahl.erste, ...teamAuswahl.rest.slice(0, weitereTeams)].map((t) => (
                <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                  {t.bezeichnung}
                  {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
                </button>
              ))}
            </div>
          )}
          {weitereTeams < teamAuswahl.rest.length && (
            <button type="button" onClick={() => setWeitereTeams((n) => n + 5)} className="btn-ghost w-full">Weitere Teams …</button>
          )}
          {teams.length === 0 && (teamFehler ? (
            <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep" role="alert">
              <strong>Teams konnten nicht geladen werden.</strong> Verbindung prüfen und nochmals versuchen.
              <button type="button" className="btn-ghost mt-2 block w-full" onClick={teamsLaden}>Nochmals</button>
            </div>
          ) : (
            <p className="card text-sm text-ink3">Keine Teams — als Bauführer unter Verwaltung anlegen{istDemoFirma() ? ' oder den Demo-Betrieb laden' : ''}.</p>
          ))}
        </div>
      </Shell>
    );
  }

  const heutige = meldungen.filter((m) => m.datum === heuteIso);
  const planHeute = plan.find((p) => p.von <= heuteIso && p.bis >= heuteIso)?.baustelle ?? null;
  const tage = Array.from({ length: 7 }, (_, i) => addTage(wochenStart, i));
  // Arbeitstage bis heute (Mo–Fr) und wie viele davon gemeldet sind — statt «120.0 h total» fürs ganze Team
  const vergangeneWerktage = tage.filter((d, i) => i < 5 && iso(d) <= heuteIso);
  const gemeldeteWerktage = vergangeneWerktage.filter((d) => meldungen.some((m) => m.datum === iso(d))).length;

  return (
    <Shell>
      <div className="space-y-5">
        {/* Kopf: Team, Chefmonteur, Leute — eine Zeile (11.10.2026, Amir: «zu viel Text auf einen Blick») */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold">{team?.bezeichnung ?? 'Team'}</h1>
            <p className="text-sm text-ink3">
              {team?.chefmonteur?.name ?? 'kein Chefmonteur'}{leute.length > 0 ? ` · ${leute.length} Leute` : ''}{kennzeichen(team?.fahrzeug) ? ` · ${kennzeichen(team?.fahrzeug)}` : ''}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(TEAM_KEY); setTeamId(null); }}>Team wechseln</button>
        </header>

        {hinweise.length > 0 && (
          <section className="rounded-[16px] border border-amber/40 bg-amber-soft px-4 py-3" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-deep"><BellRing size={16} aria-hidden="true" /> Plan geändert</p>
            <ul className="mt-1.5 space-y-1 text-sm text-ink">
              {hinweise.map((h) => (
                <li key={h.key}><b className="font-semibold">{h.tag}:</b> {h.text} <span className="whitespace-nowrap text-[11px] text-ink3">· {h.wann}</span></li>
              ))}
            </ul>
          </section>
        )}

        {/* Was noch wartet, der letzte Fehler beim Senden und was der Chefmonteur entscheiden muss */}
        <Warteschlange />

        {fehler && (
          <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep">
            <strong>Woche konnte nicht geladen werden.</strong> {navigator.onLine ? fehler : 'Gezeigt wird, was auf diesem Gerät liegt.'}
            <button type="button" className="btn-ghost mt-2 block w-full" onClick={() => void laden()}>Nochmals</button>
          </div>
        )}

        {/* Heute: Baustelle und ein Knopf. Der Plan ist nur ein Vorschlag — wer woanders war, wählt beim Melden. */}
        {istDieseWoche ? (
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Heute <span className="font-normal text-ink3">· {WOCHENTAGE[(heute.getDay() + 6) % 7]} {kurz(heute)}</span></p>
              {heutige.length > 0 && (
                heutige.some((m) => m.lokal)
                  ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-deep"><Clock size={14} aria-hidden="true" /> wartet</span>
                  : <span className="inline-flex items-center gap-1 text-xs font-semibold text-good-deep"><CheckCircle2 size={15} aria-hidden="true" /> gemeldet</span>
              )}
            </div>
            {heutige.length > 0 ? (
              heutige.map((m) => (
                <p key={m.id} className="flex items-center gap-2 text-[15px]">
                  {m.baustelle && <span className="knr">{m.baustelle.konto_nr}</span>}
                  <span className="min-w-0 flex-1 truncate font-medium">{m.baustelle?.bezeichnung ?? 'Baustelle'}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-ink2">{jePerson(m.zeiteintrag)}</span>
                  {!m.normalfall && <span className="shrink-0 rounded-md bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-amber-deep">{ABWEICHUNG[m.abweichung_typ ?? ''] ?? 'Abweichung'}</span>}
                </p>
              ))
            ) : planHeute ? (
              <p className="flex items-center gap-2 text-[15px]">
                <span className="knr">{planHeute.konto_nr}</span>
                <span className="min-w-0 truncate font-medium">{planHeute.bezeichnung ?? ''}</span>
              </p>
            ) : (
              <p className="text-sm text-ink3">Keine Baustelle geplant — du wählst sie beim Melden.</p>
            )}
            <Link to="/erfassung" className={heutige.length > 0 ? 'btn-ghost block w-full text-center' : 'cta'}>
              {heutige.length > 0 ? 'Ändern oder nochmals melden' : 'Tag melden'}
            </Link>
            {heutige.length === 0 && planHeute && (
              <Link to="/erfassung?baustelle=wahl" className="block text-center text-xs font-semibold text-steel">Woanders gewesen? Andere Baustelle ›</Link>
            )}
          </section>
        ) : (
          <button type="button" onClick={() => setWochenStart(montag(heute))} className="btn-ghost w-full">Zurück zu heute</button>
        )}

        {/* Woche: ein Tag = eine Zeile, Stunden je Person, Stand als Zeichen statt Wort */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))} aria-label="Vorwoche">‹</button>
            <span className="text-center">
              <span className="block text-sm font-semibold">{istDieseWoche ? 'Diese Woche' : `KW ${kw(wochenStart)}`}</span>
              <span className="block text-xs text-ink3">
                {kurz(wochenStart)} – {kurz(addTage(wochenStart, 6))}
                {vergangeneWerktage.length > 0 && <> · {gemeldeteWerktage} von {vergangeneWerktage.length} Tagen gemeldet</>}
              </span>
            </span>
            <button type="button" className="btn-ghost" disabled={istDieseWoche} onClick={() => setWochenStart(addTage(wochenStart, 7))} aria-label="nächste Woche">›</button>
          </div>
          <div className="card divide-y divide-line p-0">
            {laedt && meldungen.length === 0 && <p className="px-4 py-3 text-sm text-ink3">Lädt …</p>}
            {tage.map((d, i) => {
              const dIso = iso(d);
              const ms = meldungen.filter((m) => m.datum === dIso);
              const zukunft = dIso > heuteIso;
              // Wochenende nur, wenn gearbeitet wurde
              if (i >= 5 && ms.length === 0) return null;
              const geplant = plan.find((p) => p.von <= dIso && p.bis >= dIso)?.baustelle ?? null;
              const korr = ms.flatMap((m) => m.zeiteintrag.flatMap((z) => (korrekturJeZeit.get(z.id) ?? []).map((k) => ({ ...k, name: z.mitarbeiter?.name ?? null }))));
              const lokal = ms.some((m) => m.lokal);
              const frei = ms.some((m) => m.zeiteintrag.some((z) => z.status === 'freigegeben'));
              const regieTag = ms.find((m) => !m.normalfall);
              return (
                <div key={dIso} className={'px-4 py-2.5 text-sm ' + (zukunft ? 'text-ink3' : '')}>
                  <div className="flex items-center gap-3">
                    <span className={'w-14 shrink-0 whitespace-nowrap text-xs ' + (dIso === heuteIso ? 'font-semibold text-accent-deep' : 'text-ink3')}>{WOCHENTAGE[i]} {kurz(d)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {ms.length > 0
                        ? ms.map((m) => m.baustelle?.bezeichnung ?? (m.baustelle ? m.baustelle.konto_nr : 'Baustelle')).filter((x, j, a) => a.indexOf(x) === j).join(' · ')
                        : <span className="text-ink3">{geplant ? geplant.bezeichnung ?? geplant.konto_nr : '—'}</span>}
                    </span>
                    {regieTag && <span className="shrink-0 rounded-md bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-amber-deep">{ABWEICHUNG[regieTag.abweichung_typ ?? ''] ?? 'Abweichung'}</span>}
                    {ms.length > 0 && <span className="shrink-0 font-mono text-xs tabular-nums text-ink2">{jePerson(ms.flatMap((m) => m.zeiteintrag))}</span>}
                    <span className="flex w-[4.5rem] shrink-0 justify-end">
                      {ms.length > 0
                        ? lokal ? <span title="noch nicht gesendet" className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-deep"><Clock size={14} aria-hidden="true" /> wartet</span>
                          : frei ? <CheckCircle2 size={18} className="text-good" aria-label="vom Bauführer freigegeben" />
                          : <CheckCircle2 size={18} className="text-steel/70" aria-label="gemeldet" />
                        : zukunft ? null
                        // Nur Tage, die die Erfassung auch nimmt (lib/nachtrag.ts) — ältere trägt der Bauführer ein
                        : nachtragMoeglich(dIso, heute) ? <Link to={`/erfassung?tag=${dIso}`} className="text-[11px] font-semibold text-steel">nachtragen ›</Link>
                        : null}
                    </span>
                  </div>
                  {korr.length > 0 && (
                    <div className="mt-1 space-y-0.5 pl-[4.25rem] text-xs text-amber-deep">
                      {korr.map((k, j) => (
                        <p key={j}>
                          Bauführer: {k.name ? `${k.name.split(' ')[0]} ` : ''}{k.feld === 'ueber_min' ? 'Überstunden ' : ''}{stunden(k.alt)} → {stunden(k.neu)} h
                          {k.grund ? <span className="text-ink2"> · {k.grund}</span> : null}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink3">
            <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-steel/70" aria-hidden="true" /> gemeldet</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-good" aria-hidden="true" /> vom Bauführer freigegeben</span>
            <span>Stunden je Person</span>
            {tage.some((d, i) => i < 5 && iso(d) <= heuteIso && !nachtragMoeglich(iso(d), heute) && !meldungen.some((m) => m.datum === iso(d))) && (
              <span>Älter als 7 Tage: nachtragen macht der Bauführer</span>
            )}
          </p>
        </section>

        {regie && auftraege.length > 0 && (
          <section className="space-y-2">
            <p className="lbl mb-0">Vom Kunden bestellt</p>
            {auftraege.map((a) => {
              const b = plan.find((x) => x.baustelle?.id === a.baustelle_id)?.baustelle;
              return (
                <div key={a.id} className="card space-y-0.5 py-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm"><b className="font-semibold">{taetigkeitText(a.taetigkeit)}</b><span className="text-ink3"> · {a.besteller_name}</span></span>
                    <span className="shrink-0 text-xs text-ink3">{a.stand === 'gemeldet' ? 'schon gemeldet' : a.geplant_fuer ? `für ${kurz(new Date(a.geplant_fuer + 'T12:00:00'))}` : ''}</span>
                  </p>
                  {b && <p className="truncate text-xs text-ink3"><span className="knr">{b.konto_nr}</span> {b.bezeichnung ?? ''}</p>}
                </div>
              );
            })}
            <p className="text-[11px] text-ink3">Gemacht? Am Abend bei «Tag melden» als Überstunden eintragen, bei «War das Regie?» Ja tippen — mit Foto.</p>
          </section>
        )}

        {laedt && <p className="text-center text-xs text-ink3">lädt …</p>}
      </div>
    </Shell>
  );
}
