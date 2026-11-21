import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gemerkt, merken } from '../lib/merker';
import * as Doppelt from '../lib/doppelt';
import { useSearchParams } from 'react-router-dom';
import { Archive, ArrowRightLeft, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, CircleCheck, History, Info, MapPin, MessageSquareText, MousePointerClick, Pencil, Plus, Search, Trash2, TriangleAlert, Undo2, Users, X } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { Dialog, Avatar } from '../ui/Dialog';
import { Auswahl } from '../ui/Auswahl';
import { ArtPille } from '../ui/ArtPille';
import { supabase } from '../lib/supabase';
import { alleOderFehler, stuecke } from '../lib/abfrage';
import { useAuffrischen, useNeuesteAnfrage } from '../lib/auffrischen';
import { addTage, ausIso, iso, kurz, kw, lang, montag, WOCHENTAGE } from '../lib/datum';
import {
  arbeitstage, besetzung, beginnFuerRest, ersatzVorschlaege, halbtagSpuren, heuteUndNaechster, spaeterBeginnAllein, istBalken, konflikte, konflikteBuendeln, naechsterTeamName, ohneTag, planAm, planIst, spuren, ueberschneiden, zeitraumVorschlag,
  type FehltGemeldet, type KonfliktBlock, type Schnellwahl, type TagesBesetzung, type VerlaufZeile, type Versetzung, type Zeitraum,
} from '../lib/planung';
import { artText, werktage } from '../lib/abwesenheit';
import { feiertag } from '../lib/feiertage';
import { arbeitstag, einstellungen } from '../lib/einstellungen';
import { ausUhrzeit, uhrzeit, uhrzeitFeld } from '../lib/zeiten';
import { FUNKTION_BUERO } from '../lib/benutzername';
import { DatumWahl } from '../ui/DatumWahl';
import { ZeitFeld } from '../ui/ZeitFeld';
import { Pille } from '../ui/Segment';
import { baustellenSuchen } from '../lib/suche';
import { warnungenZusammen, type WetterTag } from '../lib/wetter';
import { WetterKopf, WetterWarnung, WetterZeile } from '../ui/WetterZeichen';

/**
 * Planung (06.10.2026, ersetzt das Board): Zeilen = Teams, Spalten = Tage. Ein Einsatz ist ein Balken über
 * die geplanten Tage. Freien Tag antippen = an diesem Tag planen, Balken antippen = ändern oder entfernen.
 *
 * Einsatzplanung je Tag (Mehmeti, 10./11.10.2026): unter den Balken eine Tageszeile je Team — wie viele Leute an dem Tag
 * dabei sind, wer aus einem anderen Team dazukommt (+), wer weg ist (−), wer abwesend ist, und für vergangene Tage, ob
 * so gemeldet wurde wie geplant (Plan gegen Ist — die alten Wochen sind das Archiv). Antippen öffnet den Tag: Leute
 * versetzen (nur dieser Tag oder bis Freitag), dazunehmen, Baustelle nur an diesem Tag ändern. «+ Team» legt ein
 * Zusatzteam an (z. B. Team 7 für eine neue Baustelle).
 *
 * Geschrieben wird in `jahresplan` (Team × Baustelle × von–bis) und `einsatz_person` (Person × Tag × Team, Migration 0036);
 * Erfassung und Tagesübersicht schlagen daraus die Baustelle vor, das Teamgerät übernimmt die Leute des Tages.
 * Änderungen an bestehenden Einsätzen landen in `planaenderung` (Terminhistorie, im Einsatz als «Verlauf»).
 *
 * Entwurf und Archiv (Migration 0038, Mehmeti): «Während der Woche gibt es Änderungen — am Ende sieht die Planung ganz
 * anders aus als geplant. Solange die Woche läuft, ist sie Entwurf; danach zurückgehen und sehen, wo die Teams waren.»
 * Die Datenbank schreibt jede Änderung an Einsätzen und Einteilungen in `plan_verlauf`. Daraus: Wochenstatus (Entwurf ·
 * Archiv), drei Ansichten für Wochen mit vergangenen Tagen — Aktueller Plan, Geplant am Montag (rückwärts aus dem
 * Verlauf), Wirklich gewesen (aus den Meldungen, darunter gestrichelt, was am Montag anders geplant war). Die Liste des
 * Verlaufs unter dem Raster ist am 11.10.2026 wieder weg (Amir: verwirrend) — der Verlauf selbst bleibt in der Datenbank.
 */

interface Team { id: string; bezeichnung: string; chefmonteur_id: string | null; chefmonteur: { name: string } | null }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null; status: string | null }
type Treffpunkt = 'baustelle' | 'werkhof';
/** Einsatzfelder (Migration 0049): fehlt die Migration, sind sie undefined — dann nichts davon schreiben. */
interface EinsatzFelder { soll_leute?: number | null; beginn_min?: number | null; treffpunkt?: Treffpunkt | null; hinweis?: string | null }
interface Plan extends EinsatzFelder { id: string; team_id: string | null; von: string; bis: string; baustelle: Baustelle | null }
interface Person { id: string; name: string; funktion: string }
interface Mitglied { team_id: string; mitarbeiter: (Person & { aktiv: boolean }) | null }
interface IstZeile { team_id: string | null; datum: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null; zeiteintrag: { mitarbeiter_id: string }[] }
interface Abw { datum: string; mitarbeiter_id: string; art: string }

/** Ruhige Töne je Baustelle — dieselbe Baustelle hat in jeder Woche dieselbe Farbe. */
const FARBEN = [
  { balken: 'from-[#eef4fc] to-[#d6e6f8] ring-steel/25 text-[#1d4f86]', punkt: 'bg-steel' },
  { balken: 'from-[#ecf8f1] to-[#d4f0e0] ring-good/25 text-good-deep', punkt: 'bg-good' },
  { balken: 'from-[#fff7e3] to-[#fbe6ae] ring-amber/35 text-amber-deep', punkt: 'bg-amber' },
  { balken: 'from-[#fdf0ee] to-[#f9d8d1] ring-accent/25 text-accent-deep', punkt: 'bg-accent' },
  { balken: 'from-[#f3f0fd] to-[#e2d9fb] ring-[#6d4fd1]/25 text-[#4c33a8]', punkt: 'bg-[#6d4fd1]' },
  { balken: 'from-[#ebf8f8] to-[#cdeeee] ring-[#1a8c8c]/25 text-[#136a6a]', punkt: 'bg-[#1a8c8c]' },
];

function farbeVon(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FARBEN[h % FARBEN.length];
}

function kurzName(name: string): string {
  const teile = name.trim().split(' ');
  return teile.length > 1 ? `${teile[0][0]}. ${teile.slice(1).join(' ')}` : name;
}

const istWochenende = (d: Date) => (d.getDay() + 6) % 7 >= 5;
/** Kein Arbeitstag: Wochenende oder Feiertag (Kanton Bern) — grau, ohne Konflikte */
const istFrei = (d: Date) => istWochenende(d) || !!feiertag(iso(d));
const TREFFPUNKT_TEXT: Record<Treffpunkt, string> = { baustelle: 'Baustelle', werkhof: 'Werkhof' };

/** Nur die Einsatzfelder, die geladen wurden (ohne 0049 keine) — zum Mitkopieren beim Zerschneiden. */
function felderVon(p: EinsatzFelder): EinsatzFelder {
  const o: EinsatzFelder = {};
  if (p.soll_leute !== undefined) o.soll_leute = p.soll_leute;
  if (p.beginn_min !== undefined) o.beginn_min = p.beginn_min;
  if (p.treffpunkt !== undefined) o.treffpunkt = p.treffpunkt;
  if (p.hinweis !== undefined) o.hinweis = p.hinweis;
  return o;
}

/** «ab 6:30 · Treffpunkt Werkhof» — leer, wenn nichts gesetzt ist. «Leute nötig» ist seit 13.11.2026 weg (Amir). */
function felderText(p: EinsatzFelder): string {
  return [
    p.beginn_min != null && `ab ${uhrzeit(p.beginn_min)}`,
    p.treffpunkt && `Treffpunkt ${TREFFPUNKT_TEXT[p.treffpunkt]}`,
  ].filter(Boolean).join(' · ');
}
/** «Di 13.10.» */
const tagKurz = (d: Date) => `${WOCHENTAGE[(d.getDay() + 6) % 7]} ${kurz(d)}`;
/** Freitag derselben Woche (am Wochenende: der Tag selbst). */
function freitagVon(tag: string): string {
  const d = ausIso(tag);
  const wt = (d.getDay() + 6) % 7;
  return wt <= 4 ? iso(addTage(d, 4 - wt)) : tag;
}

const SPUR_HOEHE = 40;
/** Teamspalte: am Handy schmal, am PC mit Platz für die Namen — als CSS-Variable, damit Raster und Mindestbreite mitgehen */
const TEAM_SPALTE_KLASSE = '[--team:152px] md:[--team:250px]';

/** Der Einsatz steht nicht mehr so da, wie der Dialog ihn zeigt — jemand hat ihn inzwischen geändert. */
class PlanGeaendert extends Error {}

/** Was der Einsatz-Dialog bearbeitet: neuer Einsatz (ohne id) oder ein bestehender. */
interface Entwurf extends EinsatzFelder { id?: string; teamId: string; baustelle: Baustelle | null; von: string; bis: string; tag: string }

const PLAN_SPALTEN = 'id,team_id,von,bis,soll_leute,beginn_min,treffpunkt,hinweis,baustelle:baustelle_id(id,konto_nr,bezeichnung,status)';
/** Ohne Migration 0049 */
const PLAN_SPALTEN_ALT = 'id,team_id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung,status)';
const felderFehlenIn = (m: string) => /soll_leute|beginn_min|treffpunkt|hinweis/.test(m) && /column|schema cache|does not exist/i.test(m);

export function Planung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [plaene, setPlaene] = useState<Plan[]>([]);
  const [mitglieder, setMitglieder] = useState<Mitglied[]>([]);
  const [personen, setPersonen] = useState<Person[]>([]);
  const [versetzungen, setVersetzungen] = useState<Versetzung[]>([]);
  const [abwesend, setAbwesend] = useState<Abw[]>([]);
  /** Vom Team als «fehlt» gemeldet, noch offen (0053) */
  const [fehltOffen, setFehltOffen] = useState<FehltGemeldet[]>([]);
  const [ist, setIst] = useState<IstZeile[]>([]);
  /** einsatz_person fehlt noch (Migration 0036) — Versetzen geht dann nicht */
  const [einsatzFehlt, setEinsatzFehlt] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  // ?woche=2026-10-28 (z. B. aus «Abwesenheit eintragen»): diese Woche zeigen
  const [params, setParams] = useSearchParams();
  const [start, setStart] = useState(() => {
    const w = params.get('woche') ?? params.get('tag');
    return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? montag(ausIso(w)) : montag(new Date());
  });
  // Sprung von der Tageskarte mit ?tag&team=a,b&baustelle (25.10.2026, Amir: «da sehe ich nicht genau, welche es ist»):
  // wie in der Wochenübersicht den Tag blau markieren, dazu die Teams und ihren Einsatz. Weg beim Wochenwechsel, beim
  // Öffnen eines anderen Tags oder per «Markierung aufheben» — auch aus der Adresse, damit «Zurück» sie nicht wiederbringt.
  const [mark, setMark] = useState<{ tag: string; teams: string[]; baustelle: string | null } | null>(() => {
    const t = params.get('tag');
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    return { tag: t, teams: (params.get('team') ?? '').split(',').filter(Boolean), baustelle: params.get('baustelle') };
  });
  const markierungWeg = useCallback(() => {
    setMark(null);
    setParams((p) => { const n = new URLSearchParams(p); n.delete('tag'); n.delete('team'); n.delete('baustelle'); return n; }, { replace: true });
  }, [setParams]);
  const [anzahlTage, setAnzahlTage] = useState<7 | 14>(7);
  // Halbtage (21.11.2026, Konzept B): Vormittag/Nachmittag je Tag — Wahl bleibt auf dem Gerät
  const [halbtage, setHalbtageRoh] = useState(() => { try { return localStorage.getItem('planung-halbtage') === 'ja'; } catch { return false; } });
  const setHalbtage = (v: boolean) => { setHalbtageRoh(v); try { localStorage.setItem('planung-halbtage', v ? 'ja' : 'nein'); } catch { /* egal */ } };
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  /** `dazu`: gleich «Person dazunehmen» öffnen (aus der Konfliktliste) */
  const [tagWahl, setTagWahl] = useState<{ teamId: string; datum: string; dazu?: boolean } | null>(null);
  /** Migration 0049 fehlt: Einsatzfelder ausblenden, nichts davon schreiben */
  const [felderFehlen, setFelderFehlen] = useState(false);
  const [teamNeu, setTeamNeu] = useState(false);
  const [rueckmeldung, setRueckmeldung] = useState<string | null>(null);
  /** Verlauf aller Änderungen an Einsätzen und Einteilungen (0038) — für «Plan vom Montag» und die Liste unten */
  const [verlauf, setVerlauf] = useState<VerlaufZeile[]>([]);
  /** Baustellen, die nur im Verlauf vorkommen (z. B. inzwischen abgeschlossen) */
  const [zusatzBaustellen, setZusatzBaustellen] = useState<Baustelle[]>([]);
  const [ansicht, setAnsicht] = useState<'plan' | 'montag' | 'ist'>('plan');
  /** Wetter (0054): je Baustelle und Tag («id|datum») und im Gebiet der Firma (je Tag) — ab heute, MeteoSchweiz */
  const [wetter, setWetter] = useState<{ ort: Map<string, WetterTag>; gebiet: Map<string, WetterTag> }>({ ort: new Map(), gebiet: new Map() });

  const tage = useMemo(() => Array.from({ length: anzahlTage }, (_, i) => addTage(start, i)), [start, anzahlTage]);
  const startIso = iso(start);
  const endeIso = iso(addTage(start, anzahlTage - 1));
  const heuteIso = iso(new Date());

  const anfrage = useNeuesteAnfrage();
  /**
   * Zwei, drei Runden nacheinander — nach jeder zählt nur, ob das noch die jüngste Anfrage ist: wer schnell die Woche
   * wechselt, sieht nie Teams der neuen und Verlauf der alten Woche. Seitenweise, wo es über 1000 Zeilen werden können.
   * `still`: ohne «Lädt …» (nach einer Änderung, beim Auffrischen); scheitert es dann, bleibt das Raster stehen.
   */
  // Zwischenspeicher je Zeitraum (15.11.2026): ein schon gesehener Plan steht sofort da, geladen wird still dahinter
  type PlanDaten = {
    teams: Team[]; baustellen: Baustelle[]; plaene: Plan[]; mitglieder: Mitglied[]; personen: Person[]; einsatzFehlt: boolean;
    versetzungen: Versetzung[]; abwesend: Abw[]; fehltOffen: FehltGemeldet[]; ist: IstZeile[]; verlauf: VerlaufZeile[]; zusatzBaustellen: Baustelle[];
  };
  const anwenden = useCallback((d: PlanDaten) => {
    setTeams(d.teams); setBaustellen(d.baustellen); setPlaene(d.plaene); setMitglieder(d.mitglieder); setPersonen(d.personen);
    setEinsatzFehlt(d.einsatzFehlt); setVersetzungen(d.versetzungen); setAbwesend(d.abwesend); setFehltOffen(d.fehltOffen);
    setIst(d.ist); setVerlauf(d.verlauf); setZusatzBaustellen(d.zusatzBaustellen); setLaedt(false);
  }, []);
  // Vor dem ersten Zeichnen — sonst blitzte für einen Moment die leere Planung auf
  useLayoutEffect(() => {
    const d = gemerkt<PlanDaten>(`planung|${startIso}|${endeIso}`);
    if (d) anwenden(d);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const laden = useCallback(async (still = false) => {
    if (!supabase) return;
    const c = supabase;
    const aktuell = anfrage();
    const schluessel = `planung|${startIso}|${endeIso}`;
    const vorher = gemerkt<PlanDaten>(schluessel);
    if (vorher && !still) { anwenden(vorher); still = true; }
    if (!still) setLaedt(true);
    const istBis = endeIso < heuteIso ? endeIso : heuteIso;
    // Wetter nebenher (0054) — ohne Migration oder ohne Daten steht einfach keins; vergangene Tage haben keine Prognose
    if (endeIso >= heuteIso) {
      void c.rpc('wetter_tage', { p_von: startIso < heuteIso ? heuteIso : startIso, p_bis: endeIso }).then(({ data, error }) => {
        if (!aktuell() || error) return;
        const ort = new Map<string, WetterTag>();
        const gebiet = new Map<string, WetterTag>();
        for (const r of (data ?? []) as (WetterTag & { baustelle_id: string | null })[]) {
          if (r.baustelle_id) ort.set(`${r.baustelle_id}|${r.datum}`, r); else gebiet.set(r.datum, r);
        }
        setWetter({ ort, gebiet });
      });
    } else setWetter({ ort: new Map(), gebiet: new Map() });
    const plaeneLaden = (spalten: string) =>
      alleOderFehler<Plan>((von, bis) => c.from('jahresplan').select(spalten).gte('bis', startIso).lte('von', endeIso).order('id').range(von, bis));
    const [t, b, p0, m, ma] = await Promise.all([
      c.from('team').select('id,bezeichnung,chefmonteur_id,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      alleOderFehler<Baustelle>((von, bis) => c.from('baustelle').select('id,konto_nr,bezeichnung,status').neq('status', 'abgeschlossen').order('bezeichnung').order('id').range(von, bis)),
      plaeneLaden(PLAN_SPALTEN),
      c.from('team_mitglied').select('team_id,mitarbeiter:mitarbeiter_id(id,name,funktion,aktiv)').is('bis', null),
      c.from('mitarbeiter').select('id,name,funktion').eq('aktiv', true).neq('funktion', FUNKTION_BUERO).order('name'),
    ]);
    if (!aktuell()) return;
    // Ohne Migration 0049 kennt die Datenbank die Einsatzfelder nicht — dann wie bisher, ohne die Felder
    const ohneFelder = !!p0.error && felderFehlenIn(p0.error.message);
    const p = ohneFelder ? await plaeneLaden(PLAN_SPALTEN_ALT) : p0;
    if (!aktuell()) return;
    setFelderFehlen(ohneFelder);
    const err = t.error ?? b.error ?? p.error;
    if (err && still) { setFehler('Planung konnte nicht neu geladen werden: ' + err.message); return; }
    // Neu mit 0036 bzw. nur für vergangene Tage — fehlt etwas, bleibt die Planung trotzdem bedienbar.
    // «Geplant am Montag» (planAm) geht vom heutigen Stand rückwärts bis Montag 06:00 und braucht dafür JEDE Änderung an
    // Einsätzen seit diesem Zeitpunkt — und nur diese. Vorher: ab zwei Wochen davor, aufsteigend, höchstens 4000 Zeilen;
    // die API brach nach 1000 ab, und es fehlten genau die neuesten Änderungen.
    const montagFrueh = ausIso(startIso);
    montagFrueh.setHours(6, 0, 0, 0);
    const mitVergangenem = startIso <= heuteIso;
    const [v, a, i, vl, fm] = await Promise.all([
      alleOderFehler<Versetzung>((von, bis) => c.from('einsatz_person').select('datum,mitarbeiter_id,team_id').gte('datum', startIso).lte('datum', endeIso).order('id').range(von, bis)),
      alleOderFehler<Abw>((von, bis) => c.from('abwesenheit').select('datum,mitarbeiter_id,art').gte('datum', startIso).lte('datum', endeIso).order('id').range(von, bis)),
      mitVergangenem
        ? alleOderFehler<IstZeile>((von, bis) => c.from('tagesmeldung').select('team_id,datum,baustelle:baustelle_id(id,konto_nr,bezeichnung),zeiteintrag(mitarbeiter_id)').gte('datum', startIso).lte('datum', istBis).order('id').range(von, bis))
        : Promise.resolve({ data: [] as IstZeile[], error: null }),
      mitVergangenem
        ? alleOderFehler<VerlaufZeile>((von, bis) => c.from('plan_verlauf').select('tabelle,datensatz_id,aktion,vorher,nachher,zeit').eq('tabelle', 'jahresplan').gte('zeit', montagFrueh.toISOString()).order('zeit').order('id').range(von, bis))
        : Promise.resolve({ data: [] as VerlaufZeile[], error: null }),
      // Fehlmeldungen der Teams (0053) — ohne die Migration: keine
      alleOderFehler<FehltGemeldet>((von, bis) => c.from('fehlmeldung').select('id,datum,mitarbeiter_id,team_id').eq('status', 'offen').gte('datum', startIso).lte('datum', endeIso).order('id').range(von, bis)),
    ]);
    if (!aktuell()) return;
    const verlaufNeu = vl.error ? [] : (vl.data ?? []);
    // Baustellen, die nur im Verlauf vorkommen (inzwischen abgeschlossen) — in Stücken, die Liste der ids kann lang werden
    const bekannt = new Set([...(b.data ?? []).map((x) => x.id), ...(p.data ?? []).map((x) => x.baustelle?.id)]);
    const fehlend = [...new Set(verlaufNeu.flatMap((x) => [x.vorher?.baustelle_id, x.nachher?.baustelle_id]).filter((x): x is string => typeof x === 'string' && !bekannt.has(x)))];
    const zusatz = await Promise.all(stuecke(fehlend).map((ids) => c.from('baustelle').select('id,konto_nr,bezeichnung,status').in('id', ids)));
    if (!aktuell()) return;
    // Was fehlt, sagen — sonst zeigt die Tageszeile Abwesende als da oder «Geplant am Montag» den heutigen Plan
    const neben = [
      m.error && `feste Teams (${m.error.message})`,
      ma.error && `Mitarbeitende (${ma.error.message})`,
      a.error && `Abwesenheiten (${a.error.message})`,
      i.error && `Meldungen (${i.error.message})`,
      vl.error && `Verlauf (${vl.error.message})`,
      ...zusatz.filter((r) => r.error).slice(0, 1).map((r) => `Baustellen aus dem Verlauf (${r.error!.message})`),
    ].filter(Boolean);
    setFehler(err ? 'Planung konnte nicht geladen werden: ' + err.message : neben.length > 0 ? `Nicht geladen: ${neben.join(' · ')} — die Ansicht ist unvollständig.` : null);
    const neu: PlanDaten = {
      teams: ((t.data ?? []) as unknown as Team[]).sort((x, y) => x.bezeichnung.localeCompare(y.bezeichnung, 'de', { numeric: true })),
      baustellen: b.data ?? [],
      plaene: p.data ?? [],
      mitglieder: (m.data ?? []) as unknown as Mitglied[],
      personen: (ma.data ?? []) as Person[],
      einsatzFehlt: !!v.error,
      versetzungen: v.error ? [] : (v.data ?? []),
      abwesend: a.error ? [] : (a.data ?? []),
      fehltOffen: fm.error ? [] : (fm.data ?? []),
      ist: i.error ? [] : (i.data ?? []),
      verlauf: verlaufNeu,
      zusatzBaustellen: zusatz.flatMap((r) => (r.data ?? []) as Baustelle[]),
    };
    if (!err) merken(schluessel, neu);
    anwenden(neu);
  }, [startIso, endeIso, heuteIso, anfrage, anwenden]);
  useEffect(() => { void laden(); }, [laden]);
  // Mehrere Leute planen gleichzeitig — wieder sichtbar oder alle 5 Minuten still neu laden
  useAuffrischen(() => laden(true));

  useEffect(() => {
    if (!rueckmeldung) return;
    const t = setTimeout(() => setRueckmeldung(null), 3500);
    return () => clearTimeout(t);
  }, [rueckmeldung]);

  // Feste Mitglieder je Team, Chefmonteur zuerst, dann alphabetisch
  const basis = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const team of teams) m.set(team.id, []);
    const sortiert = mitglieder.filter((x) => x.mitarbeiter?.aktiv).sort((a, b) => a.mitarbeiter!.name.localeCompare(b.mitarbeiter!.name, 'de'));
    for (const x of sortiert) if (m.has(x.team_id)) m.get(x.team_id)!.push(x.mitarbeiter!.id);
    for (const team of teams) {
      const ids = m.get(team.id)!;
      if (team.chefmonteur_id && ids.includes(team.chefmonteur_id)) m.set(team.id, [team.chefmonteur_id, ...ids.filter((id) => id !== team.chefmonteur_id)]);
    }
    return m;
  }, [teams, mitglieder]);

  const namen = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personen) m.set(p.id, p.name);
    for (const x of mitglieder) if (x.mitarbeiter) m.set(x.mitarbeiter.id, x.mitarbeiter.name);
    return m;
  }, [personen, mitglieder]);

  const besetzungen = useMemo(() => {
    const m = new Map<string, Map<string, TagesBesetzung>>();
    for (const d of tage) m.set(iso(d), besetzung(basis, versetzungen, iso(d)));
    return m;
  }, [tage, basis, versetzungen]);

  const abwJeTag = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const a of abwesend) {
      const t = m.get(a.datum) ?? new Map<string, string>();
      t.set(a.mitarbeiter_id, a.art);
      m.set(a.datum, t);
    }
    // «Fehlt» gemeldet zählt an dem Tag wie abwesend — eine eingetragene Abwesenheit geht vor
    for (const f of fehltOffen) {
      const t = m.get(f.datum) ?? new Map<string, string>();
      if (!t.has(f.mitarbeiter_id)) t.set(f.mitarbeiter_id, 'fehlt');
      m.set(f.datum, t);
    }
    return m;
  }, [abwesend, fehltOffen]);

  const istJe = useMemo(() => {
    const m = new Map<string, { baustellen: Map<string, { konto_nr: string; bezeichnung: string | null }>; personen: Set<string> }>();
    for (const z of ist) {
      if (!z.team_id || !z.baustelle) continue;
      const k = `${z.team_id}|${z.datum}`;
      const e = m.get(k) ?? { baustellen: new Map(), personen: new Set<string>() };
      e.baustellen.set(z.baustelle.id, { konto_nr: z.baustelle.konto_nr, bezeichnung: z.baustelle.bezeichnung });
      for (const x of z.zeiteintrag ?? []) e.personen.add(x.mitarbeiter_id);
      m.set(k, e);
    }
    return m;
  }, [ist]);

  const geplantAm = useCallback((teamId: string, datum: string) => plaene.filter((p) => p.team_id === teamId && p.von <= datum && p.bis >= datum), [plaene]);

  // Wochenstatus: läuft die Woche, ist der Plan ein Entwurf; ist sie vorbei, ist sie Archiv
  const status: 'entwurf' | 'archiv' | 'plan' = endeIso < heuteIso ? 'archiv' : startIso > heuteIso ? 'plan' : 'entwurf';
  const mitVergangenheit = startIso <= heuteIso;
  // Vergangene Woche öffnet auf «Tatsächlich», alle anderen auf dem aktuellen Plan
  useEffect(() => { setAnsicht(endeIso < heuteIso ? 'ist' : 'plan'); }, [startIso, endeIso, heuteIso]);
  /** «Plan vom Montag»: Stand am Montag der ersten Woche um 06:00 */
  const montagZeit = useMemo(() => new Date(start.getFullYear(), start.getMonth(), start.getDate(), 6, 0, 0).toISOString(), [start]);

  const baustelleVon = useCallback((id: string | null): Baustelle | null => {
    if (!id) return null;
    return baustellen.find((b) => b.id === id) ?? zusatzBaustellen.find((b) => b.id === id) ?? plaene.find((p) => p.baustelle?.id === id)?.baustelle
      ?? (() => { const z = ist.find((x) => x.baustelle?.id === id)?.baustelle; return z ? { ...z, status: null } : null; })();
  }, [baustellen, zusatzBaustellen, plaene, ist]);

  /** Der Plan, wie er am Montag früh stand (rückwärts aus dem Verlauf) — für die Ansicht und den Vergleich im Archiv */
  const montagPlaene: Plan[] = useMemo(() => (!mitVergangenheit ? [] : planAm(plaene.map((p) => ({ id: p.id, team_id: p.team_id, baustelle_id: p.baustelle?.id ?? null, von: p.von, bis: p.bis })), verlauf, montagZeit)
    .filter((p) => p.von <= endeIso && p.bis >= startIso)
    .map((p) => ({ id: p.id, team_id: p.team_id, von: p.von, bis: p.bis, baustelle: baustelleVon(p.baustelle_id) }))), [mitVergangenheit, plaene, verlauf, montagZeit, startIso, endeIso, baustelleVon]);

  /** Was das Raster zeigt: aktueller Plan, Plan vom Montag (aus dem Verlauf) oder was gemeldet wurde */
  const anzeigePlaene: Plan[] = useMemo(() => {
    if (ansicht === 'plan' || !mitVergangenheit) return plaene;
    if (ansicht === 'montag') return montagPlaene;
    return istBalken(ist.filter((z) => z.team_id && z.baustelle).map((z) => ({ team_id: z.team_id!, datum: z.datum, baustelle_id: z.baustelle!.id })))
      .map((p) => ({ id: p.id, team_id: p.team_id, von: p.von, bis: p.bis, baustelle: baustelleVon(p.baustelle_id) }));
  }, [ansicht, mitVergangenheit, plaene, montagPlaene, ist, baustelleVon]);
  const lesend = ansicht !== 'plan' && mitVergangenheit;
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.bezeichnung ?? 'anderes Team';

  /**
   * «Wirklich gewesen» auf einen Blick (11.10.2026): wo die Meldung vom Plan am Montag abweicht, steht unter dem Balken
   * gestrichelt «geplant: …» — der Vergleich ohne Umschalten. Gleicher Text an Folgetagen = ein Streifen.
   */
  const geisterJeTeam = useMemo(() => {
    const m = new Map<string, { ab: number; bis: number; text: string }[]>();
    if (!(lesend && ansicht === 'ist')) return m;
    const namenVon = (ids: string[]) => [...new Set(ids)].map((id) => baustelleVon(id)?.bezeichnung ?? 'Baustelle').join(' · ');
    for (const team of teams) {
      const texte = tage.map((d): string | null => {
        const dIso = iso(d);
        if (dIso > heuteIso) return null;
        const geplant = montagPlaene.filter((p) => p.team_id === team.id && p.von <= dIso && p.bis >= dIso).map((p) => p.baustelle?.id ?? '');
        const gemeldet = [...(istJe.get(`${team.id}|${dIso}`)?.baustellen.keys() ?? [])];
        if (gemeldet.length === 0) return geplant.length > 0 && dIso < heuteIso && !istFrei(d) ? `geplant: ${namenVon(geplant)}` : null;
        // Am Montag früh noch nicht geplant (21.11.2026, Amir: «warum steht hier nicht geplant?») — wurde der Einsatz
        // später in der Woche eingeplant, steht das so da, statt nach einem vergessenen Plan auszusehen
        if (geplant.length === 0) {
          const spaeter = plaene.some((p) => p.team_id === team.id && p.von <= dIso && p.bis >= dIso && gemeldet.includes(p.baustelle?.id ?? ''));
          return spaeter ? 'erst nach Mo früh eingeplant' : 'ohne Plan';
        }
        return gemeldet.every((b) => geplant.includes(b)) ? null : `geplant: ${namenVon(geplant)}`;
      });
      const streifen: { ab: number; bis: number; text: string }[] = [];
      texte.forEach((t, i) => {
        if (!t) return;
        const l = streifen[streifen.length - 1];
        if (l && l.text === t && l.bis === i - 1) l.bis = i; else streifen.push({ ab: i, bis: i, text: t });
      });
      if (streifen.length) m.set(team.id, streifen);
    }
    return m;
  }, [lesend, ansicht, teams, tage, heuteIso, montagPlaene, istJe, baustelleVon, plaene]);

  // Erste Schritte (wegklickbar, einmal je Gerät)
  const [hilfeOffen, setHilfeOffen] = useState(() => { try { return localStorage.getItem('planung-hilfe-v1') !== 'weg'; } catch { return true; } });
  function hilfeWeg() { setHilfeOffen(false); try { localStorage.setItem('planung-hilfe-v1', 'weg'); } catch { /* egal */ } }

  // Halbtage nur im Plan — «Wirklich gewesen» kennt keine Uhrzeiten
  const halb = halbtage && ansicht !== 'ist';
  const proTeam = useMemo(() => {
    const m = new Map<string, ReturnType<typeof spuren<Plan>>>();
    for (const team of teams) {
      const eigene = anzeigePlaene.filter((p) => p.team_id === team.id);
      m.set(team.id, halb ? halbtagSpuren(eigene, startIso, anzahlTage) : spuren(eigene, startIso, anzahlTage));
    }
    return m;
  }, [teams, anzeigePlaene, startIso, anzahlTage, halb]);


  const ohneEinsatz = teams.filter((t) => (proTeam.get(t.id) ?? []).length === 0);

  // Konfliktliste (24.10.2026): ab heute, in der angezeigten Woche — vergangene Tage sind nicht mehr zu lösen.
  // «Team ohne Baustelle» nur heute und am nächsten Arbeitstag, sonst stünde jede noch offene Woche voll.
  const naechsteTage = useMemo(() => heuteUndNaechster(ausIso(heuteIso)), [heuteIso]);
  const konfliktListe = useMemo(() => (lesend ? [] : konflikte({
    tage: tage.map(iso).filter((t) => t >= heuteIso),
    teams,
    basis,
    versetzt: versetzungen,
    plaene: plaene.map((p) => ({ team_id: p.team_id, baustelle_id: p.baustelle?.id ?? null, von: p.von, bis: p.bis, soll_leute: null, beginn_min: p.beginn_min ?? null })),
    abwesend: abwJeTag,
    ohneEinsatzTage: naechsteTage,
    fehlt: fehltOffen,
  })), [lesend, tage, heuteIso, teams, basis, versetzungen, plaene, abwJeTag, naechsteTage, fehltOffen]);

  /** Ersatz für eine Fehlmeldung (0053): höchstens drei Vorschläge mit Grund, nur ab heute */
  const ersatzFuer = useCallback((teamId: string, datum: string) => {
    if (datum < heuteIso) return [];
    return ersatzVorschlaege({
      datum, fuerTeam: teamId, teams, basis, versetzt: versetzungen, personen,
      plaene: plaene.map((p) => ({ team_id: p.team_id, baustelle_id: p.baustelle?.id ?? null, von: p.von, bis: p.bis, soll_leute: null, beginn_min: p.beginn_min ?? null })),
      abwesend: abwJeTag.get(datum) ?? new Map(),
    }).map((k) => ({ ...k, name: namen.get(k.id) ?? 'Person', woher: k.team_id ? teams.find((t) => t.id === k.team_id)?.bezeichnung ?? 'Team' : 'ohne festes Team' }));
  }, [heuteIso, teams, basis, versetzungen, personen, plaene, abwJeTag, namen]);

  /**
   * Ist die Lücke der Fehlmeldung gefüllt? So viele Leute wie fest im Team (höchstens so viele wie nötig) — fehlten schon
   * vorher Leute, steht das als eigene Zeile «x von y» in der Liste. Gibt die Namen der Eingeteilten mit.
   */
  const vollstaendig = useCallback((teamId: string, datum: string) => {
    const abw = abwJeTag.get(datum) ?? new Map<string, string>();
    const b = besetzung(basis, versetzungen, datum).get(teamId);
    const da = (b?.ids ?? []).filter((id) => !abw.has(id)).length;
    const fest = (basis.get(teamId) ?? []).length;
    const noetig = fest;
    const ersatz = (b?.dazu ?? []).filter((id) => !abw.has(id)).map((id) => (namen.get(id) ?? 'Person').split(' ')[0]);
    return { voll: da >= noetig, ersatz };
  }, [abwJeTag, basis, versetzungen, namen]);

  /** Ersatz einteilen: die Person arbeitet an dem Tag im Team — beide Teams erfahren es (Posteingang, Nachricht) */
  async function ersatzEinteilen(personId: string, teamId: string, datum: string) {
    if (!supabase) return;
    const { error } = await supabase.from('einsatz_person').upsert({ datum, mitarbeiter_id: personId, team_id: teamId }, { onConflict: 'mitarbeiter_id,datum' });
    if (error) { setFehler('Ersatz nicht eingeteilt: ' + error.message); return; }
    setRueckmeldung(`${namen.get(personId) ?? 'Person'} ist ${tagKurz(ausIso(datum))} in ${teamName(teamId)}.`);
    void laden(true);
  }

  /** Fehlmeldung als Abwesenheit «krank» übernehmen (ganzer Tag) — die Datenbank setzt die Meldung dann auf erledigt */
  async function alsKrankEintragen(personId: string, datum: string) {
    if (!supabase) return;
    const { error } = await supabase.from('abwesenheit').upsert({ mitarbeiter_id: personId, datum, art: 'krank', minuten: einstellungen().normaltagMin }, { onConflict: 'mitarbeiter_id,datum' });
    if (error) { setFehler('Abwesenheit nicht eingetragen: ' + error.message); return; }
    setRueckmeldung(`${namen.get(personId) ?? 'Person'} ist ${tagKurz(ausIso(datum))} als krank eingetragen.`);
    void laden(true);
  }

  /** «Ist doch da»: Fehlmeldung verwerfen */
  async function dochDa(fehlmeldungId: string, personId: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc('fehlmeldung_erledigen', { p_id: fehlmeldungId, p_status: 'verworfen' });
    if (error) { setFehler('Nicht gespeichert: ' + error.message); return; }
    setRueckmeldung(`${namen.get(personId) ?? 'Person'} ist doch da.`);
    void laden(true);
  }
  const konfliktJe = useMemo(() => new Set(konfliktListe.map((k) => `${k.team_id}|${k.datum}`)), [konfliktListe]);
  const konfliktBloecke = useMemo(() => konflikteBuendeln(konfliktListe), [konfliktListe]);

  /** Aus der Konfliktliste: jemand ist abwesend, aber eingeteilt — Einteilung löschen, die Person ist wieder im festen Team. */
  async function einteilungLoeschen(mitarbeiterId: string, von: string, bis: string) {
    if (!supabase) return;
    const { error } = await supabase.from('einsatz_person').delete().eq('mitarbeiter_id', mitarbeiterId).gte('datum', von).lte('datum', bis);
    if (error) { setFehler('Einteilung nicht gelöscht: ' + error.message); return; }
    setRueckmeldung(`Einteilung von ${namen.get(mitarbeiterId) ?? 'Person'} ${von === bis ? `am ${tagKurz(ausIso(von))}` : `${tagKurz(ausIso(von))} – ${tagKurz(ausIso(bis))}`} gelöscht.`);
    void laden(true);
  }

  // Alle Tage gleich breit (11.10.2026, Mehmeti/Amir): vorher waren Sa/So halb so breit, im 2-Wochen-Kopf lag die
  // rote «Heute»-Pille dann über Samstag und Montag. Wochenende jetzt nur grau hinterlegt.
  // Eine Woche passt neben der Seitenleiste auf einen 14-Zoll-Bildschirm; zwei Wochen scrollen dort seitlich, die Teamspalte bleibt stehen
  const spaltenBreite = anzahlTage === 7 ? 118 : 90;
  const minBreite = `calc(var(--team) + ${anzahlTage * spaltenBreite}px)`;
  const zeilenRaster = 'var(--team) minmax(0,1fr)';
  const tagSpalten = `repeat(${anzahlTage}, minmax(0, 1fr))`;
  // Zeilen der Teams: in der Halbtage-Ansicht zwei Spalten je Tag; `tagSpalte` setzt einen Tag (oder mehrere) in beide Raster
  const zeilenSpalten = halb ? `repeat(${anzahlTage * 2}, minmax(0, 1fr))` : tagSpalten;
  const tagSpalte = (i: number, j = i) => (halb ? `${2 * i + 1} / ${2 * j + 3}` : `${i + 1} / ${j + 2}`);
  const titel = anzahlTage === 7
    ? `KW ${kw(start)} · ${kurz(start)} – ${kurz(addTage(start, 6))}`
    : `KW ${kw(start)}–${kw(addTage(start, 7))} · ${kurz(start)} – ${kurz(addTage(start, 13))}`;
  /** Hintergrund je Tag: markierter Tag blau, Wochenende grau, heute rötlich, Linie zwischen zwei Wochen */
  const tagHintergrund = (d: Date, i: number) =>
    (iso(d) === mark?.tag ? 'bg-steel-soft/60 ' : iso(d) === heuteIso ? 'bg-accent-soft/35 ' : istFrei(d) ? 'bg-ink/[0.025] ' : '') + (i === 7 ? 'border-l border-line-strong ' : i > 0 ? 'border-l border-line/60 ' : '');

  // Markierung: gilt nur für den Sprung — andere Woche oder anderer Tag geöffnet, dann ist sie weg (wie in der Wochenübersicht)
  useEffect(() => {
    if (mark && (mark.tag < startIso || mark.tag > endeIso)) markierungWeg();
  }, [startIso, endeIso]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mark && tagWahl && (tagWahl.datum !== mark.tag || (mark.teams.length > 0 && !mark.teams.includes(tagWahl.teamId)))) markierungWeg();
  }, [tagWahl]); // eslint-disable-line react-hooks/exhaustive-deps
  const markTeams = mark ? teams.filter((t) => mark.teams.includes(t.id)) : [];
  // Den markierten Tag des ersten Teams einmal ins Bild holen — am Handy auch seitlich, in die Mitte der Fläche rechts
  // der Teamspalte (die steht fest und würde den Tag sonst halb verdecken)
  const markZelle = useRef<HTMLButtonElement | null>(null);
  const markGescrollt = useRef(false);
  useEffect(() => {
    const z = markZelle.current;
    if (laedt || markGescrollt.current || !z) return;
    markGescrollt.current = true;
    const rahmen = z.closest<HTMLElement>('.overflow-x-auto');
    if (rahmen) {
      const team = rahmen.querySelector<HTMLElement>('.sticky')?.offsetWidth ?? 0;
      const r = z.getBoundingClientRect();
      const f = rahmen.getBoundingClientRect();
      rahmen.scrollLeft += r.left + r.width / 2 - (f.left + team + (f.width - team) / 2);
    }
    z.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [laedt]);

  const schliessen = useCallback(() => setEntwurf(null), []);
  const tagSchliessen = useCallback(() => setTagWahl(null), []);

  function neu(teamId: string, tag: Date) {
    const z = zeitraumVorschlag('tag', tag);
    setEntwurf({ teamId, baustelle: null, ...z, tag: iso(tag) });
  }

  const tagTeam = tagWahl ? teams.find((t) => t.id === tagWahl.teamId) ?? null : null;

  return (
    <Shell zurueck breit>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Planung &amp; Daten</p>
            <h1 className="font-display text-2xl font-semibold">Planung</h1>
            <p className="mt-1 text-sm text-ink3">Welches Team wann auf welcher Baustelle ist — und wer an welchem Tag in welchem Team arbeitet.</p>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setTeamNeu(true)} className="btn-ghost py-2.5">
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Team
            </button>
            <button
              type="button"
              onClick={() => neu(teams[0]?.id ?? '', new Date(Math.max(Date.now(), start.getTime())))}
              disabled={teams.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7),inset_0_1px_0_rgb(255_255_255/0.3)] transition hover:-translate-y-px disabled:opacity-60"
            >
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" /> Einsatz planen
            </button>
          </span>
        </header>

        {hilfeOffen && (
          <section className="card flex flex-wrap items-start gap-x-6 gap-y-3 border-steel/15 bg-gradient-to-br from-white to-[#eef4fc] py-4">
            {[
              { icon: CalendarPlus, titel: 'Freies Feld antippen', text: 'Einsatz planen: Team, Baustelle, wie lange.' },
              { icon: MousePointerClick, titel: 'Tag antippen', text: 'Leute versetzen, dazunehmen, Baustelle nur für diesen Tag ändern.' },
              { icon: Archive, titel: 'Vergangene Woche', text: 'Zeigt, wo die Teams wirklich waren — und was anders geplant war.' },
            ].map((s, i) => (
              <div key={s.titel} className="flex min-w-[14rem] flex-1 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-steel text-white shadow-[0_4px_10px_-4px_rgb(43_108_176/0.6)]"><s.icon size={17} strokeWidth={2.2} aria-hidden="true" /></span>
                <span><span className="block text-sm font-semibold text-ink">{i + 1}. {s.titel}</span><span className="block text-xs text-ink3">{s.text}</span></span>
              </div>
            ))}
            <button type="button" onClick={hilfeWeg} className="btn-ghost shrink-0 self-center py-1.5 text-xs">Verstanden</button>
          </section>
        )}

        {/* Eine Leiste statt drei Bausteine (Konzept «Kopfzeile», 21.11.2026, Amir: «nicht einheitlich»): oben Woche und
            Zeitraum, unten Ansicht und Stand — alle Knöpfe als gleiche Schiene, «Heute» als rotes Wort ohne Rahmen */}
        <section className="card divide-y divide-line p-0">
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2.5">
            <div className="flex schiene items-center" role="group" aria-label="Woche">
              <button type="button" aria-label="Woche zurück" onClick={() => setStart(addTage(start, -7))} className="grid h-8 w-8 place-items-center"><ChevronLeft size={16} aria-hidden="true" /></button>
              <span className="whitespace-nowrap px-2 text-[13.5px] font-bold tabular-nums text-ink">
                {titel.split(' · ')[0]}<span className="ml-1.5 font-semibold text-ink3">{titel.split(' · ')[1]}</span>
              </span>
              <button type="button" aria-label="Woche vor" onClick={() => setStart(addTage(start, 7))} className="grid h-8 w-8 place-items-center"><ChevronRight size={16} aria-hidden="true" /></button>
              <span className="mx-1 h-4 w-px bg-ink/15" aria-hidden="true" />
              <button type="button" onClick={() => setStart(montag(new Date()))} disabled={iso(start) === iso(montag(new Date()))}
                className="h-8 px-3 text-xs font-semibold text-accent-deep! transition disabled:text-ink3! disabled:opacity-60">Heute</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex schiene" role="group" aria-label="Zeitraum">
                {([7, 14] as const).map((n) => (
                  <button key={n} type="button" onClick={() => setAnzahlTage(n)} aria-pressed={anzahlTage === n}
                    className={'h-8 px-3.5 text-xs font-semibold transition ' + (anzahlTage === n ? 'schiene-an' : '')}>
                    {n === 7 ? '1 Woche' : '2 Wochen'}
                  </button>
                ))}
              </div>
              {/* Halbtage (Konzept B, 21.11.2026) — am Handy steht die Agenda, dort braucht es den Schalter nicht */}
              <div className="flex schiene max-[699px]:hidden" role="group" aria-label="Tage">
                {([false, true] as const).map((h) => (
                  <button key={String(h)} type="button" onClick={() => setHalbtage(h)} aria-pressed={halbtage === h} disabled={ansicht === 'ist'}
                    title={ansicht === 'ist' ? 'Bei «Wirklich gewesen» gibt es keine Uhrzeiten' : undefined}
                    className={'h-8 px-3.5 text-xs font-semibold transition disabled:opacity-50 ' + (halbtage === h ? 'schiene-an' : '')}>
                    {h ? 'Halbtage' : 'Ganze Tage'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {(mitVergangenheit || (!laedt && teams.length > 0 && !lesend)) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              {mitVergangenheit && (
                <>
                  <span className="pl-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3">Ansicht</span>
                  <div className="flex max-w-full overflow-x-auto schiene" role="group" aria-label="Ansicht">
                    {([
                      { wert: 'plan', text: 'Aktueller Plan' },
                      { wert: 'montag', text: `Geplant am Mo ${kurz(start)}` },
                      { wert: 'ist', text: 'Wirklich gewesen' },
                    ] as const).map((o) => (
                      <button key={o.wert} type="button" aria-pressed={ansicht === o.wert} onClick={() => setAnsicht(o.wert)}
                        className={'h-8 whitespace-nowrap px-3.5 text-xs font-semibold transition ' + (ansicht === o.wert ? 'schiene-an' : '')}>
                        {o.text}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-ink3">
                    {ansicht === 'plan' && (status === 'entwurf' ? 'Jederzeit änderbar, bis die Woche vorbei ist.' : 'Der Plan, wie er jetzt steht — mit allen Änderungen.')}
                    {ansicht === 'montag' && `So war ${anzahlTage === 7 ? 'die Woche' : 'es'} am Montag ${kurz(start)} früh geplant — vor allen Änderungen.`}
                    {ansicht === 'ist' && 'Wo die Teams laut Meldungen waren. Gestrichelt darunter: was am Montag anders geplant war.'}
                  </span>
                </>
              )}
              {!laedt && teams.length > 0 && !lesend && (
                <span className="ml-auto flex flex-wrap items-center gap-2 text-[13px] text-ink2">
                  <span><b className="text-ink">{teams.length - ohneEinsatz.length} von {teams.length}</b> Teams eingeplant</span>
                  {ohneEinsatz.map((t) => (
                    <button key={t.id} type="button" onClick={() => neu(t.id, new Date(Math.max(Date.now(), start.getTime())))}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent-deep transition hover:bg-accent-soft/70">
                      <Plus size={12} strokeWidth={2.6} aria-hidden="true" />{t.bezeichnung}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
        </section>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">{fehler}</p>}
        {rueckmeldung && <p className="rounded-[12px] border border-good/30 bg-good-soft px-4 py-2.5 text-sm font-medium text-good-deep" role="status">{rueckmeldung}</p>}

        {/* «alles besetzt» nur, wenn ab heute überhaupt etwas geplant ist — eine leere Woche ist nicht «besetzt» */}
        {!laedt && !lesend && teams.length > 0 && endeIso >= heuteIso && (konfliktBloecke.length > 0 || plaene.some((p) => p.bis >= heuteIso)) && (
          <ZuLoesen
            liste={konfliktBloecke}
            heuteIso={heuteIso}
            naechster={naechsteTage[1]}
            teamName={teamName}
            name={(id) => namen.get(id) ?? 'Person'}
            baustelle={(id) => baustelleVon(id)?.bezeichnung || 'Baustelle'}
            artAm={(datum, id) => abwJeTag.get(datum)?.get(id) ?? null}
            chefVon={(teamId) => teams.find((t) => t.id === teamId)?.chefmonteur_id ?? null}
            onTag={(teamId, datum, dazu) => setTagWahl({ teamId, datum, dazu })}
            onEinsatz={(teamId, datum) => neu(teamId, ausIso(datum))}
            onKlaeren={(teamId, datum) => {
              // Der kürzere (meist später dazugekommene) Einsatz wird geöffnet — der Dialog zeigt dann die Abfrage
              const amTag = plaene.filter((p) => p.team_id === teamId && p.von <= datum && p.bis >= datum)
                .sort((a, b) => (Doppelt.arbeitstage(a.von, a.bis) - Doppelt.arbeitstage(b.von, b.bis)) || b.von.localeCompare(a.von));
              const p = amTag[0];
              if (p) setEntwurf({ id: p.id, teamId, baustelle: p.baustelle, von: p.von, bis: p.bis, tag: datum, ...felderVon(p) });
            }}
            onEinteilungLoeschen={(id, von, bis) => void einteilungLoeschen(id, von, bis)}
            ersatzFuer={ersatzFuer}
            vollstaendig={vollstaendig}
            onErsatz={(id, teamId, datum) => void ersatzEinteilen(id, teamId, datum)}
            onKrank={(id, datum) => void alsKrankEintragen(id, datum)}
            onDochDa={(fid, id) => void dochDa(fid, id)}
          />
        )}

        {mark && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-steel">
              <span className="h-2 w-2 rounded-full bg-steel" aria-hidden="true" />
              {WOCHENTAGE[(ausIso(mark.tag).getDay() + 6) % 7]} {kurz(ausIso(mark.tag))}{markTeams.length > 0 && ` · ${markTeams.map((t) => t.bezeichnung).join(', ')}`} markiert
            </span>
            <span className="text-ink3">von der Tageskarte — Tag antippen öffnet ihn</span>
            <button type="button" className="text-xs font-semibold text-ink3 underline underline-offset-2 hover:text-ink" onClick={markierungWeg}>Markierung aufheben</button>
          </p>
        )}

        {/* Am Handy (unter 700 px) die Agenda statt des Rasters (Konzept C, 21.11.2026) */}
        {!laedt && (
          <WochenAgenda
            tage={tage} teams={teams} plaene={anzeigePlaene} heuteIso={heuteIso} istFrei={istFrei}
            wetter={(dIso) => wetter.gebiet.get(dIso)}
            onTag={(teamId, datum) => setTagWahl({ teamId, datum })}
            onNeu={lesend ? undefined : (teamId, d) => neu(teamId, d)}
          />
        )}

        <section className="card overflow-hidden p-0 max-[699px]:hidden">
          <div className="overflow-x-auto">
            <div className={TEAM_SPALTE_KLASSE} style={{ minWidth: minBreite }}>
              {/* Kopf: Wochentag klein in Versalien, Datum darunter, heute als rote Pille, Wochenende grau */}
              <div className="grid border-b border-line" style={{ gridTemplateColumns: zeilenRaster }}>
                <span className="sticky left-0 z-20 flex items-end bg-white px-4 pb-3 pt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3 shadow-[1px_0_0_rgb(17_17_19/0.06)]">Team · Leute</span>
                <div className="grid" style={{ gridTemplateColumns: tagSpalten }}>
                  {tage.map((d, i) => {
                    const istHeute = iso(d) === heuteIso;
                    const markiert = iso(d) === mark?.tag;
                    const we = istFrei(d);
                    const fei = feiertag(iso(d));
                    return (
                      <span key={iso(d)} className={'flex flex-col items-center gap-1 pb-3 pt-4 ' + tagHintergrund(d, i)}>
                        <span className={'text-[10px] font-semibold uppercase tracking-[0.1em] ' + (markiert ? 'text-steel' : istHeute ? 'text-accent' : we ? 'text-ink3/60' : 'text-ink3')}>
                          {WOCHENTAGE[(d.getDay() + 6) % 7]}{anzahlTage === 14 && (d.getDay() === 1) && <span className="ml-1 font-medium normal-case tracking-normal text-ink3/70">KW {kw(d)}</span>}
                        </span>
                        {/* Markierter Tag als blaue Pille (wie in der Wochenübersicht); ist er heute, rot mit blauem Ring */}
                        <span className={'whitespace-nowrap rounded-full px-2.5 py-0.5 font-display text-[13px] font-semibold tabular-nums leading-tight ' + (markiert ? (istHeute ? 'bg-accent text-white ring-2 ring-steel ring-offset-2' : 'bg-steel text-white shadow-[0_4px_10px_-4px_rgb(43_108_176/0.6)]') : istHeute ? 'bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]' : we ? 'text-ink3/70' : 'text-ink')}>{kurz(d)}</span>
                        {fei && <span className="max-w-full truncate px-1 text-[10px] font-medium text-ink3" title={`Feiertag: ${fei}`}>{fei}</span>}
                        {wetter.gebiet.get(iso(d)) && <WetterKopf w={wetter.gebiet.get(iso(d))!} />}
                        {halb && <span className="mt-auto grid w-full grid-cols-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink3/70"><span>VM</span><span>NM</span></span>}
                      </span>
                    );
                  })}
                </div>
              </div>

              {laedt && <p className="px-4 py-6 text-sm text-ink3">Lädt …</p>}

              {!laedt && teams.map((team) => {
                const balken = proTeam.get(team.id) ?? [];
                const anzSpuren = Math.max(1, ...balken.map((b) => b.spur + 1));
                // Freie Felder je Spur und Tag — das «+» erscheint nur dort, nie unter einem Balken
                const belegt = (spur: number, tag: number) => balken.some((b) => b.spur === spur && (halb ? b.ab <= 2 * tag + 1 && b.bis >= 2 * tag : b.ab <= tag && b.bis >= tag));
                const freieFelder = lesend ? [] : Array.from({ length: anzSpuren }, (_, spur) => tage.map((d, i) => ({ d, i, spur }))).flat().filter((x) => !belegt(x.spur, x.i));
                const fest = basis.get(team.id) ?? [];
                const geister = geisterJeTeam.get(team.id) ?? [];
                const zeileTag = anzSpuren + (geister.length ? 2 : 1);
                const teamMarkiert = !!mark && mark.teams.includes(team.id);
                return (
                  <div key={team.id} className={'grid border-b border-line last:border-b-0 ' + (teamMarkiert ? 'bg-[#f8fbfe]' : '')} style={{ gridTemplateColumns: zeilenRaster }}>
                    {/* Team mit seinen Leuten (Mehmeti: «die 3 Namen sehen») — bleibt beim seitlichen Scrollen stehen; markiert mit blauem Strich links */}
                    <div className={'sticky left-0 z-20 flex min-w-0 flex-col justify-center gap-1 px-4 py-2.5 ' + (teamMarkiert ? 'bg-[#f8fbfe] shadow-[inset_3px_0_0_var(--color-steel),1px_0_0_rgb(17_17_19/0.06)]' : 'bg-white shadow-[1px_0_0_rgb(17_17_19/0.06)]')}>
                      <span className="flex items-center gap-2">
                        <span className={'truncate font-display text-[14px] font-semibold ' + (teamMarkiert ? 'text-steel' : 'text-ink')}>{team.bezeichnung}</span>
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold tabular-nums text-ink3"><Users size={10} aria-hidden="true" />{fest.length}</span>
                      </span>
                      {fest.length > 0 ? (
                        <span className="line-clamp-2 text-[11.5px] leading-snug text-ink3">
                          {fest.map((id, i) => (
                            <span key={id}>{i > 0 && ' · '}<span className={id === team.chefmonteur_id ? 'font-semibold text-ink2' : ''}>{kurzName(namen.get(id) ?? '')}</span></span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink3">noch niemand fest — Tag antippen und Leute einteilen</span>
                      )}
                    </div>
                    <div className="grid" style={{ gridTemplateColumns: zeilenSpalten, gridTemplateRows: `repeat(${anzSpuren}, ${SPUR_HOEHE}px)${geister.length ? ' 22px' : ''} auto`, rowGap: 6, paddingTop: 8, paddingBottom: 6 }}>
                      {/* Hintergrund je Tag (Wochenende, heute, Wochenlinie) über alle Spuren */}
                      {tage.map((d, i) => <span key={'h' + iso(d)} aria-hidden="true" className={'-my-2 ' + tagHintergrund(d, i)} style={{ gridColumn: tagSpalte(i), gridRow: `1 / ${zeileTag + 1}` }} />)}
                      {/* Halbtage: gestrichelte Linie zwischen Vormittag und Nachmittag */}
                      {halb && tage.map((d, i) => <span key={'m' + iso(d)} aria-hidden="true" className="-my-2 border-l border-dashed border-line" style={{ gridColumn: 2 * i + 2, gridRow: `1 / ${zeileTag + 1}` }} />)}
                      {/* Archiv: was am Montag anders geplant war, gestrichelt unter dem Balken */}
                      {geister.map((g) => (
                        <span key={'g' + g.ab} title={g.text} style={{ gridColumn: tagSpalte(g.ab, g.bis), gridRow: anzSpuren + 1 }}
                          className="z-[1] mx-1 flex min-w-0 items-center rounded-[8px] border border-dashed border-amber/70 bg-amber-soft/50 px-2 text-[10.5px] font-medium text-amber-deep">
                          <span className="truncate">{g.text}</span>
                        </span>
                      ))}
                      {/* Freie Felder: antippen = an diesem Tag planen */}
                      {freieFelder.map(({ d, i, spur }) => (
                        <button
                          key={iso(d) + '-' + spur}
                          type="button"
                          onClick={() => neu(team.id, d)}
                          aria-label={`${team.bezeichnung} am ${lang(d)} planen`}
                          style={{ gridColumn: tagSpalte(i), gridRow: spur + 1 }}
                          className="group/tag z-[1] mx-1 grid place-items-center rounded-[10px] transition hover:bg-accent-soft/60"
                        >
                          <Plus size={15} className="text-accent opacity-0 transition group-hover/tag:opacity-100" aria-hidden="true" />
                        </button>
                      ))}
                      {balken.map(({ plan, spur, ab, bis, links, rechts }) => {
                        const f = farbeVon(plan.baustelle?.id ?? plan.id);
                        const name = plan.baustelle?.bezeichnung || 'Baustelle';
                        // Der Einsatz, von dem man kommt: blauer Rahmen
                        const balkenMarkiert = teamMarkiert && !!mark?.baustelle && plan.baustelle?.id === mark.baustelle && plan.von <= mark.tag && plan.bis >= mark.tag;
                        // Konzept A (21.11.2026): weisser Balken, Baustellenfarbe nur als Streifen links, Uhrzeit vorne.
                        // Schmal (ein Tag, in Halbtagen bis ein Tag) = Uhrzeit über dem Namen
                        const eng = halb ? bis - ab <= 1 : bis === ab;
                        const zeit = plan.beginn_min != null ? uhrzeit(plan.beginn_min) : null;
                        // Hinweis (21.11.2026): Beginn am Nachmittag, aber an diesen Tagen die einzige Baustelle — meist ein Überbleibsel
                        const allein = ansicht === 'ist' ? [] : spaeterBeginnAllein(plan, anzeigePlaene.filter((x) => x.team_id === team.id), startIso, anzahlTage);
                        const alleinText = allein.length ? `Beginn ${zeit}, aber ${allein.map((t) => tagKurz(ausIso(t))).join(', ')} die einzige Baustelle — stimmt die Zeit?` : null;
                        const tagIndex = (k: number) => (halb ? Math.floor((ab + k) / 2) : ab + k);
                        return (
                          <button
                            key={plan.id + '-' + ab}
                            type="button"
                            onClick={(e) => {
                              // Ein Klick pro Tag (11.10.2026): der angetippte Tag öffnet sich — dort auch «Ganzen Einsatz ändern»
                              const r = e.currentTarget.getBoundingClientRect();
                              const n = bis - ab + 1;
                              const k = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / n))));
                              setTagWahl({ teamId: team.id, datum: iso(addTage(start, tagIndex(k))) });
                            }}
                            title={[`${name} · ${plan.baustelle?.konto_nr ?? ''}${ansicht === 'ist' && lesend ? ' · gemeldet' : ''}`, felderText(plan), plan.hinweis && `«${plan.hinweis}»`, alleinText].filter(Boolean).join('\n')}
                            aria-label={`${team.bezeichnung}: ${zeit ? `ab ${zeit}, ` : ''}${name}, ${lang(ausIso(plan.von))} bis ${lang(ausIso(plan.bis))} — Tag öffnen`}
                            style={{ gridColumn: `${ab + 1} / ${bis + 2}`, gridRow: spur + 1 }}
                            className={
                              'relative z-10 mx-1 flex min-w-0 overflow-hidden border border-line bg-white pr-2 text-left text-ink shadow-[0_1px_2px_rgb(40_30_20/0.05)] transition hover:-translate-y-px hover:shadow-[0_1px_2px_rgb(40_30_20/0.05),0_10px_20px_-12px_rgb(40_30_20/0.35)] ' +
                              (eng ? 'flex-col justify-center gap-px pl-2.5 ' : 'items-center gap-2 pl-3 ') +
                              (links ? 'rounded-l-[4px]' : 'rounded-l-[10px]') + ' ' + (rechts ? 'rounded-r-[4px]' : 'rounded-r-[10px]') +
                              (balkenMarkiert ? ' outline-2 outline-offset-2 outline-steel' : '')
                            }
                          >
                            <span className={'absolute inset-y-0 left-0 w-[3px] ' + f.punkt} aria-hidden="true" />
                            {links && <span className="-ml-1 text-xs text-ink3" aria-hidden="true">‹</span>}
                            {eng ? (
                              <>
                                {zeit && <span className={'text-[11px] font-bold leading-none tabular-nums ' + (alleinText ? 'text-amber-deep' : 'text-ink')}>{zeit}{alleinText && ' ?'}</span>}
                                <span className={'min-w-0 font-semibold text-ink2 [overflow-wrap:anywhere] ' + (zeit ? 'truncate text-[11px] leading-tight' : 'line-clamp-2 text-[11px] leading-[1.15]')}>{name}</span>
                              </>
                            ) : (
                              <>
                                {zeit && <span className={'shrink-0 rounded-[6px] px-1.5 py-px text-[11px] font-bold tabular-nums ' + (alleinText ? 'bg-amber-soft text-amber-deep' : 'bg-surface-2 text-ink')}>{zeit}{alleinText && ' ?'}</span>}
                                <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink2">{name}</span>
                                {/* Hinweis fürs Team (0049): kleines Zeichen, der Text steht im Tooltip und im Tag */}
                                {plan.hinweis && <MessageSquareText size={12} className="shrink-0 text-ink3" aria-label="mit Hinweis" />}
                                {/* Kontonummer erst ab drei Tagen — bei kürzeren Balken ginge sonst der Name unter */}
                                {(halb ? bis - ab >= 5 : bis - ab >= 2) && <span className="ml-auto hidden shrink-0 font-mono text-[11px] text-ink3 lg:inline">{plan.baustelle?.konto_nr}</span>}
                              </>
                            )}
                            {rechts && <span className="-mr-1 ml-auto text-xs text-ink3" aria-hidden="true">›</span>}
                          </button>
                        );
                      })}
                      {/* Tageszeile in Worten (11.10.2026): Leute an dem Tag, «+ Marco» dazu, «− Luan» weg, «Pedro Ferien» — antippen = den Tag öffnen */}
                      {tage.map((d, i) => {
                        const dIso = iso(d);
                        const gemeldet = istJe.get(`${team.id}|${dIso}`);
                        const zelle = 'z-[1] mx-1 flex flex-wrap content-center items-center justify-center gap-1 rounded-[8px] border border-transparent px-1 py-1 text-[11px] font-medium tabular-nums transition hover:border-line-strong hover:bg-white';
                        if (lesend && ansicht === 'ist') {
                          const nichts = !gemeldet && geplantAm(team.id, dIso).length > 0 && dIso < heuteIso && !istFrei(d);
                          return (
                            <button key={'t' + dIso} type="button" onClick={() => setTagWahl({ teamId: team.id, datum: dIso })}
                              aria-label={`${team.bezeichnung} am ${lang(d)}: gemeldet`} style={{ gridColumn: tagSpalte(i), gridRow: zeileTag }} className={zelle}>
                              {gemeldet
                                ? <span className="inline-flex items-center gap-0.5 text-ink3" title={`${gemeldet.personen.size} gemeldet`}><Users size={11} aria-hidden="true" />{gemeldet.personen.size}</span>
                                : nichts ? <span className="text-[10.5px] text-ink3">nichts gemeldet</span> : <span className="text-ink3/40" aria-hidden="true">·</span>}
                            </button>
                          );
                        }
                        const bz = besetzungen.get(dIso)?.get(team.id) ?? { ids: [], dazu: [], weg: [] };
                        const abw = abwJeTag.get(dIso);
                        const abwIds = bz.ids.filter((id) => abw?.has(id));
                        const n = bz.ids.length - abwIds.length;
                        const vorname = (id: string) => (namen.get(id) ?? '').split(' ')[0];
                        const pillen = [
                          ...bz.dazu.map((id) => ({ text: `+ ${vorname(id)}`, klasse: 'bg-good-soft text-good-deep', titel: `${namen.get(id)} ist an diesem Tag hier eingeteilt` })),
                          ...bz.weg.map((w) => ({ text: `− ${vorname(w.id)}`, klasse: 'bg-amber-soft text-amber-deep', titel: `${namen.get(w.id)} ist an diesem Tag in ${teamName(w.nach)}` })),
                          ...abwIds.map((id) => ({ text: `${vorname(id)} ${artText(abw!.get(id)!)}`, klasse: 'bg-surface-2 text-ink3', titel: `${namen.get(id)}: ${artText(abw!.get(id)!)}` })),
                        ];
                        const max = anzahlTage === 7 ? 2 : 1;
                        const einsaetzeHier = geplantAm(team.id, dIso);
                        const geplantHier = einsaetzeHier.length > 0;
                        const zuLoesen = konfliktJe.has(`${team.id}|${dIso}`);
                        // Frei (Wochenende, Feiertag) ohne Plan und ohne Änderung: leer statt «3» — dort wird selten gearbeitet.
                        // Ein geplanter Tag ohne Leute zeigt dagegen «0» (steht auch in «Zu lösen»).
                        const leer = ((n === 0 && !geplantHier) || (istFrei(d) && !geplantHier)) && pillen.length === 0;
                        // Personenzahl nur, wenn sie vom Team abweicht (Konzept A, 21.11.2026) — sonst stand fünfmal «3» da
                        const zahlZeigen = n !== fest.length || n === 0;
                        const zelleMarkiert = teamMarkiert && dIso === mark?.tag;
                        // Wetter an den Baustellen des Teams (nur mit Ort — ohne Ort steht das Gebiet oben im Kopf)
                        const wetterHier = einsaetzeHier.map((p) => (p.baustelle ? wetter.ort.get(`${p.baustelle.id}|${dIso}`) : undefined)).filter((w): w is WetterTag => !!w);
                        const wetterWarn = warnungenZusammen(wetterHier);
                        return (
                          <button key={'t' + dIso} type="button" onClick={() => setTagWahl({ teamId: team.id, datum: dIso })}
                            ref={zelleMarkiert && team.id === markTeams[0]?.id ? markZelle : undefined}
                            aria-label={`${team.bezeichnung} am ${lang(d)}: ${n} ${n === 1 ? 'Person' : 'Leute'}, Leute und Baustelle${zuLoesen ? ' — zu lösen' : ''}${zelleMarkiert ? ' — markiert' : ''}`} style={{ gridColumn: tagSpalte(i), gridRow: zeileTag }}
                            className={zelle + (zelleMarkiert ? ' border-steel/60! bg-white ring-2 ring-steel/25' : '')}>
                            {leer ? null : (
                              <>
                                {zuLoesen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" title="zu lösen — siehe oben" aria-hidden="true" />}
                                <WetterWarnung liste={wetterWarn} ort={einsaetzeHier.map((p) => p.baustelle?.bezeichnung || 'Baustelle').join(', ')} />
                                {zahlZeigen && (
                                  <span className={'inline-flex items-center gap-0.5 ' + (n < fest.length ? 'font-semibold text-amber-deep' : 'text-ink3')} title={`${n} ${n === 1 ? 'Person' : 'Leute'} an diesem Tag (Team: ${fest.length})`}>
                                    <Users size={11} aria-hidden="true" /><span>{n}</span>
                                  </span>
                                )}
                                {pillen.slice(0, max).map((p) => <span key={p.text} title={p.titel} className={'whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold ' + p.klasse}>{p.text}</span>)}
                                {pillen.length > max && <span className="text-[10px] font-semibold text-ink3" title={pillen.slice(max).map((p) => p.titel).join(' · ')}>+{pillen.length - max}</span>}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink3">
          {lesend && ansicht === 'ist' ? (
            <>
              <span>Balken = wo das Team laut Meldung war</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-6 rounded-[4px] border border-dashed border-amber/70 bg-amber-soft/50" aria-hidden="true" /> am Montag anders geplant</span>
              <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" /> gemeldete Leute</span>
            </>
          ) : (
            <>
              <span>Tag antippen = Leute und Baustelle für diesen Tag</span>
              <span><b className="font-bold tabular-nums text-ink">7:00</b> Beginn</span>
              <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" /> Leute — nur wenn es nicht das ganze Team ist</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" /> zu lösen</span>
              <span><b className="rounded-full bg-good-soft px-1.5 text-good-deep">+ Name</b> für den Tag dazu</span>
              <span><b className="rounded-full bg-amber-soft px-1.5 text-amber-deep">− Name</b> in einem anderen Team</span>
              <span className="inline-flex items-center gap-1"><WetterWarnung liste={[{ art: 'regen', text: 'Regen', stark: false }]} ort="" /> Wetter an der Baustelle (Sturm, Wind, Regen, Schnee) · Quelle: MeteoSchweiz</span>
            </>
          )}
        </div>
      </div>

      {entwurf && (
        <EinsatzDialog
          entwurf={entwurf}
          teams={teams}
          baustellen={baustellen}
          plaene={plaene}
          felderFehlen={felderFehlen}
          onSchliessen={schliessen}
          onGespeichert={(text) => { setEntwurf(null); setRueckmeldung(text); void laden(true); }}
          onNeuLaden={() => void laden(true)}
        />
      )}

      {tagWahl && tagTeam && (
        <TagDialog
          team={tagTeam}
          datum={tagWahl.datum}
          teams={teams}
          personen={personen}
          namen={namen}
          basis={basis}
          besetzungen={besetzung(basis, versetzungen, tagWahl.datum)}
          abwesend={abwJeTag.get(tagWahl.datum) ?? new Map()}
          geplant={geplantAm(tagTeam.id, tagWahl.datum)}
          gemeldet={istJe.get(`${tagTeam.id}|${tagWahl.datum}`) ?? null}
          vergangen={tagWahl.datum <= heuteIso}
          baustellen={baustellen}
          einsatzFehlt={einsatzFehlt}
          dazuAuf={!!tagWahl.dazu}
          wetterVon={(bid) => {
            const w = wetter.ort.get(`${bid}|${tagWahl.datum}`);
            if (w) return { w, gebiet: false };
            const g = wetter.gebiet.get(tagWahl.datum);
            return g ? { w: g, gebiet: true } : null;
          }}
          onSchliessen={tagSchliessen}
          onEinsatz={(p) => { setTagWahl(null); setEntwurf({ id: p.id, teamId: tagTeam.id, baustelle: p.baustelle, von: p.von, bis: p.bis, tag: tagWahl.datum, ...felderVon(p) }); }}
          onNeuerEinsatz={() => { setTagWahl(null); neu(tagTeam.id, ausIso(tagWahl.datum)); }}
          onGeaendert={(text) => { setRueckmeldung(text); void laden(true); }}
          onNeuLaden={() => void laden(true)}
        />
      )}

      {teamNeu && (
        <TeamNeuDialog
          namen={teams.map((t) => t.bezeichnung)}
          onSchliessen={() => setTeamNeu(false)}
          onGespeichert={(text) => { setTeamNeu(false); setRueckmeldung(text); void laden(true); }}
        />
      )}
    </Shell>
  );
}

// ── Konfliktliste «Zu lösen» (24.10.2026) ─────────────────────────────────────────────────────

/**
 * Was ab heute in der angezeigten Woche zu lösen ist — je Zeile ein Satz in Worten und ein Knopf, der direkt zur Lösung
 * führt. Warnfarbe Bernstein, Rot nur für die Aktion (CLAUDE.md). Ohne Konflikte: ein ruhiges «alles besetzt».
 */
interface Ersatz { id: string; name: string; grund: 'frei' | 'ueberzaehlig'; woher: string }

function ZuLoesen({ liste, heuteIso, naechster, teamName, name, baustelle, artAm, chefVon, onTag, onEinsatz, onKlaeren, onEinteilungLoeschen, ersatzFuer, vollstaendig, onErsatz, onKrank, onDochDa }: {
  liste: KonfliktBlock[];
  heuteIso: string;
  naechster: string;
  teamName: (id: string | null) => string;
  name: (id: string) => string;
  baustelle: (id: string | null) => string;
  artAm: (datum: string, id: string) => string | null;
  chefVon: (teamId: string) => string | null;
  onTag: (teamId: string, datum: string, dazu?: boolean) => void;
  onEinsatz: (teamId: string, datum: string) => void;
  /** Zwei Baustellen am selben Tag: den später dazugekommenen Einsatz öffnen, der Dialog fragt dann nach */
  onKlaeren: (teamId: string, datum: string) => void;
  onEinteilungLoeschen: (mitarbeiterId: string, von: string, bis: string) => void;
  ersatzFuer: (teamId: string, datum: string) => Ersatz[];
  vollstaendig: (teamId: string, datum: string) => { voll: boolean; ersatz: string[] };
  onErsatz: (mitarbeiterId: string, teamId: string, datum: string) => void;
  onKrank: (mitarbeiterId: string, datum: string) => void;
  onDochDa: (fehlmeldungId: string, mitarbeiterId: string) => void;
}) {
  const [alle, setAlle] = useState(false);
  const ANZAHL = 5;
  if (liste.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-[14px] border border-good/25 bg-good-soft/60 px-4 py-2.5 text-sm text-good-deep" role="status">
        <CircleCheck size={16} aria-hidden="true" /> Ab heute alles besetzt — nichts zu lösen in dieser Ansicht.
      </p>
    );
  }
  const vorname = (id: string) => name(id).split(' ')[0];
  const zeile = (k: KonfliktBlock): { text: string; zusatz?: string; knoepfe: { text: string; aktion: () => void; haupt?: boolean; titel?: string }[] } => {
    const team = teamName(k.team_id);
    const tag = { text: 'Tag öffnen', aktion: () => onTag(k.team_id, k.datum) };
    const dazu = { text: 'Leute dazunehmen', aktion: () => onTag(k.team_id, k.datum, true), haupt: true };
    const einsatz = { text: 'Einsatz planen', aktion: () => onEinsatz(k.team_id, k.datum), haupt: true };
    switch (k.art) {
      case 'doppelt':
        return {
          text: `${team}: zwei Baustellen am selben Tag, ohne Reihenfolge — der Chefmonteur weiss nicht, wohin.`,
          knoepfe: [{ text: 'Klären', aktion: () => onKlaeren(k.team_id, k.datum), haupt: true }, tag],
        };
      case 'fehlt-gemeldet': {
        // Vom Team gemeldet (0053): zuerst Ersatz (ab heute), dann die Meldung erledigen — als Abwesenheit oder «doch da»
        const wer = k.mitarbeiter_id ?? '';
        const erledigen = [
          { text: 'Als krank eintragen', aktion: () => onKrank(wer, k.datum) },
          { text: 'Ist doch da', aktion: () => onDochDa(k.fehlmeldung_id ?? '', wer) },
        ];
        if (k.datum < heuteIso) return { text: `${team}: ${name(wer)} fehlte — vom Team gemeldet.`, knoepfe: erledigen };
        const stand = vollstaendig(k.team_id, k.datum);
        const schon = stand.ersatz.length ? ` Ersatz: ${stand.ersatz.join(', ')} ✓` : '';
        if (stand.voll) return { text: `${team}: ${name(wer)} fehlt — vom Team gemeldet.${schon}`, zusatz: 'Bleibt offen, bis die Abwesenheit eingetragen ist.', knoepfe: erledigen };
        const ersatz = ersatzFuer(k.team_id, k.datum);
        return {
          text: `${team}: ${name(wer)} fehlt — vom Team gemeldet.${schon}`,
          zusatz: ersatz.length
            ? 'Vorschlag: ' + ersatz.map((e) => `${e.name.split(' ')[0]} (${e.grund === 'frei' ? (e.woher === 'ohne festes Team' ? 'ohne festes Team' : `${e.woher} hat keine Baustelle`) : `${e.woher} hat eine Person zu viel`})`).join(' · ')
            : 'Niemand frei — jemanden aus einem anderen Team dazunehmen.',
          knoepfe: [
            ...ersatz.map((e, i) => ({ text: `${e.name.split(' ')[0]} dazu`, aktion: () => onErsatz(e.id, k.team_id, k.datum), haupt: i === 0, titel: `${e.name} für diesen Tag in ${team}` })),
            // Immer auch frei wählen (Amir 25.10.2026): öffnet den Tag mit der Auswahl aller Leute, nach Teams geordnet
            ersatz.length ? { text: 'Andere Person …', aktion: () => onTag(k.team_id, k.datum, true), titel: 'Jemand anderen für diesen Tag dazunehmen' } : dazu,
            ...erledigen,
          ],
        };
      }
      case 'ohne-leute':
        return { text: `${team} · ${baustelle(k.baustelle_id ?? null)}: niemand da${k.soll ? ` — ${k.soll} nötig` : ''}.`, knoepfe: [dazu] };
      case 'chef-fehlt': {
        const chef = k.mitarbeiter_id ?? chefVon(k.team_id) ?? '';
        const wo = k.nach_team ? `ist in ${teamName(k.nach_team)}` : `hat ${artText(artAm(k.datum, chef) ?? 'frei')}`;
        return { text: `${team}: Chefmonteur ${vorname(chef)} ${wo} — wer meldet den Tag?`, knoepfe: [{ ...tag, haupt: true }] };
      }
      case 'unter-soll':
        return { text: `${team} · ${baustelle(k.baustelle_id ?? null)}: ${k.ist} von ${k.soll} Leuten.`, knoepfe: [dazu] };
      case 'abwesend-eingeteilt':
        return {
          text: `${name(k.mitarbeiter_id ?? '')} ist eingetragen als «${artText(artAm(k.datum, k.mitarbeiter_id ?? '') ?? '')}» — aber in ${team} eingeteilt.`,
          knoepfe: [{ text: k.tage > 1 ? 'Einteilungen löschen' : 'Einteilung löschen', aktion: () => onEinteilungLoeschen(k.mitarbeiter_id ?? '', k.datum, k.bis), haupt: true }, tag],
        };
      case 'eingeteilt-ohne-einsatz':
        return { text: `${team}: ${k.ist} ${k.ist === 1 ? 'Person' : 'Leute'} eingeteilt, aber keine Baustelle geplant.`, knoepfe: [einsatz, tag] };
      case 'ohne-einsatz':
        return { text: `${team} hat ${k.datum === heuteIso ? 'heute' : 'am nächsten Arbeitstag'} keine Baustelle.`, knoepfe: [einsatz] };
    }
  };
  const sichtbar = alle ? liste : liste.slice(0, ANZAHL);
  return (
    <section className="card overflow-hidden border-amber/30 p-0" aria-label="Zu lösen">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/20 bg-gradient-to-br from-[#fffaf0] to-amber-soft/60 px-4 py-3">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-amber text-white shadow-[0_4px_10px_-4px_rgb(217_119_6/0.6)]"><TriangleAlert size={16} strokeWidth={2.3} aria-hidden="true" /></span>
          <span>
            <span className="block font-display text-[15px] font-semibold text-ink">Zu lösen · {liste.length}</span>
            <span className="block text-[11px] text-ink3">ab heute, in dieser Ansicht — der nächste Tag zuerst</span>
          </span>
        </span>
      </div>
      <ul className="divide-y divide-line">
        {sichtbar.map((k, i) => {
          const z = zeile(k);
          const d = ausIso(k.datum);
          // «morgen» nur, wenn es wirklich morgen ist — am Samstag ist der Montag «nächster Arbeitstag»
          const morgen = iso(addTage(ausIso(heuteIso), 1));
          const wann = k.datum === heuteIso ? 'heute' : k.datum === morgen ? 'morgen' : k.datum === naechster ? 'nächster Arbeitstag' : null;
          return (
            <li key={`${k.art}-${k.team_id}-${k.datum}-${k.mitarbeiter_id ?? ''}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <span className="w-[150px] shrink-0">
                <span className="block whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink">{k.tage > 1 ? `${tagKurz(d)} – ${tagKurz(ausIso(k.bis))}` : tagKurz(d)}</span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-deep">
                  {(k.tage > 1 ? [wann === 'heute' || wann === 'morgen' ? `ab ${wann}` : null, `${k.tage} Tage`] : [wann]).filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="min-w-[12rem] flex-1 text-sm text-ink2">{z.text}{z.zusatz && <span className="mt-0.5 block text-[11.5px] text-ink3">{z.zusatz}</span>}</span>
              <span className="flex shrink-0 flex-wrap gap-1.5">
                {z.knoepfe.map((b) => (
                  <button key={b.text} type="button" onClick={b.aktion} title={b.titel}
                    className={'rounded-full px-3 py-1.5 text-xs font-semibold transition ' + (b.haupt ? 'bg-accent text-white shadow-[0_6px_14px_-8px_rgb(224_48_30/0.7)] hover:-translate-y-px' : 'border border-ink/10 bg-white text-ink2 hover:text-ink')}>
                    {b.text}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {liste.length > ANZAHL && (
        <button type="button" onClick={() => setAlle((v) => !v)} className="w-full border-t border-line px-4 py-2 text-xs font-semibold text-steel hover:bg-ground">
          {alle ? 'Weniger zeigen' : `Alle ${liste.length} zeigen`}
        </button>
      )}
    </section>
  );
}

// ── Baustelle suchen (Einsatz-Dialog und «nur an diesem Tag») ───────────────────────────────

function BaustellenWahl({ baustellen, waehlen, autoFokus = false }: { baustellen: Baustelle[]; waehlen: (b: Baustelle) => void; autoFokus?: boolean }) {
  const [suche, setSuche] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFokus) setTimeout(() => ref.current?.focus(), 0); }, [autoFokus]);
  const q = suche.trim();
  const treffer = q ? baustellenSuchen(baustellen, q, 40) : baustellen.filter((b) => b.status === 'aktiv').slice(0, 40);
  return (
    <div className="overflow-hidden rounded-[14px] border border-line-strong">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
        <input ref={ref} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name oder Kontonummer …" className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {treffer.map((b) => (
          <button key={b.id} type="button" onClick={() => waehlen(b)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ground">
            <span className="knr">{b.konto_nr}</span>
            <span className="truncate text-ink2">{b.bezeichnung || 'Baustelle'}</span>
          </button>
        ))}
        {treffer.length === 0 && <p className="px-3 py-3 text-sm text-ink3">Nichts gefunden.</p>}
      </div>
    </div>
  );
}

// ── Dialog: ein Team an einem Tag (Leute versetzen, Baustelle nur heute ändern, Plan gegen Ist) ──

function TagDialog({
  team, datum, teams, personen, namen, basis, besetzungen, abwesend, geplant: geplantRoh, gemeldet, vergangen, baustellen, einsatzFehlt, dazuAuf = false, wetterVon,
  onSchliessen, onEinsatz, onNeuerEinsatz, onGeaendert, onNeuLaden,
}: {
  team: Team;
  datum: string;
  teams: Team[];
  personen: Person[];
  namen: Map<string, string>;
  basis: Map<string, string[]>;
  besetzungen: Map<string, TagesBesetzung>;
  abwesend: Map<string, string>;
  geplant: Plan[];
  gemeldet: { baustellen: Map<string, { konto_nr: string; bezeichnung: string | null }>; personen: Set<string> } | null;
  vergangen: boolean;
  baustellen: Baustelle[];
  einsatzFehlt: boolean;
  /** Gleich die Liste «Person dazunehmen» öffnen (Konfliktliste: zu wenig Leute) */
  dazuAuf?: boolean;
  /** Wetter (0054) an dieser Baustelle an diesem Tag, sonst im Gebiet der Firma; null = keins (Vergangenheit, kein Ort) */
  wetterVon?: (baustelleId: string) => { w: WetterTag; gebiet: boolean } | null;
  onSchliessen: () => void;
  onEinsatz: (p: Plan) => void;
  onNeuerEinsatz: () => void;
  onGeaendert: (text: string) => void;
  /** Nur neu laden (der Plan hat sich inzwischen geändert) — der Dialog bleibt offen */
  onNeuLaden: () => void;
}) {
  const d = ausIso(datum);
  // Nach Beginn sortiert (21.11.2026, Amir): was früher anfängt, steht oben — Einsätze ohne Zeit zuletzt
  const geplant = useMemo(() => [...geplantRoh].sort((a, b) => (a.beginn_min ?? 24 * 60) - (b.beginn_min ?? 24 * 60)), [geplantRoh]);
  const mitZeit = geplant.some((p) => p.beginn_min != null);
  const fr = freitagVon(datum);
  const mehrTage = fr > datum;
  const [bereich, setBereich] = useState<'tag' | 'woche'>('tag');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [andereBaustelle, setAndereBaustelle] = useState(false);
  const bz = besetzungen.get(team.id) ?? { ids: [], dazu: [], weg: [] };
  const teamName = (id: string) => teams.find((t) => t.id === id)?.bezeichnung ?? 'anderes Team';
  const stamm = useMemo(() => {
    const m = new Map<string, string>();
    for (const [t, ids] of basis) for (const id of ids) if (!m.has(id)) m.set(id, t);
    return m;
  }, [basis]);
  /** Wo jemand an diesem Tag ist (für «dazunehmen») */
  const woHeute = useMemo(() => {
    const m = new Map<string, string>();
    for (const [t, b] of besetzungen) for (const id of b.ids) m.set(id, t);
    return m;
  }, [besetzungen]);
  const tageFuer = () => (bereich === 'woche' && mehrTage ? werktage(datum, fr) : [datum]);
  const bereichText = bereich === 'woche' && mehrTage ? `${tagKurz(d)} bis Freitag` : tagKurz(d);
  const gemeldeteBaustellen = gemeldet ? [...gemeldet.baustellen.entries()] : [];
  const pi = vergangen ? planIst(geplant.map((p) => p.baustelle?.id ?? ''), gemeldeteBaustellen.map(([id]) => id)) : null;

  async function versetzen(personId: string, zielTeam: string) {
    if (!supabase || laeuft) return;
    setLaeuft(true);
    setFehler(null);
    const tage = tageFuer();
    // Zurück ins feste Team = Einteilung löschen; sonst für jeden Tag eintragen (ersetzt eine frühere Einteilung)
    const { error } = stamm.get(personId) === zielTeam
      ? await supabase.from('einsatz_person').delete().eq('mitarbeiter_id', personId).in('datum', tage)
      : await supabase.from('einsatz_person').upsert(tage.map((datum) => ({ datum, mitarbeiter_id: personId, team_id: zielTeam })), { onConflict: 'mitarbeiter_id,datum' });
    setLaeuft(false);
    if (error) { setFehler(/einsatz_person/.test(error.message) ? 'Die Datenbank kennt das noch nicht — Migration 0036 fehlt.' : error.message); return; }
    onGeaendert(`${namen.get(personId) ?? 'Person'} · ${bereichText}: ${teamName(zielTeam)}`);
  }

  async function nurDiesenTag(b: Baustelle) {
    if (!supabase || laeuft) return;
    const c = supabase;
    setLaeuft(true);
    setFehler(null);
    const { data: u } = await c.auth.getUser();
    const grund = `Nur ${tagKurz(d)}: ${b.konto_nr} ${b.bezeichnung ?? ''}`.trim();
    const log = (jahresplan_id: string, feld: string, alt: string, neu: string) =>
      c.from('planaenderung').insert({ jahresplan_id, feld, alt, neu, geaendert_von: u.user?.id ?? null, grund });
    /**
     * Nur ändern, was noch so dasteht, wie der Dialog es zeigt (13.10.2026): hat inzwischen jemand den Einsatz verschoben
     * oder gekürzt, entstünde sonst aus den alten Daten der alte Rest neu. Jede Änderung trägt darum die alten Werte als
     * Bedingung mit; trifft sie keine Zeile, wird neu geladen und gefragt.
     */
    const wieAngezeigt = (p: Plan): Record<string, string> => ({
      id: p.id, von: p.von, bis: p.bis,
      ...(p.team_id ? { team_id: p.team_id } : {}),
      ...(p.baustelle ? { baustelle_id: p.baustelle.id } : {}),
    });
    try {
      for (const p of geplant) {
        const { vorher, nachher } = ohneTag(p, datum);
        if (vorher) {
          const r = await c.from('jahresplan').update({ bis: vorher.bis }).match(wieAngezeigt(p)).select('id');
          if (r.error) throw r.error;
          if ((r.data ?? []).length === 0) throw new PlanGeaendert();
          await log(p.id, 'bis', p.bis, vorher.bis);
          if (nachher && p.baustelle) {
            // Der Rest nach dem Tag ist derselbe Einsatz: Leute nötig, Beginn, Treffpunkt und Hinweis gehen mit (0049)
            // Beginn am Nachmittag geht nicht mit (21.11.2026) — er galt meist nur wegen einer zweiten Baustelle
            const fRest = felderVon(p);
            if ('beginn_min' in fRest) fRest.beginn_min = beginnFuerRest(fRest.beginn_min) ?? null;
            const r2 = await c.from('jahresplan').insert({ team_id: team.id, baustelle_id: p.baustelle.id, von: nachher.von, bis: nachher.bis, ...fRest });
            if (r2.error) throw r2.error;
          }
        } else if (nachher) {
          const r = await c.from('jahresplan').update({ von: nachher.von }).match(wieAngezeigt(p)).select('id');
          if (r.error) throw r.error;
          if ((r.data ?? []).length === 0) throw new PlanGeaendert();
          await log(p.id, 'von', p.von, nachher.von);
        } else {
          // Nur dieser eine Tag war geplant: Einsatz wird durch den neuen ersetzt — erst prüfen, ob er noch so dasteht,
          // dann die Terminhistorie (Fremdschlüssel), dann der Einsatz selbst
          const da = await c.from('jahresplan').select('id').match(wieAngezeigt(p));
          if (da.error) throw da.error;
          if ((da.data ?? []).length === 0) throw new PlanGeaendert();
          await c.from('planaenderung').delete().eq('jahresplan_id', p.id);
          const r = await c.from('jahresplan').delete().match(wieAngezeigt(p)).select('id');
          if (r.error) throw r.error;
          if ((r.data ?? []).length === 0) throw new PlanGeaendert();
        }
      }
      const r = await c.from('jahresplan').insert({ team_id: team.id, baustelle_id: b.id, von: datum, bis: datum });
      if (r.error) throw r.error;
    } catch (e) {
      setLaeuft(false);
      if (e instanceof PlanGeaendert) {
        setAndereBaustelle(false);
        setFehler(`Der Plan von ${team.bezeichnung} wurde inzwischen geändert — oben steht jetzt der neue Stand. Bitte nochmals prüfen und dann wählen.`);
        onNeuLaden();
        return;
      }
      setFehler('Nicht gespeichert: ' + (e instanceof Error ? e.message : String((e as { message?: string }).message ?? e)));
      return;
    }
    setLaeuft(false);
    setAndereBaustelle(false);
    onGeaendert(`${team.bezeichnung} ist ${tagKurz(d)} auf ${b.bezeichnung ?? b.konto_nr}.`);
  }

  // Statt der Browser-Auswahllisten (11.10.2026, Amir: «mach das schöner»): Teams als Pillen unter der Person,
  // «Person dazunehmen» als Liste mit Suche, nach Team gruppiert
  const [offenFuer, setOffenFuer] = useState<string | null>(null);
  const [dazuOffen, setDazuOffen] = useState(dazuAuf && !vergangen && !einsatzFehlt);
  const [dazuSuche, setDazuSuche] = useState('');
  const anzahlHeute = (teamId: string) => besetzungen.get(teamId)?.ids.length ?? 0;
  const dazuWahl = personen.filter((p) => !bz.ids.includes(p.id));
  const dazuGruppen = useMemo(() => {
    const q = dazuSuche.trim().toLowerCase();
    const passend = dazuWahl.filter((p) => !q || p.name.toLowerCase().includes(q));
    const gruppen = teams.filter((t) => t.id !== team.id).map((t) => ({ id: t.id, name: t.bezeichnung, leute: passend.filter((p) => woHeute.get(p.id) === t.id) }));
    gruppen.push({ id: '', name: 'Ohne Team', leute: passend.filter((p) => !woHeute.get(p.id)) });
    return gruppen.filter((g) => g.leute.length > 0);
  }, [dazuWahl, dazuSuche, teams, team.id, woHeute]);

  return (
    <Dialog titel={`${team.bezeichnung} · ${tagKurz(d)}`} untertitel={vergangen ? 'Plan und Meldung' : 'Baustelle und Leute für diesen Tag'} icon={CalendarDays} onSchliessen={onSchliessen} breit>
      <div className="space-y-6">
        {/* Meldung als Schild oben statt eigener Block (Konzept 21.11.2026) */}
        {vergangen && (() => {
          const s = pi === 'wie-geplant' ? { t: 'Gemeldet · wie geplant', c: 'bg-good-soft text-good-deep', p: 'bg-good' }
            : pi === 'anders' ? { t: 'Andere Baustelle gemeldet', c: 'bg-amber-soft text-amber-deep', p: 'bg-amber' }
            : pi === 'ohne-plan' ? { t: 'Gemeldet · ohne Plan', c: 'bg-steel-soft text-steel', p: 'bg-steel' }
            : { t: 'Noch nichts gemeldet', c: 'bg-amber-soft text-amber-deep', p: 'bg-amber' };
          return <p className={'-mt-2 inline-flex items-center gap-2 rounded-full py-1 pl-2.5 pr-3 text-xs font-semibold ' + s.c}><span className={'h-1.5 w-1.5 rounded-full ' + s.p} aria-hidden="true" />{s.t}</p>;
        })()}
        {/* Baustelle */}
        <section className="space-y-2">
          <p className="lbl mb-0 flex items-center justify-between gap-2">
            <span>Baustellen</span>
            {geplant.length > 1 && <span className="font-medium normal-case tracking-normal">{geplant.length} Einsätze</span>}
          </p>
          {geplant.length === 0 && <p className="text-sm text-ink3">Für diesen Tag ist nichts geplant.</p>}
          {/* Als Tagesablauf (Konzept 21.11.2026): Uhrzeit links, Linie verbindet die Einsätze */}
          <div>
            {geplant.map((p, i) => (
              <div key={p.id} className={mitZeit ? 'grid grid-cols-[3.25rem_1rem_1fr]' : ''}>
                {mitZeit && (
                  <>
                    <span className="pt-3 text-[15px] font-bold tabular-nums tracking-[-0.01em] text-ink">{p.beginn_min != null ? uhrzeit(p.beginn_min) : '–'}</span>
                    <span className="relative" aria-hidden="true">
                      {geplant.length > 1 && <span className={'absolute left-[6px] w-0.5 bg-line ' + (i === 0 ? 'top-5 bottom-0' : i === geplant.length - 1 ? 'top-0 h-5' : 'inset-y-0')} />}
                      <span className="absolute left-[2px] top-[15px] h-2.5 w-2.5 rounded-full border-[2.5px] border-accent bg-white" />
                    </span>
                  </>
                )}
                <div className={'mb-2 flex items-center justify-between gap-3 rounded-[16px] border border-line bg-white py-2.5 pl-3.5 pr-2.5' + (mitZeit ? ' ml-1' : '')}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2"><span className="knr">{p.baustelle?.konto_nr}</span><span className="truncate text-sm font-semibold text-ink">{p.baustelle?.bezeichnung || 'Baustelle'}</span></span>
                    {/* «nur dieser Tag» weg (Konzept 21.11.2026) — nur noch mehrtägige Einsätze nennen ihren Zeitraum */}
                    {p.von !== p.bis && <span className="mt-0.5 block text-[11.5px] text-ink3">Einsatz {kurz(ausIso(p.von))} – {kurz(ausIso(p.bis))}</span>}
                    {p.treffpunkt && (
                      <span className="mt-1 flex items-center gap-1 text-[11.5px] text-ink2"><MapPin size={12} className="text-ink3" aria-hidden="true" />Treffpunkt {TREFFPUNKT_TEXT[p.treffpunkt]}</span>
                    )}
                    {p.hinweis && (
                      <span className="mt-1.5 flex items-start gap-1.5 rounded-[10px] bg-steel-soft/60 px-2.5 py-1.5 text-[12px] text-ink">
                        <MessageSquareText size={13} className="mt-px shrink-0 text-steel" aria-hidden="true" />{p.hinweis}
                      </span>
                    )}
                    {/* Wetter an der Baustelle (MeteoSchweiz) — ohne Ort das Gebiet der Firma */}
                    {p.baustelle && (() => { const x = wetterVon?.(p.baustelle.id); return x ? <WetterZeile w={x.w} gebiet={x.gebiet} /> : null; })()}
                    {/* Einzige Baustelle des Tages, aber Beginn am Nachmittag (21.11.2026) — meist vom Aufteilen übrig */}
                    {geplant.length === 1 && p.beginn_min != null && p.beginn_min >= 12 * 60 && (
                      <span className="mt-1.5 block rounded-[8px] bg-amber-soft px-2 py-1 text-[11.5px] font-medium text-amber-deep">
                        Beginn {uhrzeit(p.beginn_min)}, aber die einzige Baustelle an diesem Tag — stimmt die Zeit?
                      </span>
                    )}
                  </span>
                  {(() => { const t = p.von === p.bis ? 'Einsatz ändern' : 'Ganzen Einsatz ändern'; return (
                    <button type="button" onClick={() => onEinsatz(p)} title={t} aria-label={t}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink2 transition hover:text-ink">
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                  ); })()}
                </div>
              </div>
            ))}
          </div>
          {geplant.length === 0
            ? <div className="flex flex-wrap gap-2"><Pille plus onClick={onNeuerEinsatz}>Einsatz planen</Pille></div>
            : (
              <button type="button" aria-pressed={andereBaustelle} onClick={() => setAndereBaustelle((v) => !v)}
                className={'inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[13px] font-semibold text-ink2 transition hover:text-ink' + (mitZeit ? ' ml-[4.5rem]' : '')}>
                {andereBaustelle ? <X size={15} className="text-ink3" aria-hidden="true" /> : <Plus size={15} className="text-accent" aria-hidden="true" />}
                Andere Baustelle nur für {tagKurz(d)}
              </button>
            )}
          {andereBaustelle && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-ink3">Der Einsatz bleibt an den anderen Tagen, wie er ist — nur {tagKurz(d)} geht das Team auf die gewählte Baustelle (Notfall, kurzfristig).</p>
              <BaustellenWahl baustellen={baustellen} waehlen={(b) => void nurDiesenTag(b)} autoFokus />
            </div>
          )}
        </section>

        {/* Plan gegen Ist */}
        {vergangen && gemeldeteBaustellen.length > 0 && (
          <section className="space-y-2">
            <p className="lbl mb-0">Gemeldet</p>
            {(
              <>
                {gemeldeteBaustellen.map(([id, b]) => (
                  <p key={id} className="flex items-center gap-2 text-sm"><span className="knr">{b.konto_nr}</span><span className="text-ink2">{b.bezeichnung || 'Baustelle'}</span></p>
                ))}
                <p className="text-[11px] text-ink3">
                  {gemeldet!.personen.size} {gemeldet!.personen.size === 1 ? 'Person' : 'Leute'} gemeldet
                  {pi === 'anders' ? ' · andere Baustelle als geplant' : pi === 'wie-geplant' ? ' · wie geplant' : pi === 'ohne-plan' ? ' · ohne Plan' : ''}
                </p>
              </>
            )}
          </section>
        )}

        {/* Leute an diesem Tag */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="lbl mb-0">Leute · {bz.ids.length}</p>
            {mehrTage && (
              <span className="flex schiene text-[11px] font-semibold" role="group" aria-label="Gilt für">
                <button type="button" aria-pressed={bereich === 'tag'} onClick={() => setBereich('tag')} className={'rounded-full px-2.5 py-1 ' + (bereich === 'tag' ? 'schiene-an' : '')}>nur {tagKurz(d)}</button>
                <button type="button" aria-pressed={bereich === 'woche'} onClick={() => setBereich('woche')} className={'rounded-full px-2.5 py-1 ' + (bereich === 'woche' ? 'schiene-an' : '')}>bis Freitag</button>
              </span>
            )}
          </div>
          {einsatzFehlt && (
            <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-3.5 py-2 text-xs text-amber-deep">Die Datenbank kennt das Versetzen noch nicht (Migration 0036 fehlt) — die festen Teams gelten.</p>
          )}
          <ul className="divide-y divide-line rounded-[14px] border border-line">
            {bz.ids.map((id) => {
              const art = abwesend.get(id);
              const dazu = bz.dazu.includes(id);
              return (
                <li key={id}>
                  <div className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar name={namen.get(id) ?? '?'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{namen.get(id) ?? '—'}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink3">
                        {id === team.chefmonteur_id && <span>Chefmonteur</span>}
                        {dazu && <span className="font-semibold text-good-deep">eingeteilt{stamm.get(id) ? ` · sonst ${teamName(stamm.get(id)!)}` : ''}</span>}
                        {art && <ArtPille art={art} />}
                      </span>
                    </span>
                    {dazu && stamm.get(id) && (
                      <button type="button" disabled={laeuft} onClick={() => void versetzen(id, stamm.get(id)!)} title={`zurück zu ${teamName(stamm.get(id)!)}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs font-semibold text-steel hover:bg-steel-soft disabled:opacity-50">
                        <Undo2 size={13} aria-hidden="true" /> zurück
                      </button>
                    )}
                    <button type="button" disabled={laeuft || einsatzFehlt} aria-expanded={offenFuer === id} onClick={() => { setOffenFuer(offenFuer === id ? null : id); setDazuOffen(false); }}
                      className={'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ' + (offenFuer === id ? 'bg-ink text-white' : 'bg-surface-2 text-ink2 hover:text-ink')}>
                      <ArrowRightLeft size={13} aria-hidden="true" /> Versetzen
                    </button>
                  </div>
                  {offenFuer === id && (
                    <div className="border-t border-line bg-ground/70 px-3 pb-3 pt-2.5">
                      <p className="mb-2 text-[11px] text-ink3">{(namen.get(id) ?? '').split(' ')[0]} {bereich === 'woche' && mehrTage ? `${tagKurz(d)} bis Freitag` : `am ${tagKurz(d)}`} in:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {teams.filter((t) => t.id !== team.id).map((t) => (
                          <button key={t.id} type="button" disabled={laeuft} onClick={() => { setOffenFuer(null); void versetzen(id, t.id); }}
                            className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(17_17_19/0.06)] transition hover:border-accent/40 hover:text-accent-deep disabled:opacity-50">
                            {t.bezeichnung}
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-ink3"><Users size={10} aria-hidden="true" />{anzahlHeute(t.id)}</span>
                            {stamm.get(id) === t.id && <span className="rounded-full bg-good-soft px-1.5 text-[10px] font-semibold text-good-deep">festes Team</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {bz.weg.map((w) => (
              <li key={w.id} className="flex items-center gap-2.5 bg-ground/60 px-3 py-2">
                <span className="opacity-50"><Avatar name={namen.get(w.id) ?? '?'} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink3 line-through">{namen.get(w.id) ?? '—'}</span>
                  <span className="text-[11px] font-semibold text-amber-deep">an diesem Tag in {teamName(w.nach)}</span>
                </span>
                <button type="button" disabled={laeuft || einsatzFehlt} onClick={() => void versetzen(w.id, team.id)} className="shrink-0 text-xs font-semibold text-steel disabled:opacity-50">zurückholen</button>
              </li>
            ))}
            {bz.ids.length === 0 && bz.weg.length === 0 && <li className="px-3 py-3 text-sm text-ink3">Niemand eingeteilt.</li>}
            {/* «Person dazunehmen» als letzte Zeile der Liste statt eigener Kasten (Konzept 21.11.2026) */}
            {!dazuOffen && (
              <li>
                <button type="button" disabled={laeuft || einsatzFehlt || dazuWahl.length === 0} onClick={() => { setDazuOffen(true); setOffenFuer(null); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-accent-deep transition hover:bg-ground disabled:opacity-50">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Plus size={16} aria-hidden="true" /></span>
                  Person dazunehmen
                </button>
              </li>
            )}
          </ul>
          {dazuOffen && (
            <div className="overflow-hidden rounded-[14px] border border-line-strong bg-white">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
                <input autoFocus value={dazuSuche} onChange={(e) => setDazuSuche(e.target.value)} placeholder="Name suchen …" aria-label="Person suchen"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
                <button type="button" onClick={() => { setDazuOffen(false); setDazuSuche(''); }} aria-label="Schliessen" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={15} /></button>
              </div>
              <div className="max-h-64 overflow-y-auto pb-1">
                {dazuGruppen.map((g) => (
                  <div key={g.id || 'ohne'}>
                    <p className="sticky top-0 bg-white/95 px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3 backdrop-blur">{g.name}</p>
                    {g.leute.map((p) => (
                      <button key={p.id} type="button" disabled={laeuft} onClick={() => { setDazuOffen(false); setDazuSuche(''); void versetzen(p.id, team.id); }}
                        className="group/p flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-ground disabled:opacity-50">
                        <Avatar name={p.name} />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                        {abwesend.get(p.id) && <ArtPille art={abwesend.get(p.id)!} />}
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-accent transition group-hover/p:bg-accent-soft"><Plus size={15} aria-hidden="true" /></span>
                      </button>
                    ))}
                  </div>
                ))}
                {dazuGruppen.length === 0 && <p className="px-3 py-3 text-sm text-ink3">Niemand gefunden.</p>}
              </div>
            </div>
          )}
          <p className="flex items-start gap-1.5 text-[11.5px] text-ink3">
            <Info size={13} className="mt-px shrink-0" aria-hidden="true" />
            Gilt {bereich === 'woche' && mehrTage ? `${tagKurz(d)} bis Freitag (Werktage)` : `nur für ${tagKurz(d)}`} — das feste Team bleibt.
          </p>
          {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-sm text-accent-deep">{fehler}</p>}
        </section>
      </div>
    </Dialog>
  );
}

// ── Dialog: Zusatzteam anlegen ─────────────────────────────────────────────────────────────

function TeamNeuDialog({ namen, onSchliessen, onGespeichert }: { namen: string[]; onSchliessen: () => void; onGespeichert: (text: string) => void }) {
  const [name, setName] = useState(() => naechsterTeamName(namen));
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen() {
    if (!supabase || laeuft) return;
    const n = name.trim();
    if (!n) { setFehler('Name fehlt.'); return; }
    if (namen.some((x) => x.toLowerCase() === n.toLowerCase())) { setFehler(`«${n}» gibt es schon.`); return; }
    setLaeuft(true);
    setFehler(null);
    // Ein früher ausgeblendetes Team gleichen Namens wieder aufnehmen, statt ein zweites anzulegen
    const { data: alt } = await supabase.from('team').select('id').eq('bezeichnung', n).eq('aktiv', false).limit(1);
    const { error } = alt && alt.length > 0
      ? await supabase.from('team').update({ aktiv: true }).eq('id', alt[0].id)
      : await supabase.from('team').insert({ bezeichnung: n });
    setLaeuft(false);
    if (error) { setFehler(error.message); return; }
    onGespeichert(`${n} ist angelegt — Tageszeile antippen, um Leute einzuteilen, freien Tag antippen für die Baustelle.`);
  }

  return (
    <Dialog titel="Zusatzteam anlegen" untertitel="Für eine neue Baustelle — Leute aus anderen Teams einteilen" icon={Users} onSchliessen={onSchliessen}
      fuss={<><span /><span className="flex items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onSchliessen}>Abbrechen</button>
        <button type="button" disabled={laeuft} onClick={() => void anlegen()} className="cta px-5 py-2 text-sm disabled:opacity-50">{laeuft ? 'Legt an …' : 'Anlegen'}</button>
      </span></>}>
      <label className="block">
        <span className="lbl">Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void anlegen(); }} autoFocus />
      </label>
      <p className="mt-2 text-xs text-ink3">Das Team erscheint sofort in der Planung. Leute kommen über die Tageszeile dazu (nur für die Tage, an denen sie dort sind); fest zuteilen und Chefmonteur bestimmen geht unter Verwaltung → Teams.</p>
      {fehler && <p className="mt-3 rounded-[12px] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-sm text-accent-deep">{fehler}</p>}
    </Dialog>
  );
}

// ── Dialog: Einsatz planen / ändern ─────────────────────────────────────────────

interface Aenderung { feld: string; alt: string | null; neu: string | null; geaendert_am: string; grund: string | null }
const FELD_TEXT: Record<string, string> = { von: 'Beginn', bis: 'Ende', baustelle: 'Baustelle', team: 'Team', soll_leute: 'Leute nötig', beginn_min: 'Uhrzeit', treffpunkt: 'Treffpunkt', hinweis: 'Hinweis' };

function EinsatzDialog({
  entwurf, teams, baustellen, plaene, felderFehlen, onSchliessen, onGespeichert, onNeuLaden,
}: {
  entwurf: Entwurf;
  teams: Team[];
  baustellen: Baustelle[];
  plaene: Plan[];
  felderFehlen: boolean;
  onSchliessen: () => void;
  onGespeichert: (text: string) => void;
  onNeuLaden: () => void;
}) {
  const bestehend = !!entwurf.id;
  const [teamId, setTeamId] = useState(entwurf.teamId);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(entwurf.baustelle);
  const [von, setVon] = useState(entwurf.von);
  const [bis, setBis] = useState(entwurf.bis);
  const [grund, setGrund] = useState('');
  // Einsatzfelder (0049). «Leute nötig» gibt es seit 13.11.2026 nicht mehr (Amir: «lass das komplett weg»).
  const [beginn, setBeginn] = useState(uhrzeitFeld(entwurf.beginn_min ?? null));
  const [treffpunkt, setTreffpunkt] = useState<Treffpunkt | null>(entwurf.treffpunkt ?? null);
  const [hinweis, setHinweis] = useState(entwurf.hinweis ?? '');
  const firmenBeginn = arbeitstag().beginn;
  function teamWaehlen(id: string) {
    setTeamId(id);
  }
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [loeschenFragen, setLoeschenFragen] = useState(false);
  // Zwei Baustellen am selben Tag (16.11.2026): was mit der bisherigen passieren soll
  const [doppeltWahl, setDoppeltWahl] = useState<'schieben' | 'streichen' | 'zeiten'>('schieben');
  const [beginnAlt, setBeginnAlt] = useState('');
  const [verlauf, setVerlauf] = useState<Aenderung[]>([]);
  const tag = ausIso(entwurf.tag);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSchliessen(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onSchliessen]);

  // Verlauf (Terminhistorie): was an diesem Einsatz schon geändert wurde
  useEffect(() => {
    if (!supabase || !entwurf.id) return;
    void supabase.from('planaenderung').select('feld,alt,neu,geaendert_am,grund').eq('jahresplan_id', entwurf.id).order('geaendert_am', { ascending: false }).limit(10)
      .then(({ data }) => setVerlauf((data ?? []) as Aenderung[]));
  }, [entwurf.id]);

  const gueltig = !!teamId && !!baustelle && !!von && !!bis && bis >= von;
  const zeitraum: Zeitraum = { von, bis };
  const team = teams.find((t) => t.id === teamId);
  const andere = gueltig
    ? plaene.filter((p) => p.team_id === teamId && p.id !== entwurf.id && ueberschneiden(p, zeitraum))
    : [];
  // Vorschau, was sich an den bisherigen Einsätzen ändert (aus der geladenen Planung — gespeichert wird mit frischen Daten)
  const nameVon = (id: string) => plaene.find((p) => p.id === id)?.baustelle?.bezeichnung ?? 'Einsatz';
  const spanne = (a: string, b: string) => (a === b ? tagKurz(ausIso(a)) : `${tagKurz(ausIso(a))} – ${tagKurz(ausIso(b))}`);
  const teamPlaene = plaene.filter((p) => p.team_id === teamId && p.id !== entwurf.id).map((p) => ({ id: p.id, von: p.von, bis: p.bis, beginn_min: p.beginn_min ?? null }));
  const vorschau: string[] = andere.length === 0 ? [] : (doppeltWahl === 'schieben' ? Doppelt.verschieben(zeitraum, teamPlaene) : Doppelt.streichen(zeitraum, teamPlaene)).map((sch) =>
    sch.art === 'aendern' ? `${nameVon(sch.id)}: neu ${spanne(sch.von, sch.bis)}`
      : sch.art === 'neu' ? `${nameVon(sch.vorlage)}: zusätzlich ${spanne(sch.von, sch.bis)}`
        : `${nameVon(sch.id)}: entfällt`);

  const SCHNELL: { art: Schnellwahl; label: string }[] = [
    { art: 'tag', label: `Nur ${WOCHENTAGE[(tag.getDay() + 6) % 7]} ${kurz(tag)}` },
    { art: 'woche', label: 'Bis Freitag' },
    { art: 'zwei', label: '2 Wochen' },
    { art: 'vier', label: '4 Wochen' },
  ];

  /** Nur ändern, was noch so dasteht, wie der Dialog es zeigt (wie «nur an diesem Tag»): sonst überschriebe man still
   *  eine Änderung, die jemand anderes inzwischen gemacht hat. */
  const wieAngezeigt = (): Record<string, string> => ({
    id: entwurf.id!, von: entwurf.von, bis: entwurf.bis,
    ...(entwurf.teamId ? { team_id: entwurf.teamId } : {}),
    ...(entwurf.baustelle ? { baustelle_id: entwurf.baustelle.id } : {}),
  });
  const INZWISCHEN = 'Diesen Einsatz hat inzwischen jemand anderes geändert — die Planung ist neu geladen. Bitte schliessen und nochmals öffnen.';

  /**
   * Doppelung auflösen, bevor der Einsatz gespeichert wird. Liest die Einsätze des Teams frisch (nicht nur die angezeigte
   * Woche — auch was danach kommt, kann mitrutschen). Gibt einen Satz für die Rückmeldung zurück, '' wenn nichts
   * kollidierte, null bei Fehler (steht dann im Dialog).
   */
  async function doppeltAufloesen(beginnNeu: number | null): Promise<string | null> {
    if (!supabase || !baustelle) return null;
    const c = supabase;
    type Zeile = { id: string; team_id: string; von: string; bis: string; beginn_min: number | null; treffpunkt: Treffpunkt | null; hinweis: string | null; baustelle_id: string; baustelle: { bezeichnung: string | null } | null };
    const r = await c.from('jahresplan').select(felderFehlen ? 'id,team_id,von,bis,baustelle_id,baustelle:baustelle_id(bezeichnung)' : 'id,team_id,von,bis,beginn_min,treffpunkt,hinweis,baustelle_id,baustelle:baustelle_id(bezeichnung)')
      .eq('team_id', teamId).gte('bis', von);
    if (r.error) { setFehler('Nicht gespeichert: ' + r.error.message); return null; }
    const zeilen = ((r.data ?? []) as unknown as Zeile[]).filter((z) => z.id !== entwurf.id).map((z) => ({ ...z, beginn_min: z.beginn_min ?? null }));
    if (!zeilen.some((z) => Doppelt.ueberschneiden(z, zeitraum))) return '';
    let schritte: Doppelt.Schritt[];
    if (doppeltWahl === 'zeiten') {
      const alt = beginnAlt.trim() ? ausUhrzeit(beginnAlt) : null;
      if (beginnNeu === null || alt === null) { setFehler('Beide Beginnzeiten angeben, z. B. 07:00 und 13:00 — sonst weiss der Chefmonteur nicht, wohin zuerst.'); return null; }
      if (alt === beginnNeu) { setFehler('Die zwei Baustellen brauchen verschiedene Beginnzeiten.'); return null; }
      schritte = Doppelt.mitZeiten(zeitraum, zeilen, alt);
    } else {
      schritte = doppeltWahl === 'schieben' ? Doppelt.verschieben(zeitraum, zeilen) : Doppelt.streichen(zeitraum, zeilen);
    }
    const { data: u } = await c.auth.getUser();
    const grundText = `wegen ${baustelle.bezeichnung ?? baustelle.konto_nr}`;
    const nach = new Map(zeilen.map((z) => [z.id, z]));
    const saetze: string[] = [];
    try {
      for (const sch of schritte) {
        if (sch.art === 'aendern') {
          const z = nach.get(sch.id)!;
          const neu: Record<string, unknown> = { von: sch.von, bis: sch.bis };
          if (sch.beginn_min !== undefined) neu.beginn_min = sch.beginn_min;
          const u1 = await c.from('jahresplan').update(neu).match({ id: z.id, von: z.von, bis: z.bis }).select('id');
          if (u1.error) throw u1.error;
          if ((u1.data ?? []).length === 0) throw new Error('Der Plan wurde inzwischen geändert — bitte neu laden und nochmals versuchen.');
          const log: { feld: string; alt: string; neu: string }[] = [];
          if (z.von !== sch.von) log.push({ feld: 'von', alt: z.von, neu: sch.von });
          if (z.bis !== sch.bis) log.push({ feld: 'bis', alt: z.bis, neu: sch.bis });
          if (sch.beginn_min !== undefined && sch.beginn_min !== z.beginn_min) log.push({ feld: 'beginn_min', alt: z.beginn_min != null ? uhrzeit(z.beginn_min) : '—', neu: sch.beginn_min != null ? uhrzeit(sch.beginn_min) : '—' });
          if (log.length) await c.from('planaenderung').insert(log.map((l) => ({ jahresplan_id: z.id, ...l, geaendert_von: u.user?.id ?? null, grund: grundText })));
          saetze.push(`${z.baustelle?.bezeichnung ?? 'Einsatz'} neu ${spanne(sch.von, sch.bis)}`);
        } else if (sch.art === 'neu') {
          const z = nach.get(sch.vorlage)!;
          // Ohne eigene Zeit für den Rest: ein Nachmittags-Beginn geht nicht mit (21.11.2026, Stauffacher Di–Mi ab 13:00)
          const felderZ: EinsatzFelder = felderFehlen ? {} : { beginn_min: sch.beginn_min !== undefined ? sch.beginn_min : beginnFuerRest(z.beginn_min) ?? null, treffpunkt: z.treffpunkt, hinweis: z.hinweis };
          const i1 = await c.from('jahresplan').insert({ team_id: z.team_id, baustelle_id: z.baustelle_id, von: sch.von, bis: sch.bis, ...felderZ });
          if (i1.error) throw i1.error;
        } else {
          const z = nach.get(sch.id)!;
          await c.from('planaenderung').delete().eq('jahresplan_id', z.id);
          const d1 = await c.from('jahresplan').delete().match({ id: z.id, von: z.von, bis: z.bis }).select('id');
          if (d1.error) throw d1.error;
          saetze.push(`${z.baustelle?.bezeichnung ?? 'Einsatz'} entfällt`);
        }
      }
    } catch (e) {
      setFehler('Nicht gespeichert: ' + (e instanceof Error ? e.message : String(e)));
      onNeuLaden();
      return null;
    }
    return doppeltWahl === 'zeiten' ? 'Beide Baustellen mit Zeiten.' : saetze.length ? saetze.join(' · ') + '.' : '';
  }

  async function speichern() {
    if (!supabase || !gueltig || !baustelle) return;
    const beginnMin = beginn.trim() ? ausUhrzeit(beginn) : null;
    if (beginn.trim() && beginnMin === null) { setFehler('Beginn: eine Uhrzeit wie 06:30.'); return; }
    const hinweisText = hinweis.trim() || null;
    const felder: EinsatzFelder = felderFehlen ? {} : { beginn_min: beginnMin, treffpunkt, hinweis: hinweisText };
    setSpeichert(true);
    setFehler(null);
    // Zwei Baustellen am selben Tag (16.11.2026): mit frischen Daten aus der Datenbank prüfen und auflösen
    const aufgeloest = await doppeltAufloesen(beginnMin);
    if (aufgeloest === null) { setSpeichert(false); return; }
    if (!bestehend) {
      const { error } = await supabase.from('jahresplan').insert({ team_id: teamId, baustelle_id: baustelle.id, von, bis, ...felder });
      setSpeichert(false);
      if (error) { setFehler('Nicht gespeichert: ' + error.message); return; }
      onGespeichert(`${team?.bezeichnung ?? 'Team'} ist auf ${baustelle.bezeichnung ?? baustelle.konto_nr} eingeplant.${aufgeloest ? ' ' + aufgeloest : ''}`);
      return;
    }
    const alt = entwurf;
    const aenderungen: { feld: string; alt: string; neu: string }[] = [];
    if (alt.von !== von) aenderungen.push({ feld: 'von', alt: alt.von, neu: von });
    if (alt.bis !== bis) aenderungen.push({ feld: 'bis', alt: alt.bis, neu: bis });
    if (alt.baustelle?.id !== baustelle.id) aenderungen.push({ feld: 'baustelle', alt: `${alt.baustelle?.konto_nr ?? ''} ${alt.baustelle?.bezeichnung ?? ''}`.trim(), neu: `${baustelle.konto_nr} ${baustelle.bezeichnung ?? ''}`.trim() });
    if (alt.teamId !== teamId) aenderungen.push({ feld: 'team', alt: teams.find((t) => t.id === alt.teamId)?.bezeichnung ?? '', neu: team?.bezeichnung ?? '' });
    if (!felderFehlen) {
      const text = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));
      if ((alt.beginn_min ?? null) !== beginnMin) aenderungen.push({ feld: 'beginn_min', alt: alt.beginn_min != null ? uhrzeit(alt.beginn_min) : '—', neu: beginnMin != null ? uhrzeit(beginnMin) : '—' });
      if ((alt.treffpunkt ?? null) !== treffpunkt) aenderungen.push({ feld: 'treffpunkt', alt: alt.treffpunkt ? TREFFPUNKT_TEXT[alt.treffpunkt] : '—', neu: treffpunkt ? TREFFPUNKT_TEXT[treffpunkt] : '—' });
      if ((alt.hinweis ?? null) !== hinweisText) aenderungen.push({ feld: 'hinweis', alt: text(alt.hinweis), neu: text(hinweisText) });
    }
    if (aenderungen.length === 0) { setSpeichert(false); if (aufgeloest) onGespeichert(aufgeloest); else onSchliessen(); return; }
    const { data: r1, error: e1 } = await supabase.from('jahresplan').update({ team_id: teamId, baustelle_id: baustelle.id, von, bis, ...felder }).match(wieAngezeigt()).select('id');
    if (e1) { setSpeichert(false); setFehler('Nicht gespeichert: ' + e1.message); return; }
    if ((r1 ?? []).length === 0) { setSpeichert(false); setFehler(INZWISCHEN); onNeuLaden(); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error: e2 } = await supabase.from('planaenderung').insert(aenderungen.map((a) => ({ jahresplan_id: alt.id, ...a, geaendert_von: u.user?.id ?? null, grund: grund.trim() || null })));
    setSpeichert(false);
    if (e2) { setFehler('Gespeichert, aber die Änderung ist nicht protokolliert: ' + e2.message); return; }
    onGespeichert('Einsatz geändert.' + (aufgeloest ? ' ' + aufgeloest : ''));
  }

  async function entfernen() {
    if (!supabase || !entwurf.id) return;
    setSpeichert(true);
    // Erst prüfen, ob der Einsatz noch so dasteht; dann die Terminhistorie (gehört zum Einsatz), dann der Einsatz
    const da = await supabase.from('jahresplan').select('id').match(wieAngezeigt());
    if (!da.error && (da.data ?? []).length === 0) { setSpeichert(false); setLoeschenFragen(false); setFehler(INZWISCHEN); onNeuLaden(); return; }
    const { error: e1 } = da.error ? { error: da.error } : await supabase.from('planaenderung').delete().eq('jahresplan_id', entwurf.id);
    const { error: e2 } = e1 ? { error: e1 } : await supabase.from('jahresplan').delete().match(wieAngezeigt());
    setSpeichert(false);
    if (e2) { setFehler('Nicht entfernt: ' + e2.message); return; }
    onGespeichert('Einsatz entfernt.');
  }

  const wert = (feld: string, v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && (feld === 'von' || feld === 'bis') ? kurz(ausIso(v)) : v || '—');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onSchliessen(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="einsatz-titel" className="max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-[0_30px_80px_-20px_rgb(17_17_19/0.45)] sm:rounded-[24px] sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]"><CalendarPlus size={19} strokeWidth={2.2} aria-hidden="true" /></span>
            <span>
              <span id="einsatz-titel" className="block font-display text-lg font-semibold text-ink">{bestehend ? 'Einsatz ändern' : 'Einsatz planen'}</span>
              <span className="block text-xs text-ink3">Team, Baustelle, Zeitraum — und was das Team wissen muss</span>
            </span>
          </span>
          <button type="button" onClick={onSchliessen} aria-label="Schliessen" className="grid h-9 w-9 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="space-y-5">
          <div>
            <span className="lbl">Team</span>
            <Auswahl label="Team" optionen={teams.map((t) => ({ wert: t.id, text: t.bezeichnung, unter: t.chefmonteur?.name }))} wert={teamId} aendern={teamWaehlen} />
          </div>

          <div>
            <span className="lbl">Baustelle</span>
            {baustelle ? (
              <div className="flex items-center justify-between gap-3 rounded-[14px] border border-ink/10 bg-gradient-to-br from-white to-[#f6f3ee] px-3.5 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="knr">{baustelle.konto_nr}</span>
                  <span className="truncate text-sm font-semibold text-ink">{baustelle.bezeichnung || 'Baustelle'}</span>
                </span>
                <button type="button" className="shrink-0 text-xs font-semibold text-steel" onClick={() => setBaustelle(null)}>ändern</button>
              </div>
            ) : (
              <BaustellenWahl baustellen={baustellen} waehlen={setBaustelle} autoFokus />
            )}
          </div>

          <div>
            <span className="lbl">Zeitraum</span>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SCHNELL.map((s) => {
                const z = zeitraumVorschlag(s.art, tag);
                const an = z.von === von && z.bis === bis;
                return (
                  <Pille key={s.art} an={an} onClick={() => { setVon(z.von); setBis(z.bis); }}>{s.label}</Pille>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-xs text-ink3">von</span>
                <DatumWahl wert={von} aendern={(v) => { setVon(v); if (v > bis) setBis(v); }} label="von" schnell={false} leerErlaubt={false} />
              </div>
              <div>
                <span className="mb-1 block text-xs text-ink3">bis</span>
                <DatumWahl wert={bis} aendern={setBis} min={von} label="bis" schnell={false} leerErlaubt={false} />
              </div>
            </div>
            {von && bis && bis >= von && (
              <p className="mt-2 text-xs text-ink2">
                {lang(ausIso(von))} bis {lang(ausIso(bis))} · <b className="text-ink">{arbeitstage(zeitraum)} {arbeitstage(zeitraum) === 1 ? 'Arbeitstag' : 'Arbeitstage'}</b>
              </p>
            )}
          </div>

          {/* Einsatzfelder (0049, Amir 24.10.2026): alles freiwillig — leer lassen heisst planen wie bisher */}
          {!felderFehlen && (
            <div className="space-y-4 rounded-[16px] border border-line bg-ground/50 p-4">
              <p className="lbl mb-0">Fürs Team <span className="font-normal normal-case tracking-normal text-ink3">· alles freiwillig</span></p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink2">Beginn</span>
                  {/* Immer 24 h (21.11.2026, Amir: «warum 1 PM?») — das native Feld richtet sich nach der Sprache des Browsers */}
                  <ZeitFeld wert={beginn} aendern={setBeginn} label="Beginn" klasse="field tabular-nums" />
                  <span className="mt-1 block text-[11px] text-ink3">Leer = {uhrzeit(firmenBeginn)} wie immer</span>
                </label>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-ink2">Treffpunkt</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['werkhof', 'baustelle'] as const).map((t) => (
                    <Pille key={t} an={treffpunkt === t} onClick={() => setTreffpunkt(treffpunkt === t ? null : t)}>{t === 'werkhof' ? 'Im Werkhof' : 'Direkt auf der Baustelle'}</Pille>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink2">Hinweis fürs Team</span>
                <input className="field" value={hinweis} maxLength={200} onChange={(e) => setHinweis(e.target.value)} placeholder="z. B. Kran kommt um 9, Schlüssel beim Hauswart" />
              </label>
            </div>
          )}

          {andere.length > 0 && (
            <div className="rounded-[16px] border border-amber/40 bg-amber-soft/60 p-4">
              <p className="font-display text-[15px] font-semibold text-ink">
                {team?.bezeichnung} ist {von === bis ? `am ${tagKurz(ausIso(von))}` : 'in dieser Zeit'} schon eingeplant
              </p>
              <ul className="mt-2 space-y-1">
                {andere.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="knr">{p.baustelle?.konto_nr}</span>
                    <b className="font-semibold text-ink">{p.baustelle?.bezeichnung ?? 'Baustelle'}</b>
                    <span className="text-xs font-semibold text-amber-deep">{p.von === p.bis ? tagKurz(ausIso(p.von)) : `${tagKurz(ausIso(p.von))} – ${tagKurz(ausIso(p.bis))}`}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink2">Was soll mit der bisherigen Baustelle passieren?</p>
              <div className="mt-2 space-y-2" role="radiogroup" aria-label="Bisherige Baustelle">
                {([
                  ['schieben', 'Verschieben', 'Rutscht hinter den neuen Einsatz — was direkt danach kommt, rutscht mit.'],
                  ['streichen', 'Diese Tage dort streichen', 'Die Tage fallen bei der bisherigen Baustelle weg, sonst bleibt alles.'],
                  ['zeiten', 'Beides am selben Tag — mit Zeiten', 'Zwei Baustellen an einem Tag. Beginnzeiten sind Pflicht, die frühere zuerst.'],
                ] as const).map(([w, titel, text]) => (
                  <button key={w} type="button" role="radio" aria-checked={doppeltWahl === w} disabled={w === 'zeiten' && felderFehlen}
                    onClick={() => setDoppeltWahl(w)}
                    className={'flex w-full items-start gap-3 rounded-[12px] bg-white px-3.5 py-2.5 text-left transition disabled:opacity-40 ' + (doppeltWahl === w ? 'shadow-[0_0_0_2px_var(--color-steel)]' : 'shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-line-strong)]')}>
                    <span className={'mt-0.5 h-4 w-4 shrink-0 rounded-full ' + (doppeltWahl === w ? 'shadow-[inset_0_0_0_5px_var(--color-steel)]' : 'shadow-[inset_0_0_0_2px_#cfcac2]')} aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{titel}</span>
                      <span className="block text-xs text-ink3">{text}</span>
                    </span>
                  </button>
                ))}
              </div>
              {doppeltWahl === 'zeiten' && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs text-ink2">
                    <span className="mb-1 block font-semibold">{baustelle?.bezeichnung ?? 'Neue Baustelle'} ab</span>
                    <input className="field" inputMode="numeric" value={beginn} onChange={(e) => setBeginn(e.target.value)} placeholder="07:00" />
                  </label>
                  <label className="block text-xs text-ink2">
                    <span className="mb-1 block font-semibold">{andere[0]?.baustelle?.bezeichnung ?? 'Bisherige'} ab</span>
                    <input className="field" inputMode="numeric" value={beginnAlt} onChange={(e) => setBeginnAlt(e.target.value)} placeholder="13:00" />
                  </label>
                </div>
              )}
              {doppeltWahl !== 'zeiten' && vorschau.length > 0 && (
                <ul className="mt-3 space-y-0.5 text-xs text-amber-deep">
                  {vorschau.map((z, i) => <li key={i}>↳ {z}</li>)}
                </ul>
              )}
            </div>
          )}

          {bestehend && (
            <label className="block">
              <span className="lbl">Grund der Änderung <span className="font-normal text-ink3">(freiwillig)</span></span>
              <input className="field" value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. Kunde verschiebt, Material fehlt" />
            </label>
          )}

          {bestehend && verlauf.length > 0 && (
            <div>
              <span className="lbl flex items-center gap-1.5"><History size={13} aria-hidden="true" /> Verlauf</span>
              <ul className="space-y-1 text-xs text-ink2">
                {verlauf.map((v, i) => (
                  <li key={i} className="flex flex-wrap gap-x-1.5">
                    <span className="tabular-nums text-ink3">{new Date(v.geaendert_am).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}</span>
                    <span><b className="font-semibold text-ink">{FELD_TEXT[v.feld] ?? v.feld}</b> {wert(v.feld, v.alt)} → {wert(v.feld, v.neu)}</span>
                    {v.grund && <span className="text-ink3">· {v.grund}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-sm text-accent-deep">{fehler}</p>}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {bestehend ? (
            loeschenFragen ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-ink2">Wirklich entfernen?</span>
                <button type="button" disabled={speichert} onClick={() => void entfernen()} className="rounded-full bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-60">Ja, entfernen</button>
                <button type="button" onClick={() => setLoeschenFragen(false)} className="font-semibold text-ink3 hover:text-ink">Nein</button>
              </span>
            ) : (
              <button type="button" onClick={() => setLoeschenFragen(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-deep hover:text-accent"><Trash2 size={14} aria-hidden="true" />Einsatz entfernen</button>
            )
          ) : <span />}
          <span className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={onSchliessen}>Abbrechen</button>
            <button
              type="button"
              disabled={!gueltig || speichert}
              onClick={() => void speichern()}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7),inset_0_1px_0_rgb(255_255_255/0.3)] transition hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50"
            >
              {speichert ? 'Speichert …' : bestehend ? 'Speichern' : 'Einplanen'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Agenda fürs Handy (Konzept C, 21.11.2026): je Tag eine Karte, Einsätze nach Uhrzeit ────────────────────

function WochenAgenda({ tage, teams, plaene, heuteIso, istFrei, wetter, onTag, onNeu }: {
  tage: Date[];
  teams: Team[];
  plaene: Plan[];
  heuteIso: string;
  istFrei: (d: Date) => boolean;
  wetter: (dIso: string) => WetterTag | undefined;
  onTag: (teamId: string, datum: string) => void;
  onNeu?: (teamId: string, d: Date) => void;
}) {
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.bezeichnung ?? 'Team';
  return (
    <section className="space-y-2.5 min-[700px]:hidden" aria-label="Einsätze je Tag">
      {tage.map((d) => {
        const dIso = iso(d);
        const hier = plaene
          .filter((p) => p.team_id && p.von <= dIso && p.bis >= dIso && teams.some((t) => t.id === p.team_id))
          .sort((a, b) => ((a.beginn_min ?? 24 * 60) - (b.beginn_min ?? 24 * 60)) || teamName(a.team_id).localeCompare(teamName(b.team_id), 'de', { numeric: true }));
        const frei = istFrei(d);
        if (frei && hier.length === 0) return null;
        const ohne = frei ? [] : teams.filter((t) => !hier.some((p) => p.team_id === t.id));
        const w = wetter(dIso);
        return (
          <div key={dIso} className={'card px-4 py-3 ' + (dIso === heuteIso ? 'ring-2 ring-accent/30' : '')}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[15px] font-semibold text-ink">
                {WOCHENTAGE[(d.getDay() + 6) % 7]} {kurz(d)}
                {dIso === heuteIso && <span className="ml-2 rounded-full bg-accent px-2 py-px text-[11px] font-semibold text-white">heute</span>}
              </p>
              {w && <WetterKopf w={w} />}
            </div>
            {hier.length === 0 && <p className="py-1.5 text-sm text-ink3">Nichts geplant.</p>}
            <ul className="divide-y divide-line">
              {hier.map((p) => {
                const f = farbeVon(p.baustelle?.id ?? p.id);
                const unten = [teamName(p.team_id), p.von !== p.bis ? `Einsatz ${kurz(ausIso(p.von))} – ${kurz(ausIso(p.bis))}` : null, p.treffpunkt ? `Treffpunkt ${TREFFPUNKT_TEXT[p.treffpunkt]}` : null].filter(Boolean).join(' · ');
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => onTag(p.team_id!, dIso)} className="grid w-full grid-cols-[3.25rem_0.75rem_1fr] items-start gap-x-2 py-2 text-left">
                      <span className={p.beginn_min != null ? 'text-sm font-bold tabular-nums text-ink' : 'pt-0.5 text-[11.5px] font-semibold leading-tight text-ink3'}>{p.beginn_min != null ? uhrzeit(p.beginn_min) : 'ganzer Tag'}</span>
                      <span className={'mt-1.5 h-2.5 w-2.5 rounded-full ' + f.punkt} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-semibold text-ink">{p.baustelle?.bezeichnung || 'Baustelle'}</span>
                        <span className="block truncate text-[12.5px] text-ink3">{unten}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {onNeu && ohne.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs text-ink3">
                noch frei:
                {ohne.map((t) => <Pille key={t.id} plus onClick={() => onNeu(t.id, d)}>{t.bezeichnung}</Pille>)}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
