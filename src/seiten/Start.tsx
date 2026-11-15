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
  /** Aktive Teams ohne Einsatz am nächsten Arbeitstag */
  freieTeams: { teamId: string; team: string; chef: string | null }[];
  /** Die nächsten 3 Arbeitstage mit Einsätzen und freien Teams (Konzept B «Schönes Wochenende», 15.11.2026) */
  tage: { datum: Date; einsaetze: FreierTag['einsaetze']; freieTeams: FreierTag['freieTeams'] }[];
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
      const tageDaten = [naechster];
      while (tageDaten.length < 3) tageDaten.push(naechsterArbeitstag(tageDaten[tageDaten.length - 1]));
      const nIso = iso(naechster);
      const letzterIso = iso(tageDaten[tageDaten.length - 1]);
      const [{ data: plan }, { data: alleTeams }] = await Promise.all([
        c.from('jahresplan')
          .select('team_id,von,bis,team:team_id(bezeichnung,aktiv,chefmonteur:chefmonteur_id(name)),baustelle:baustelle_id(konto_nr,bezeichnung)')
          .lte('von', letzterIso).gte('bis', nIso),
        c.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      ]);
      if (!aktuell()) return;
      type PlanZeile = { team_id: string; von: string; bis: string; team: { bezeichnung: string; aktiv: boolean; chefmonteur: { name: string } | null } | null; baustelle: { konto_nr: string; bezeichnung: string | null } | null };
      type TeamZeile = { id: string; bezeichnung: string; chefmonteur: { name: string } | null };
      const nachName = <T extends { team: string }>(a: T, b: T) => a.team.localeCompare(b.team, 'de', { numeric: true });
      const planZeilen = ((plan ?? []) as unknown as PlanZeile[]).filter((z) => z.team?.aktiv !== false);
      const teamListe = ((alleTeams ?? []) as unknown as TeamZeile[]).map((t) => ({ teamId: t.id, team: t.bezeichnung, chef: t.chefmonteur?.name ?? null })).sort(nachName);
      const tage = tageDaten.map((datum) => {
        const dIso = iso(datum);
        const einsaetze = planZeilen
          .filter((z) => z.von <= dIso && z.bis >= dIso)
          .map((z) => ({ teamId: z.team_id, team: z.team?.bezeichnung ?? 'Team', chef: z.team?.chefmonteur?.name ?? null, konto_nr: z.baustelle?.konto_nr ?? null, baustelle: z.baustelle?.bezeichnung ?? null, bis: z.bis }))
          .sort(nachName);
        const mitEinsatz = new Set(einsaetze.map((e) => e.teamId));
        return { datum, einsaetze, freieTeams: teamListe.filter((t) => !mitEinsatz.has(t.teamId)) };
      });
      setFrei({ grund: grundFrei, naechster, einsaetze: tage[0].einsaetze, freieTeams: tage[0].freieTeams, tage });
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
          {/* «verbunden» und «+ Zusatzarbeit» sind weg (Amir 15.11.2026). Bleibt nur der Hinweis auf offene Vorwochen. */}
          {!regie && k && k.aelterOffen > 0 && (
            <Link to={`/cockpit?woche=${iso(freigabeMo)}`} className="cta hidden w-auto shrink-0 px-5 py-2.5 md:block">
              Vorwoche prüfen
            </Link>
          )}
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
              <WochenTeams tage={woche} woche={iso(freigabeMo)} teamNamen={new Map((stand ?? []).map((t) => [t.id, t.bezeichnung]))} />
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
 * Statt «Teams heute» an einem freien Tag (Konzept B «Schönes Wochenende», Amir 15.11.2026 — vorher ein grauer
 * Kasten): links ein Gruss, rechts die nächsten 3 Arbeitstage. Ein Team: Team und Baustelle. Mehrere: Avatare,
 * «4 Teams · 4 Baustellen» und die Baustellen kurz. Fehlt ein Team, rechts orange «Team 5 frei · planen ›».
 */
function FreierTagKarte({ frei }: { frei: FreierTag }) {
  const avatar = (id: string, chef: string | null, team: string, klein = false) => (
    <span className={'grid shrink-0 place-items-center rounded-full font-bold ' + (klein ? 'h-[30px] w-[30px] text-[10px] ring-[2.5px] ring-good-soft' : 'h-[30px] w-[30px] text-[11px]') + ' ' + teamFarbe(id)}>{initialen(chef) ?? teamKuerzel(team)}</span>
  );
  const kurzOrt = (b: string | null) => (b ?? 'Baustelle').replace(/^(Wohnüberbauung|Neubau|Fassade|Dachsanierung|Sanierung|Umbau)\s+/i, '');
  const gruss = frei.grund === 'Wochenende'
    ? <>Schönes<br /><em className="not-italic text-amber-deep">Wochenende.</em></>
    : <>Heute frei:<br /><em className="not-italic text-amber-deep">{frei.grund}.</em></>;
  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <p className="lbl mb-0">Teams heute</p>
        <Link to="/planung" className="shrink-0 text-xs font-semibold text-steel">Planung ›</Link>
      </div>
      <div className="mt-3 grid overflow-hidden rounded-[18px] shadow-[0_0_0_1px_var(--color-line)] md:grid-cols-[0.8fr_1.5fr]">
        <div className="bg-[radial-gradient(120%_120%_at_0%_0%,#fff4dc_0,#fff_60%)] p-5">
          <p className="font-display text-[26px] font-bold leading-[1.1] tracking-tight text-ink md:text-[28px]">{gruss}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">Heute ist kein Team eingeplant — niemand muss melden. So geht es weiter:</p>
        </div>
        <ul className="divide-y divide-line/0 border-t border-line bg-white px-4 py-2 md:border-l md:border-t-0 md:px-5">
          {frei.tage.map((tag) => {
            const teams = [...new Map(tag.einsaetze.map((e) => [e.teamId, e])).values()];
            const baustellen = [...new Map(tag.einsaetze.map((e) => [e.konto_nr ?? e.baustelle, e])).values()];
            const freie = tag.freieTeams;
            const luecke = freie.length === 0 ? null : freie.length === 1 ? `${freie[0].team} frei` : `${freie.length} frei`;
            return (
              <li key={iso(tag.datum)} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 py-2">
                <div className="text-center">
                  <p className="text-[10.5px] font-bold uppercase text-ink3">{wt(tag.datum)}</p>
                  <p className="font-display text-[20px] font-bold leading-none tracking-tight text-ink">{tag.datum.getDate()}</p>
                </div>
                {teams.length === 0 ? (
                  <Link to="/planung" className="rounded-[14px] px-3 py-2.5 text-[13px] text-ink3 shadow-[inset_0_0_0_1.5px_var(--color-line)]">
                    noch nichts geplant · <span className="font-bold text-steel">planen ›</span>
                  </Link>
                ) : teams.length === 1 && freie.length === 0 ? (
                  <div className="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-good-soft px-3 py-2.5">
                    {avatar(teams[0].teamId, teams[0].chef, teams[0].team)}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{teams[0].team}</p>
                      <p className="truncate text-[12.5px] text-ink2" title={teams[0].baustelle ?? undefined}>{teams[0].baustelle ?? 'Baustelle'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 rounded-[14px] bg-good-soft px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="flex">
                        {teams.slice(0, 5).map((e, i) => <span key={e.teamId} className={i > 0 ? '-ml-1' : ''}>{avatar(e.teamId, e.chef, e.team, true)}</span>)}
                      </span>
                      <b className="whitespace-nowrap text-sm font-semibold text-ink">
                        {teams.length} {teams.length === 1 ? 'Team' : 'Teams'} · {baustellen.length} {baustellen.length === 1 ? 'Baustelle' : 'Baustellen'}
                      </b>
                      {luecke && (
                        <Link to="/planung" className="ml-auto whitespace-nowrap rounded-full bg-amber-soft px-2.5 py-0.5 text-[11.5px] font-bold text-amber-deep">
                          {luecke} · planen ›
                        </Link>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink2">{baustellen.map((e) => kurzOrt(e.baustelle)).join(' · ')}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
