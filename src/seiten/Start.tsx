import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Banknote, CalendarCheck, PhoneCall, Send, Users } from 'lucide-react';
import { freiGrund, naechsterArbeitstag } from '../lib/feiertage';
import { initialen, teamFarbe, teamKuerzel } from '../lib/teamStil';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { alle, alleOderFehler } from '../lib/abfrage';
import { useAuffrischen, useNeuesteAnfrage } from '../lib/auffrischen';
import { addTage, iso, kurz, kw, lang, montag } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';
import { Kachel, MONATE, NavKarte } from '../ui/Karten';
import { navFuer } from '../ui/Shell';
import { DiagrammKarte, Trichter, WochenTeams } from '../ui/Diagramm';
import { TeamBoard } from '../ui/TeamBoard';
import { teamStand, trichter, wochenTeams, type TeamStand, type TrichterDaten, type WochenTag } from '../lib/kennzahlen';
import { useAnsicht } from '../lib/ansicht';
import { einstellungen, gelbePersonen } from '../lib/einstellungen';
import { formatChf } from '../lib/tarif';
import { StartChef } from './StartChef';
import { StartMonteur } from './StartMonteur';
import { StartSekretariat } from './StartSekretariat';
import { StartKunde } from './StartKunde';

/** Was der Bauführer auf einen Blick braucht: wer hat gemeldet, was wartet auf Freigabe, wo sind Überstunden zu lesen. */
interface Kennzahlen {
  teamsGemeldet: number;
  teams: number;
  /**
   * offene Team-Tage bis heute, diese Woche eingeschlossen — der Bauführer denkt in Tagen, nicht in Zeiteinträgen
   * (05.10.2026). Seit 15.11.2026 (Amir: «Freigabe diese Woche, nicht Vorwoche») nicht mehr nur vor dieser Woche.
   */
  zuPruefen: number;
  /** davon aus früheren Wochen — nur dann der Hinweis «Vorwoche prüfen» */
  aelterOffen: number;
  /** Meldungen dieser Woche — ohne eine einzige ist die Woche nicht «freigegeben», sondern leer */
  wocheMeldungen: number;
  /**
   * Team-Tage der Vorwoche mit offenen Überstunden, die noch einen Entscheid brauchen — gleich gezählt wie
   * «Zum Anschauen» in der Wochenübersicht (08.10.2026: vorher Zeiteinträge = Personen, darum 8 statt 2).
   * Im Regie-Modus fällt ein Tag weg, sobald ein Regierapport oder «keine Regie» dazu steht.
   * Überstunden zählen erst ab «Gelb markieren ab» der Firma (Tagestotal einer Person, 09.10.2026).
   */
  ueberOffen: number;
}

/**
 * Freier Tag (Wochenende, Feiertag) ohne eine einzige Meldung (Amir 15.11.2026): statt «0 von 1 haben gemeldet»
 * steht «Kein Einsatz» und was am nächsten Arbeitstag geplant ist. Meldet doch ein Team, bleibt alles wie sonst.
 */
interface FreierTag {
  grund: string;
  naechster: Date;
  einsaetze: { teamId: string; team: string; chef: string | null; konto_nr: string | null; baustelle: string | null; bis: string }[];
  /** Aktive Teams ohne Einsatz am nächsten Arbeitstag — «am Montag frei · planen ›» */
  freieTeams: { teamId: string; team: string; chef: string | null }[];
}
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

interface UeberZeile {
  team_id: string; datum: string; baustelle_id: string; regie_entscheid?: string | null; regierapport?: { id: string }[] | null;
  zeiteintrag: { mitarbeiter_id: string; normal_min: number; ueber_min: number; status: string }[] | null;
}

/** Team-Tage (Team · Datum · Baustelle) mit offenen Überstunden; im Regie-Modus ohne die schon entschiedenen. */
function ueberTage(zeilen: UeberZeile[], regie: boolean): number {
  const schluessel = (z: UeberZeile) => `${z.team_id}|${z.datum}|${z.baustelle_id}`;
  // Gelb erst ab dem Tagestotal einer Person — darum alle Einträge der Woche laden, nicht nur die mit Überstunden
  const personTag = (datum: string, id: string) => `${id}|${datum}`;
  const gelb = gelbePersonen(zeilen.flatMap((z) => (z.zeiteintrag ?? []).map((e) => ({ person: personTag(z.datum, e.mitarbeiter_id), normal_min: e.normal_min, ueber_min: e.ueber_min }))));
  const mitUeber = zeilen.filter((z) => (z.zeiteintrag ?? []).some((e) => e.status === 'offen' && e.ueber_min > 0));
  const gelbeZeilen = mitUeber.filter((z) => (z.zeiteintrag ?? []).some((e) => e.status === 'offen' && e.ueber_min > 0 && gelb.has(personTag(z.datum, e.mitarbeiter_id))));
  const entschieden = new Set(mitUeber.filter((z) => regie && ((z.regierapport?.length ?? 0) > 0 || !!z.regie_entscheid)).map(schluessel));
  return new Set(gelbeZeilen.map(schluessel).filter((k) => !entschieden.has(k))).size;
}

/**
 * Nur im Regie-Modus (Firmen-Schalter `MODUS_ERFASSUNG`, 02.10.2026). Steht getrennt, damit die
 * Grundabfrage ohne Regie keine Tabelle anfasst, die diese Firma nicht benutzt.
 */
interface RegieZahlen {
  /** offene Zusatzaufträge (bestellt oder gemeldet) */
  offeneAuftraege: number;
  /** davon heute geplant */
  heuteGeplant: number;
  /** bestellt, geplanter Tag vorbei, keine Meldung — der Moment zum Nachfragen */
  ohneMeldung: number;
  /** Regie in Arbeit (alles ausser bestätigt), davon älter als 30 Tage */
  inArbeitRappen: number;
  inArbeitAltRappen: number;
  /** Rapporte beim Kunden, und wie viele davon über der Frist sind */
  beimKunden: number;
  ueberfaellig: number;
  /** diesen Monat verschickt */
  monatRappen: number;
}

/** Ein Satz pro Bereich fürs Handy-Menü — die Reihenfolge kommt aus der Seitenleiste (eine Ordnung für beide). */
const BEREICH_TEXT: Record<string, string> = {
  '/zusatzauftrag': 'Kundenbestellung festhalten, bevor gearbeitet wird',
  '/regie': 'Versand, Zustellnachweis und Fristen',
  '/auswertung': 'Regie pro Baustelle und Kunde, pro Monat',
  '/board': 'Jahresplan — welches Team wann wo',
  '/heute': 'Wer hat heute gemeldet, wer nicht',
  '/cockpit': 'Prüfen und freigeben, statt telefonieren',
  '/verwaltung': 'Mitarbeitende, Teams, Kunden, Baustellen',
  '/erfassung?wahl': 'Teamgerät — ein Knopf für den normalen Tag',
};

/** Startseite je Ansicht (09.09.): Bauführer, Chefmonteur, Monteur, Sekretariat — «Kunde» nur im Regie-Modus. */
export function Start() {
  const ansicht = useAnsicht();
  if (ansicht === 'chef') return <StartChef />;
  if (ansicht === 'monteur') return <StartMonteur />;
  if (ansicht === 'sekretariat') return <StartSekretariat />;
  if (ansicht === 'kunde') return <StartKunde />;
  return <StartBauf />;
}

/**
 * Bauführer: Kennzahlen, Tagesstand der Teams, alle Bereiche.
 *
 * Regie, Zusatzaufträge und der Trichter kommen nur, wenn die Firma `MODUS_ERFASSUNG = regie`
 * gesetzt hat (Verwaltung → Einstellungen, 02.10.2026). Bei der Gerüst GmbH macht SORBA die Regie.
 */
function StartBauf() {
  const regie = einstellungen().erfassung === 'regie';
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [rz, setRz] = useState<RegieZahlen | null>(null);
  const [tr, setTr] = useState<TrichterDaten | null>(null);
  const [wartend, setWartend] = useState<{ anzahl: number; grund?: string } | null>(null);
  const [fehler, setFehler] = useState('');
  const [woche, setWoche] = useState<WochenTag[] | null>(null);
  const [stand, setStand] = useState<TeamStand[] | null>(null);
  const [frei, setFrei] = useState<FreierTag | null>(null);
  const heute = new Date();
  const vorwoche = iso(addTage(montag(heute), -7));
  // Montag der Woche, die in der Freigabe-Karte steht — automatisch die älteste mit offenen Freigaben
  const [freigabeMo, setFreigabeMo] = useState<Date>(() => montag(new Date()));
  const anfrage = useNeuesteAnfrage();

  /**
   * Alles für die Startseite. Läuft beim Öffnen und wieder, sobald die Seite sichtbar wird oder alle 5 Minuten
   * (13.10.2026 — vorher stand bis zum Neuladen der Stand vom Morgen da). Nur die jüngste Ladung zeigt ihr Ergebnis.
   */
  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    const aktuell = anfrage();
    const heute = new Date();
    const heuteIso = iso(heute);
    const wochenStart = iso(montag(heute));
    const vorwoche = iso(addTage(montag(heute), -7));
    // Erst die lokale Warteschlange leeren, dann zählen — sonst zählt das Dashboard hinterher.
    // Ist der lokale Speicher kaputt (privater Modus, volle Platte), darf das Dashboard trotzdem laden.
    try {
      if (navigator.onLine) {
        const erg = await flushNachSupabase(c);
        const rest = await offeneAnzahl();
        setWartend(rest > 0 ? { anzahl: rest, grund: erg.fehlerText } : null);
      } else {
        const rest = await offeneAnzahl();
        setWartend(rest > 0 ? { anzahl: rest } : null);
      }
    } catch {
      setWartend(null);
    }
    // «Zu prüfen» zählt Team-Tage (nicht Meldungen: zwei Baustellen am Tag sind ein Tag) — darum die Zeilen selbst,
    // seitenweise: ein Zähler der Datenbank zählte Meldungen, und mehr als 1000 schnitt die API still ab
    const grund = await Promise.all([
      c.from('tagesmeldung').select('team_id').eq('datum', heuteIso),
      c.from('team').select('id', { count: 'exact', head: true }).eq('aktiv', true),
      alle<{ datum: string; team_id: string }>((a, b) => c.from('tagesmeldung').select('datum,team_id,zeiteintrag!inner(id)').eq('zeiteintrag.status', 'offen').lte('datum', heuteIso).order('id').range(a, b)),
      c.from('tagesmeldung').select('id', { count: 'exact', head: true }).gte('datum', wochenStart).lte('datum', heuteIso),
      alle<UeberZeile>((a, b) => c.from('tagesmeldung')
        .select('team_id,datum,baustelle_id,' + (regie ? 'regie_entscheid,regierapport(id),' : '') + 'zeiteintrag(mitarbeiter_id,normal_min,ueber_min,status)')
        .gte('datum', vorwoche).lt('datum', wochenStart).order('id').range(a, b)),
    ]).catch((e: unknown) => {
      if (aktuell()) setFehler(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (!grund || !aktuell()) return;
    const [tm, teams, zp, wm, uo] = grund;
    const erster = [tm, teams, wm].find((r) => r.error);
    if (erster?.error) { setFehler(erster.error.message); return; }
    setFehler('');
    // Die Teamnamen braucht die Kachel nicht mehr — die liefert das Board darunter
    const gemeldet = new Set((tm.data ?? []).map((r) => r.team_id));
    const grundFrei = freiGrund(heute);
    if (grundFrei && gemeldet.size === 0) {
      const naechster = naechsterArbeitstag(heute);
      const nIso = iso(naechster);
      const [{ data: plan }, { data: alleTeams }] = await Promise.all([
        c.from('jahresplan')
          .select('team_id,bis,team:team_id(bezeichnung,aktiv,chefmonteur:chefmonteur_id(name)),baustelle:baustelle_id(konto_nr,bezeichnung)')
          .lte('von', nIso).gte('bis', nIso),
        c.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      ]);
      if (!aktuell()) return;
      type PlanZeile = { team_id: string; bis: string; team: { bezeichnung: string; aktiv: boolean; chefmonteur: { name: string } | null } | null; baustelle: { konto_nr: string; bezeichnung: string | null } | null };
      type TeamZeile = { id: string; bezeichnung: string; chefmonteur: { name: string } | null };
      const nachName = <T extends { team: string }>(a: T, b: T) => a.team.localeCompare(b.team, 'de', { numeric: true });
      const einsaetze = ((plan ?? []) as unknown as PlanZeile[])
        .filter((z) => z.team?.aktiv !== false)
        .map((z) => ({ teamId: z.team_id, team: z.team?.bezeichnung ?? 'Team', chef: z.team?.chefmonteur?.name ?? null, konto_nr: z.baustelle?.konto_nr ?? null, baustelle: z.baustelle?.bezeichnung ?? null, bis: z.bis }))
        .sort(nachName);
      const mitEinsatz = new Set(einsaetze.map((e) => e.teamId));
      const freieTeams = ((alleTeams ?? []) as unknown as TeamZeile[])
        .filter((t) => !mitEinsatz.has(t.id))
        .map((t) => ({ teamId: t.id, team: t.bezeichnung, chef: t.chefmonteur?.name ?? null }))
        .sort(nachName);
      setFrei({ grund: grundFrei, naechster, einsaetze, freieTeams });
    } else {
      setFrei(null);
    }
    setK({
      teamsGemeldet: gemeldet.size,
      teams: teams.count ?? 0,
      zuPruefen: new Set(zp.map((r) => r.team_id + r.datum)).size,
      aelterOffen: new Set(zp.filter((r) => r.datum < wochenStart).map((r) => r.team_id + r.datum)).size,
      wocheMeldungen: wm.count ?? 0,
      ueberOffen: ueberTage(uo, regie),
    });
    // Diagramm und Board danach — die Kacheln sollen nicht darauf warten
    // Die Karte springt auf die älteste Woche mit offenen Freigaben (Amir, 04.10.2026) —
    // bis 6 Wochen zurück, auch die laufende. Ist nichts offen, zeigt sie die laufende Woche (Amir 15.11.2026 —
    // vorher die Vorwoche: «In dieser Woche hat noch kein Team gemeldet», obwohl diese Woche alles da war).
    let freigabeBezug = montag(heute);
    const { data: aelteste } = await c
      .from('tagesmeldung')
      .select('datum, zeiteintrag!inner(id)')
      .eq('zeiteintrag.status', 'offen')
      .lte('datum', heuteIso)
      .gte('datum', iso(addTage(montag(heute), -42)))
      .order('datum', { ascending: true })
      .limit(1);
    if (aelteste?.[0]?.datum) freigabeBezug = new Date(aelteste[0].datum + 'T12:00:00');
    const diagramm = await Promise.all([wochenTeams(c, freigabeBezug), teamStand(c, heute)]).catch((e: unknown) => {
      if (aktuell()) setFehler(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (!diagramm || !aktuell()) return;
    const [w, ts] = diagramm;
    setFreigabeMo(montag(freigabeBezug));
    setWoche(w);
    setStand(ts);

    if (!regie) return;
    // Regie-Teil: eigener Block, eigene Fehlerbehandlung — stolpert er, bleibt der Rest der Seite stehen
    // Monatsanfang 00:00 Ortszeit als Zeitpunkt — ein Datum allein hiesse 00:00 UTC, also 02:00 bei uns
    const monatsStart = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString();
    const [za, zaHeute, om, ia, bk, uf, rm] = await Promise.all([
      c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).in('stand', ['bestellt', 'gemeldet']),
      c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('stand', 'bestellt').eq('geplant_fuer', heuteIso),
      c.from('zusatzauftrag_stand').select('id', { count: 'exact', head: true }).eq('ohne_meldung', true),
      alleOderFehler<{ betrag_rappen: number | null; versendet_am: string | null; erstellt_am: string }>((a, b) => c.from('regierapport').select('betrag_rappen,versendet_am,erstellt_am').neq('status', 'bestaetigt').order('id').range(a, b)),
      c.from('regierapport').select('id', { count: 'exact', head: true }).in('status', ['versendet', 'rueckfrage']),
      c.from('regierapport').select('id', { count: 'exact', head: true }).or(`status.eq.frist_abgelaufen,and(status.eq.versendet,frist_bis.lt.${heuteIso})`),
      // Verschickt = Versanddatum zählt, nicht das Anlegen des Entwurfs
      alleOderFehler<{ betrag_rappen: number | null }>((a, b) => c.from('regierapport').select('betrag_rappen').gte('versendet_am', monatsStart).neq('status', 'entwurf').order('id').range(a, b)),
    ]);
    if (!aktuell() || [za, zaHeute, om, ia, bk, uf, rm].some((r) => r.error)) return;
    const dreissigTage = Date.now() - 30 * 86400000;
    const inArbeit = ia.data ?? [];
    setRz({
      offeneAuftraege: za.count ?? 0,
      heuteGeplant: zaHeute.count ?? 0,
      ohneMeldung: om.count ?? 0,
      inArbeitRappen: inArbeit.reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
      inArbeitAltRappen: inArbeit
        .filter((r) => new Date(r.versendet_am ?? r.erstellt_am).getTime() < dreissigTage)
        .reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
      beimKunden: bk.count ?? 0,
      ueberfaellig: uf.count ?? 0,
      monatRappen: (rm.data ?? []).reduce((s, r) => s + (r.betrag_rappen ?? 0), 0),
    });
    try {
      const t = await trichter(c);
      if (aktuell()) setTr(t);
    } catch {
      /* Trichter bleibt, wie er war */
    }
  }, [regie, anfrage]);
  useEffect(() => { void laden(); }, [laden]);
  useAuffrischen(laden);

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="lbl mb-0.5">Bauführer</p>
            <h1 className="font-display text-2xl font-semibold md:text-3xl">{lang(heute)}</h1>
            <p className="mt-1 text-[13px] text-ink3 md:text-sm">
              Woche {kw(heute)} · {kurz(montag(heute))} bis {kurz(addTage(montag(heute), 6))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs text-ink3">
              <span className={'inline-block h-2 w-2 rounded-full ' + (supabase ? 'bg-good' : 'bg-ink3')} />
              {supabase ? 'verbunden' : 'offline-Modus'}
            </span>
            {/* Die eine Aktion — und nur, wenn es etwas zu tun gibt (Firmenrot, siehe index.css) */}
            {regie || !k || k.aelterOffen === 0 ? (
              <Link to="/zusatzauftrag" className="cta cta-accent hidden w-auto px-5 py-2.5 md:block">+ Zusatzarbeit</Link>
            ) : (
              <Link to={`/cockpit?woche=${iso(freigabeMo)}`} className="cta hidden w-auto px-5 py-2.5 md:block">
                Vorwoche prüfen
              </Link>
            )}
          </div>
        </header>

        {/* Handy: der Anruf ist das Dringendste — der Kunde ist noch am Telefon (seit 08.10. auch ohne Regie) */}
        {(
          <Link to="/zusatzauftrag" className="cta cta-accent block p-5 text-left md:hidden">
            <span className="block text-[17px] font-semibold">+ Zusatzarbeit</span>
            <span className="mt-0.5 block text-sm text-white/85">Kundenbestellung festhalten, während er noch am Telefon ist — 20 Sekunden</span>
          </Link>
        )}

        {wartend && (
          <div className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            <strong>{wartend.anzahl} Meldung{wartend.anzahl === 1 ? '' : 'en'} auf diesem Gerät noch nicht gesendet.</strong>
            {wartend.grund ? ` ${wartend.grund}` : ' Wird gesendet, sobald Netz da ist.'}
          </div>
        )}

        {fehler && (
          <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            Kennzahlen konnten nicht geladen werden: {fehler} <button type="button" className="ml-2 font-semibold underline" onClick={() => void laden()}>Nochmals</button>
          </p>
        )}
        {!k && !fehler && supabase && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={'card h-[104px] animate-pulse bg-surface-2 md:h-[116px] ' + (i === 0 ? 'col-span-2 md:col-span-1' : '')} />
            ))}
          </div>
        )}
        {k && (
          <>
            {/* Handy: der Tagesstand steht oben über die ganze Breite, die zwei Zahlen zur Vorwoche darunter */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                {frei ? (
                  <Kachel
                    zu="/planung"
                    titel="Teams heute"
                    wert="Kein Einsatz"
                    label={`${frei.grund} · ${WOCHENTAG[frei.naechster.getDay()]}: ${frei.einsaetze.length === 0 ? 'noch nichts geplant' : `${new Set(frei.einsaetze.map((e) => e.team)).size} ${new Set(frei.einsaetze.map((e) => e.team)).size === 1 ? 'Team' : 'Teams'} geplant`}`}
                    icon={Users}
                    farbe="blau"
                  />
                ) : (
                  <Kachel
                    zu="/heute"
                    titel="Teams heute"
                    wert={`${k.teamsGemeldet} von ${k.teams}`}
                    label="haben schon gemeldet"
                    icon={Users}
                    fortschritt={{ von: k.teamsGemeldet, bis: k.teams }}
                    farbe="blau"
                  />
                )}
              </div>
              <Kachel
                zu={`/cockpit?woche=${k.aelterOffen > 0 ? iso(freigabeMo) : iso(montag(heute))}`}
                titel="Freigabe"
                wert={String(k.zuPruefen)}
                label={
                  k.zuPruefen > 0
                    ? `${k.zuPruefen === 1 ? 'Tag wartet' : 'Tage warten'} auf Freigabe${k.aelterOffen > 0 ? ` · ${k.aelterOffen === k.zuPruefen ? 'aus der Vorwoche' : `${k.aelterOffen} aus der Vorwoche`}` : ''}`
                    : k.wocheMeldungen > 0 ? 'diese Woche alles freigegeben' : 'diese Woche noch keine Meldungen'
                }
                icon={CalendarCheck}
                farbe="gelb"
              />
              <Kachel
                zu={`/cockpit?woche=${vorwoche}`}
                titel="Überstunden"
                wert={String(k.ueberOffen)}
                label={k.ueberOffen > 0 ? `${k.ueberOffen === 1 ? 'Tag' : 'Tage'} aus der Vorwoche — Notiz lesen` : 'aus der Vorwoche offen'}
                icon={AlarmClock}
                farbe="rot"
              />
            </div>

            {/* Regie: eigene Reihe, damit die Stunden oben ungestört bleiben */}
            {rz && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kachel
                  zu="/zusatzauftrag"
                  icon={PhoneCall}
                  titel="Zusatzaufträge"
                  wert={String(rz.offeneAuftraege)}
                  label={
                    rz.ohneMeldung > 0
                      ? `offen · ${rz.ohneMeldung} ohne Meldung vom Team`
                      : rz.heuteGeplant > 0
                        ? `offen · ${rz.heuteGeplant} heute geplant`
                        : 'offen'
                  }
                  farbe="blau"
                />
                <Kachel
                  zu="/regie"
                  icon={Banknote}
                  titel="Regie in Arbeit"
                  wert={formatChf(rz.inArbeitRappen)}
                  label={
                    rz.inArbeitAltRappen > 0
                      ? `${formatChf(rz.inArbeitAltRappen)} älter als 30 Tage`
                      : `${rz.beimKunden} beim Kunden`
                  }
                  farbe="gelb"
                />
                <Kachel zu="/regie" icon={AlarmClock} titel="Fristen" wert={String(rz.ueberfaellig)} label="abgelaufen — nachfassen" farbe="rot" />
                <Kachel zu="/auswertung" icon={Send} titel="Verschickt" wert={formatChf(rz.monatRappen)} label={`Regie im ${MONATE[heute.getMonth()]}`} farbe="gruen" />
              </div>
            )}

            {/* Handy: derselbe Knopf wie oben am PC — dort ist er in der Kopfzeile */}
            {k.aelterOffen > 0 && (
              <Link to={`/cockpit?woche=${iso(freigabeMo)}`} className="cta md:hidden">
                Vorwoche prüfen
              </Link>
            )}
          </>
        )}

        {/* Seit 20.09. auch am Handy: die Säulen haben feste Höhe und passen in die schmale Spalte */}
        <div className={'grid gap-4 ' + (tr ? 'lg:grid-cols-2' : '')}>
          {woche && (
            <DiagrammKarte
              titel={iso(freigabeMo) === iso(montag(heute)) ? 'Freigabe diese Woche' : iso(freigabeMo) === vorwoche ? 'Freigabe Vorwoche' : `Freigabe Woche ${kw(freigabeMo)}`}
              unter={`${kurz(freigabeMo)} bis ${kurz(addTage(freigabeMo, 6))}`}
              aktion={<Link to={`/cockpit?woche=${iso(freigabeMo)}`} className="shrink-0 text-xs font-semibold text-steel">Woche öffnen ›</Link>}
            >
              <WochenTeams tage={woche} woche={iso(freigabeMo)} />
            </DiagrammKarte>
          )}
          {tr && (
            <DiagrammKarte
              titel="Zusatzaufträge"
              unter="Wo sie stehen — letzte 60 Tage, Stand abgeleitet"
              aktion={<Link to="/auswertung" className="shrink-0 text-xs font-semibold text-steel">Auswertung ›</Link>}
            >
              <Trichter stufen={tr.stufen} ohneMeldung={tr.ohneMeldung} />
            </DiagrammKarte>
          )}
        </div>

        {frei ? (
          <FreierTagKarte frei={frei} />
        ) : stand && stand.length > 0 && heute.getDay() >= 1 && heute.getDay() <= 6 && (
          <div className="hidden md:block">
            <TeamBoard teams={stand} />
          </div>
        )}

        {/* Handy: Karten je Bereich. Ab iPad steht die Bereichsleiste in der Kopfzeile (Shell). */}
        <nav className="md:hidden">
          <p className="lbl">Bereiche</p>
          <div className="grid gap-2.5">
            {navFuer('bauf').flatMap((g) => g.eintraege).filter((e) => e.zu !== '/').map((e) => (
              <NavKarte key={e.zu} zu={e.zu} titel={e.label} text={BEREICH_TEXT[e.zu] ?? ''} />
            ))}
          </div>
        </nav>
      </div>
    </Shell>
  );
}

/** Wochentag kurz: «Mo» */
const wt = (d: Date) => WOCHENTAG[d.getDay()].slice(0, 2);

/**
 * Statt «Teams heute» an einem freien Tag (Konzept A «Kalenderblatt», Amir 15.11.2026 — vorher ein grauer Kasten):
 * Kalenderblatt des nächsten Arbeitstags, ein Satz, und je Team eine Karte mit Baustelle und wie lange der Einsatz
 * dauert. Teams ohne Einsatz hell umrandet mit «planen ›». Ab 7 Einsätzen die ersten 6 und «+ n weitere».
 */
function FreierTagKarte({ frei }: { frei: FreierTag }) {
  const n = frei.naechster;
  const nIso = iso(n);
  const teams = new Set(frei.einsaetze.map((e) => e.teamId)).size;
  const baustellen = new Set(frei.einsaetze.map((e) => e.konto_nr ?? e.baustelle)).size;
  const MAX = 6;
  const sichtbar = frei.einsaetze.slice(0, MAX);
  const platz = Math.max(0, MAX - sichtbar.length);
  const freieSichtbar = frei.freieTeams.slice(0, platz);
  const rest = frei.einsaetze.length - sichtbar.length + frei.freieTeams.length - freieSichtbar.length;
  const dauer = (bis: string) => {
    if (bis === nIso) return `nur ${wt(n)}`;
    const ende = new Date(bis + 'T12:00:00');
    return (ende.getTime() - n.getTime()) / 86400000 <= 6 ? `${wt(n)} – ${wt(ende)}` : `bis ${kurz(ende)}`;
  };
  const avatar = (id: string, chef: string | null, team: string) => (
    <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12.5px] font-bold ' + teamFarbe(id)}>{initialen(chef) ?? teamKuerzel(team)}</span>
  );
  const satz = teams === 0
    ? 'Heute muss niemand melden. Für ' + WOCHENTAG[n.getDay()] + ' ist noch nichts geplant.'
    : `Heute muss niemand melden. Am ${WOCHENTAG[n.getDay()]}: ${teams === 1 ? '1 Team' : `${teams} Teams`}${teams > 1 ? ` auf ${baustellen} ${baustellen === 1 ? 'Baustelle' : 'Baustellen'}` : ''}${frei.freieTeams.length > 0 ? ` · ${frei.freieTeams.length} ${frei.freieTeams.length === 1 ? 'Team' : 'Teams'} frei` : ''}`;
  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <p className="lbl mb-0">Teams heute</p>
        <Link to="/planung" className="shrink-0 text-xs font-semibold text-steel">Planung ›</Link>
      </div>
      <div className="mt-3 flex items-center gap-5">
        <div className="w-[84px] shrink-0 overflow-hidden rounded-[18px] bg-white text-center shadow-[0_10px_24px_-14px_rgb(43_108_176/0.55),0_0_0_1px_#d3e3f6]" aria-hidden="true">
          <div className="bg-gradient-to-b from-[#3b82d6] to-steel py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-white">{WOCHENTAG[n.getDay()]}</div>
          <div className="pt-1 font-display text-[34px] font-bold leading-[1.05] tracking-tight text-ink">{n.getDate()}</div>
          <div className="pb-2 text-[10.5px] font-semibold text-ink3">{MONATE[n.getMonth()]}</div>
        </div>
        <div className="min-w-0">
          <p className="font-display text-[19px] font-semibold leading-tight text-ink">{frei.grund} — {WOCHENTAG[n.getDay()]} geht es weiter</p>
          <p className="mt-1 text-[13.5px] text-ink3">{satz}</p>
        </div>
      </div>
      {(sichtbar.length > 0 || freieSichtbar.length > 0) && (
        <ul className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {sichtbar.map((e, i) => (
            <li key={e.teamId + i} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-gradient-to-r from-[#f3f8fe] to-white px-3.5 py-3 shadow-[0_0_0_1px_#dce8f6]">
              {avatar(e.teamId, e.chef, e.team)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm"><b className="font-semibold text-ink">{e.team}</b>{e.chef && <span className="text-ink3"> · {kurzName(e.chef)}</span>}</p>
                <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-sm">
                  {e.konto_nr && <span className="knr shrink-0">{e.konto_nr}</span>}
                  <span className="line-clamp-2 min-w-0 font-medium leading-snug text-ink" title={e.baustelle ?? undefined}>{e.baustelle ?? 'Baustelle'}</span>
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-steel-soft px-2.5 py-0.5 text-xs font-bold text-steel">{dauer(e.bis)}</span>
            </li>
          ))}
          {freieSichtbar.map((t) => (
            <li key={t.teamId} className="min-w-0">
              <Link to="/planung" className="flex items-center gap-3 rounded-[16px] px-3.5 py-3 shadow-[inset_0_0_0_1.5px_#e3e0da] transition hover:shadow-[inset_0_0_0_1.5px_#c9d9ee]">
                <span className="opacity-55">{avatar(t.teamId, t.chef, t.team)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm"><b className="font-semibold text-ink2">{t.team}</b>{t.chef && <span className="text-ink3"> · {kurzName(t.chef)}</span>}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink3">am {WOCHENTAG[n.getDay()]} frei · noch nichts geplant <span className="font-bold text-steel">planen ›</span></p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="mt-3 text-[13px] text-ink3">+ {rest} weitere · <Link to="/planung" className="font-semibold text-steel">Planung ›</Link></p>
      )}
    </section>
  );
}

/** «Nikola Vaiti» → «N. Vaiti» */
function kurzName(name: string): string {
  const teile = name.trim().split(/\s+/);
  return teile.length > 1 ? `${teile[0][0]}. ${teile.slice(1).join(' ')}` : name;
}
