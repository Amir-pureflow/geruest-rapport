import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, History, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { Dialog, Avatar } from '../ui/Dialog';
import { ArtPille } from '../ui/ArtPille';
import { supabase } from '../lib/supabase';
import { addTage, ausIso, iso, kurz, kw, lang, montag, WOCHENTAGE } from '../lib/datum';
import {
  arbeitstage, besetzung, naechsterTeamName, ohneTag, planIst, spuren, ueberschneiden, zeitraumVorschlag,
  type PlanIst, type Schnellwahl, type TagesBesetzung, type Versetzung, type Zeitraum,
} from '../lib/planung';
import { werktage } from '../lib/abwesenheit';
import { FUNKTION_BUERO } from '../lib/benutzername';
import { DatumWahl } from '../ui/DatumWahl';
import { baustellenSuchen } from '../lib/suche';

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
 */

interface Team { id: string; bezeichnung: string; chefmonteur_id: string | null; chefmonteur: { name: string } | null }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null; status: string | null }
interface Plan { id: string; team_id: string | null; von: string; bis: string; baustelle: Baustelle | null }
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
/** «Di 13.10.» */
const tagKurz = (d: Date) => `${WOCHENTAGE[(d.getDay() + 6) % 7]} ${kurz(d)}`;
/** Freitag derselben Woche (am Wochenende: der Tag selbst). */
function freitagVon(tag: string): string {
  const d = ausIso(tag);
  const wt = (d.getDay() + 6) % 7;
  return wt <= 4 ? iso(addTage(d, 4 - wt)) : tag;
}

const SPUR_HOEHE = 40;
const TAGZEILE_HOEHE = 30;
/** Teamspalte: am Handy schmal, am PC mit Platz für die Namen — als CSS-Variable, damit Raster und Mindestbreite mitgehen */
const TEAM_SPALTE_KLASSE = '[--team:152px] md:[--team:250px]';

/** Was der Einsatz-Dialog bearbeitet: neuer Einsatz (ohne id) oder ein bestehender. */
interface Entwurf { id?: string; teamId: string; baustelle: Baustelle | null; von: string; bis: string; tag: string }

export function Planung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [plaene, setPlaene] = useState<Plan[]>([]);
  const [mitglieder, setMitglieder] = useState<Mitglied[]>([]);
  const [personen, setPersonen] = useState<Person[]>([]);
  const [versetzungen, setVersetzungen] = useState<Versetzung[]>([]);
  const [abwesend, setAbwesend] = useState<Abw[]>([]);
  const [ist, setIst] = useState<IstZeile[]>([]);
  /** einsatz_person fehlt noch (Migration 0036) — Versetzen geht dann nicht */
  const [einsatzFehlt, setEinsatzFehlt] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [start, setStart] = useState(() => montag(new Date()));
  const [anzahlTage, setAnzahlTage] = useState<7 | 14>(7);
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [tagWahl, setTagWahl] = useState<{ teamId: string; datum: string } | null>(null);
  const [teamNeu, setTeamNeu] = useState(false);
  const [rueckmeldung, setRueckmeldung] = useState<string | null>(null);

  const tage = useMemo(() => Array.from({ length: anzahlTage }, (_, i) => addTage(start, i)), [start, anzahlTage]);
  const startIso = iso(start);
  const endeIso = iso(addTage(start, anzahlTage - 1));
  const heuteIso = iso(new Date());

  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    const istBis = endeIso < heuteIso ? endeIso : heuteIso;
    const [t, b, p, m, ma] = await Promise.all([
      c.from('team').select('id,bezeichnung,chefmonteur_id,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      c.from('baustelle').select('id,konto_nr,bezeichnung,status').neq('status', 'abgeschlossen').order('bezeichnung'),
      c.from('jahresplan').select('id,team_id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung,status)').gte('bis', startIso).lte('von', endeIso),
      c.from('team_mitglied').select('team_id,mitarbeiter:mitarbeiter_id(id,name,funktion,aktiv)').is('bis', null),
      c.from('mitarbeiter').select('id,name,funktion').eq('aktiv', true).neq('funktion', FUNKTION_BUERO).order('name'),
    ]);
    // Neu mit 0036 bzw. nur für vergangene Tage — fehlt etwas, bleibt die Planung trotzdem bedienbar
    const [v, a, i] = await Promise.all([
      c.from('einsatz_person').select('datum,mitarbeiter_id,team_id').gte('datum', startIso).lte('datum', endeIso),
      c.from('abwesenheit').select('datum,mitarbeiter_id,art').gte('datum', startIso).lte('datum', endeIso),
      startIso <= heuteIso
        ? c.from('tagesmeldung').select('team_id,datum,baustelle:baustelle_id(id,konto_nr,bezeichnung),zeiteintrag(mitarbeiter_id)').gte('datum', startIso).lte('datum', istBis).limit(2000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const err = t.error ?? b.error ?? p.error;
    setFehler(err ? 'Planung konnte nicht geladen werden: ' + err.message : null);
    setTeams(((t.data ?? []) as unknown as Team[]).sort((x, y) => x.bezeichnung.localeCompare(y.bezeichnung, 'de', { numeric: true })));
    setBaustellen((b.data ?? []) as Baustelle[]);
    setPlaene((p.data ?? []) as unknown as Plan[]);
    setMitglieder((m.data ?? []) as unknown as Mitglied[]);
    setPersonen((ma.data ?? []) as Person[]);
    setEinsatzFehlt(!!v.error);
    setVersetzungen(v.error ? [] : ((v.data ?? []) as Versetzung[]));
    setAbwesend(a.error ? [] : ((a.data ?? []) as Abw[]));
    setIst(i.error ? [] : ((i.data ?? []) as unknown as IstZeile[]));
    setLaedt(false);
  }, [startIso, endeIso, heuteIso]);
  useEffect(() => { void laden(); }, [laden]);

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
    return m;
  }, [abwesend]);

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

  const proTeam = useMemo(() => {
    const m = new Map<string, ReturnType<typeof spuren<Plan>>>();
    for (const team of teams) m.set(team.id, spuren(plaene.filter((p) => p.team_id === team.id), startIso, anzahlTage));
    return m;
  }, [teams, plaene, startIso, anzahlTage]);

  const ohneEinsatz = teams.filter((t) => (proTeam.get(t.id) ?? []).length === 0);

  // Alle Tage gleich breit (11.10.2026, Mehmeti/Amir): vorher waren Sa/So halb so breit, im 2-Wochen-Kopf lag die
  // rote «Heute»-Pille dann über Samstag und Montag. Wochenende jetzt nur grau hinterlegt.
  // Eine Woche passt neben der Seitenleiste auf einen 14-Zoll-Bildschirm; zwei Wochen scrollen dort seitlich, die Teamspalte bleibt stehen
  const spaltenBreite = anzahlTage === 7 ? 118 : 90;
  const minBreite = `calc(var(--team) + ${anzahlTage * spaltenBreite}px)`;
  const zeilenRaster = 'var(--team) minmax(0,1fr)';
  const tagSpalten = `repeat(${anzahlTage}, minmax(0, 1fr))`;
  const titel = anzahlTage === 7
    ? `KW ${kw(start)} · ${kurz(start)} – ${kurz(addTage(start, 6))}`
    : `KW ${kw(start)}–${kw(addTage(start, 7))} · ${kurz(start)} – ${kurz(addTage(start, 13))}`;
  /** Hintergrund je Tag: Wochenende grau, heute rötlich, Linie zwischen zwei Wochen */
  const tagHintergrund = (d: Date, i: number) =>
    (iso(d) === heuteIso ? 'bg-accent-soft/35 ' : istWochenende(d) ? 'bg-ink/[0.025] ' : '') + (i === 7 ? 'border-l border-line-strong ' : i > 0 ? 'border-l border-line/60 ' : '');

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
            <button type="button" onClick={() => setTeamNeu(true)} className="btn-ghost inline-flex items-center gap-1.5 py-2.5">
              <Users size={15} aria-hidden="true" /> + Team
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-ink/10 bg-white shadow-[0_1px_2px_rgb(17_17_19/0.06)]">
              <button type="button" aria-label="Zurück" onClick={() => setStart(addTage(start, -7))} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep"><ChevronLeft size={17} /></button>
              <span className="min-w-[200px] px-1 text-center text-sm font-semibold tabular-nums text-ink">{titel}</span>
              <button type="button" aria-label="Weiter" onClick={() => setStart(addTage(start, 7))} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep"><ChevronRight size={17} /></button>
            </div>
            <button type="button" className="btn-ghost py-2" onClick={() => setStart(montag(new Date()))}>Heute</button>
          </div>
          <div className="flex rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgb(17_17_19/0.06)]" role="group" aria-label="Zeitraum">
            {([7, 14] as const).map((n) => (
              <button key={n} type="button" onClick={() => setAnzahlTage(n)} aria-pressed={anzahlTage === n}
                className={'rounded-full px-3.5 py-1.5 text-xs font-semibold transition ' + (anzahlTage === n ? 'bg-ink text-white shadow-sm' : 'text-ink2 hover:text-ink')}>
                {n === 7 ? '1 Woche' : '2 Wochen'}
              </button>
            ))}
          </div>
        </div>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">{fehler}</p>}
        {rueckmeldung && <p className="rounded-[12px] border border-good/30 bg-good-soft px-4 py-2.5 text-sm font-medium text-good-deep" role="status">{rueckmeldung}</p>}

        {!laedt && teams.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink2">
            <span><b className="text-ink">{teams.length - ohneEinsatz.length} von {teams.length}</b> Teams eingeplant</span>
            {ohneEinsatz.length > 0 && (
              <>
                <span className="text-ink3">· noch frei:</span>
                {ohneEinsatz.map((t) => (
                  <button key={t.id} type="button" onClick={() => neu(t.id, new Date(Math.max(Date.now(), start.getTime())))} className="chip rounded-full px-3 py-1 text-xs font-semibold">
                    + {t.bezeichnung}
                  </button>
                ))}
              </>
            )}
          </p>
        )}

        <section className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className={TEAM_SPALTE_KLASSE} style={{ minWidth: minBreite }}>
              {/* Kopf: Wochentag klein in Versalien, Datum darunter, heute als rote Pille, Wochenende grau */}
              <div className="grid border-b border-line" style={{ gridTemplateColumns: zeilenRaster }}>
                <span className="sticky left-0 z-20 flex items-end bg-white px-4 pb-3 pt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3 shadow-[1px_0_0_rgb(17_17_19/0.06)]">Team · Leute</span>
                <div className="grid" style={{ gridTemplateColumns: tagSpalten }}>
                  {tage.map((d, i) => {
                    const istHeute = iso(d) === heuteIso;
                    const we = istWochenende(d);
                    return (
                      <span key={iso(d)} className={'flex flex-col items-center gap-1 pb-3 pt-4 ' + tagHintergrund(d, i)}>
                        <span className={'text-[10px] font-semibold uppercase tracking-[0.1em] ' + (istHeute ? 'text-accent' : we ? 'text-ink3/60' : 'text-ink3')}>
                          {WOCHENTAGE[(d.getDay() + 6) % 7]}{anzahlTage === 14 && (d.getDay() === 1) && <span className="ml-1 font-medium normal-case tracking-normal text-ink3/70">KW {kw(d)}</span>}
                        </span>
                        <span className={'whitespace-nowrap rounded-full px-2.5 py-0.5 font-display text-[13px] font-semibold tabular-nums leading-tight ' + (istHeute ? 'bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]' : we ? 'text-ink3/70' : 'text-ink')}>{kurz(d)}</span>
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
                const belegt = (spur: number, tag: number) => balken.some((b) => b.spur === spur && b.ab <= tag && b.bis >= tag);
                const freieFelder = Array.from({ length: anzSpuren }, (_, spur) => tage.map((d, i) => ({ d, i, spur }))).flat().filter((x) => !belegt(x.spur, x.i));
                const fest = basis.get(team.id) ?? [];
                return (
                  <div key={team.id} className="grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: zeilenRaster }}>
                    {/* Team mit seinen Leuten (Mehmeti: «die 3 Namen sehen») — bleibt beim seitlichen Scrollen stehen */}
                    <div className="sticky left-0 z-20 flex min-w-0 flex-col justify-center gap-1 bg-white px-4 py-2.5 shadow-[1px_0_0_rgb(17_17_19/0.06)]">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-display text-[14px] font-semibold text-ink">{team.bezeichnung}</span>
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
                    <div className="grid" style={{ gridTemplateColumns: tagSpalten, gridTemplateRows: `repeat(${anzSpuren}, ${SPUR_HOEHE}px) ${TAGZEILE_HOEHE}px`, rowGap: 6, paddingTop: 8, paddingBottom: 6 }}>
                      {/* Hintergrund je Tag (Wochenende, heute, Wochenlinie) über alle Spuren */}
                      {tage.map((d, i) => <span key={'h' + iso(d)} aria-hidden="true" className={'-my-2 ' + tagHintergrund(d, i)} style={{ gridColumn: i + 1, gridRow: `1 / ${anzSpuren + 2}` }} />)}
                      {/* Freie Felder: antippen = an diesem Tag planen */}
                      {freieFelder.map(({ d, i, spur }) => (
                        <button
                          key={iso(d) + '-' + spur}
                          type="button"
                          onClick={() => neu(team.id, d)}
                          aria-label={`${team.bezeichnung} am ${lang(d)} planen`}
                          style={{ gridColumn: i + 1, gridRow: spur + 1 }}
                          className="group/tag z-[1] mx-1 grid place-items-center rounded-[10px] transition hover:bg-accent-soft/60"
                        >
                          <Plus size={15} className="text-accent opacity-0 transition group-hover/tag:opacity-100" aria-hidden="true" />
                        </button>
                      ))}
                      {balken.map(({ plan, spur, ab, bis, links, rechts }) => {
                        const f = farbeVon(plan.baustelle?.id ?? plan.id);
                        const name = plan.baustelle?.bezeichnung || 'Baustelle';
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setEntwurf({ id: plan.id, teamId: team.id, baustelle: plan.baustelle, von: plan.von, bis: plan.bis, tag: plan.von })}
                            title={`${name} · ${plan.baustelle?.konto_nr ?? ''}`}
                            aria-label={`${team.bezeichnung}: ${name}, ${lang(ausIso(plan.von))} bis ${lang(ausIso(plan.bis))} — ändern`}
                            style={{ gridColumn: `${ab + 1} / ${bis + 2}`, gridRow: spur + 1 }}
                            className={
                              'relative z-10 mx-1 flex min-w-0 items-center gap-2 bg-gradient-to-br px-2.5 text-left ring-1 shadow-[0_1px_2px_rgb(17_17_19/0.05),0_6px_14px_-10px_rgb(17_17_19/0.35)] transition hover:-translate-y-px hover:shadow-[0_1px_2px_rgb(17_17_19/0.05),0_12px_22px_-12px_rgb(17_17_19/0.45)] ' +
                              f.balken + ' ' + (links ? 'rounded-l-[4px]' : 'rounded-l-[10px]') + ' ' + (rechts ? 'rounded-r-[4px]' : 'rounded-r-[10px]')
                            }
                          >
                            {links && <span className="-ml-1 text-xs opacity-60" aria-hidden="true">‹</span>}
                            {bis > ab && <span className={'h-2 w-2 shrink-0 rounded-full ' + f.punkt} aria-hidden="true" />}
                            {/* Eintägige Einsätze: Name auf zwei Zeilen statt «Wohnüber…» */}
                            <span className={'min-w-0 font-semibold ' + (bis > ab ? 'truncate text-[12.5px]' : 'line-clamp-2 text-[11px] leading-[1.15] [overflow-wrap:anywhere]')}>{name}</span>
                            {/* Kontonummer erst ab drei Tagen — bei kürzeren Balken ginge sonst der Name unter */}
                            {bis - ab >= 2 && <span className="ml-auto hidden shrink-0 font-mono text-[11px] opacity-70 lg:inline">{plan.baustelle?.konto_nr}</span>}
                            {rechts && <span className="-mr-1 text-xs opacity-60" aria-hidden="true">›</span>}
                          </button>
                        );
                      })}
                      {/* Tageszeile: Leute an dem Tag, Änderungen, Abwesende, Plan gegen Ist — antippen = den Tag bearbeiten */}
                      {tage.map((d, i) => {
                        const dIso = iso(d);
                        const bz = besetzungen.get(dIso)?.get(team.id) ?? { ids: [], dazu: [], weg: [] };
                        const abw = abwJeTag.get(dIso);
                        const abwN = bz.ids.filter((id) => abw?.has(id)).length;
                        const n = bz.ids.length - abwN;
                        const gemeldet = istJe.get(`${team.id}|${dIso}`);
                        const pi: PlanIst = dIso > heuteIso ? null
                          : planIst(geplantAm(team.id, dIso).map((p) => p.baustelle?.id ?? ''), [...(gemeldet?.baustellen.keys() ?? [])]);
                        const zeigeIst = pi && !(pi === 'nichts' && (dIso === heuteIso || istWochenende(d)));
                        const geplantHier = geplantAm(team.id, dIso).length > 0;
                        // Wochenende ohne Plan, Meldung oder Änderung: leer statt «3» — dort wird selten gearbeitet
                        const leer = (n === 0 || (istWochenende(d) && !geplantHier)) && bz.dazu.length === 0 && bz.weg.length === 0 && abwN === 0 && !zeigeIst;
                        return (
                          <button
                            key={'t' + dIso}
                            type="button"
                            onClick={() => setTagWahl({ teamId: team.id, datum: dIso })}
                            aria-label={`${team.bezeichnung} am ${lang(d)}: Leute und Baustelle`}
                            style={{ gridColumn: i + 1, gridRow: anzSpuren + 1 }}
                            className="z-[1] mx-1 flex items-center justify-center gap-1.5 rounded-[8px] border border-transparent px-1 text-[11px] font-medium tabular-nums transition hover:border-line-strong hover:bg-white"
                          >
                            {leer ? <span className="text-ink3/40" aria-hidden="true">·</span> : (
                              <>
                                <span className="inline-flex items-center gap-0.5 text-ink3" title={`${n} ${n === 1 ? 'Person' : 'Leute'} an diesem Tag`}><Users size={11} aria-hidden="true" />{n}</span>
                                {bz.dazu.length > 0 && <span className="font-semibold text-good-deep" title={'eingeteilt: ' + bz.dazu.map((id) => namen.get(id)).join(', ')}>+{bz.dazu.length}</span>}
                                {bz.weg.length > 0 && <span className="font-semibold text-amber-deep" title={'in anderem Team: ' + bz.weg.map((w) => namen.get(w.id)).join(', ')}>−{bz.weg.length}</span>}
                                {abwN > 0 && <span className="text-ink3" title="abwesend">{abwN}&nbsp;abw.</span>}
                                {zeigeIst && <IstZeichen ist={pi} />}
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
          <span>Tageszeile antippen = Leute und Baustelle für diesen Tag</span>
          <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" /> Leute an dem Tag</span>
          <span><b className="text-good-deep">+1</b> eingeteilt</span>
          <span><b className="text-amber-deep">−1</b> in anderem Team</span>
          <span>abw. = Ferien, Krank …</span>
          <span className="inline-flex items-center gap-1"><IstZeichen ist="wie-geplant" /> wie geplant gemeldet</span>
          <span className="inline-flex items-center gap-1"><IstZeichen ist="anders" /> andere Baustelle gemeldet</span>
          <span className="inline-flex items-center gap-1"><IstZeichen ist="nichts" /> nichts gemeldet</span>
        </div>
        <p className="text-[11px] text-ink3">Laufende und kommende Wochen sind der Plan — jederzeit änderbar. Vergangene Wochen zeigen Plan und gemeldete Baustelle nebeneinander (Archiv). Freien Tag antippen = dort planen · Balken antippen = Einsatz ändern, mit Verlauf.</p>
      </div>

      {entwurf && (
        <EinsatzDialog
          entwurf={entwurf}
          teams={teams}
          baustellen={baustellen}
          plaene={plaene}
          onSchliessen={schliessen}
          onGespeichert={(text) => { setEntwurf(null); setRueckmeldung(text); void laden(); }}
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
          onSchliessen={tagSchliessen}
          onEinsatz={(p) => { setTagWahl(null); setEntwurf({ id: p.id, teamId: tagTeam.id, baustelle: p.baustelle, von: p.von, bis: p.bis, tag: tagWahl.datum }); }}
          onNeuerEinsatz={() => { setTagWahl(null); neu(tagTeam.id, ausIso(tagWahl.datum)); }}
          onGeaendert={(text) => { setRueckmeldung(text); void laden(); }}
        />
      )}

      {teamNeu && (
        <TeamNeuDialog
          namen={teams.map((t) => t.bezeichnung)}
          onSchliessen={() => setTeamNeu(false)}
          onGespeichert={(text) => { setTeamNeu(false); setRueckmeldung(text); void laden(); }}
        />
      )}
    </Shell>
  );
}

/** Plan gegen Ist als kleines Zeichen — mit Erklärung beim Darüberfahren. */
function IstZeichen({ ist }: { ist: PlanIst }) {
  if (ist === 'wie-geplant') return <span title="wie geplant gemeldet" className="grid h-4 w-4 place-items-center rounded-full bg-good text-white"><Check size={10} strokeWidth={3} aria-hidden="true" /></span>;
  if (ist === 'anders') return <span title="andere Baustelle gemeldet als geplant" className="grid h-4 min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-bold leading-none text-white">≠</span>;
  if (ist === 'nichts') return <span title="geplant, aber nichts gemeldet" className="grid h-4 w-4 place-items-center rounded-full border border-dashed border-ink3/60 text-[10px] leading-none text-ink3">–</span>;
  if (ist === 'ohne-plan') return <span title="gemeldet, ohne Plan" className="grid h-4 w-4 place-items-center rounded-full bg-steel text-white"><Check size={10} strokeWidth={3} aria-hidden="true" /></span>;
  return null;
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
  team, datum, teams, personen, namen, basis, besetzungen, abwesend, geplant, gemeldet, vergangen, baustellen, einsatzFehlt,
  onSchliessen, onEinsatz, onNeuerEinsatz, onGeaendert,
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
  onSchliessen: () => void;
  onEinsatz: (p: Plan) => void;
  onNeuerEinsatz: () => void;
  onGeaendert: (text: string) => void;
}) {
  const d = ausIso(datum);
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
    try {
      for (const p of geplant) {
        const { vorher, nachher } = ohneTag(p, datum);
        if (vorher) {
          const r = await c.from('jahresplan').update({ bis: vorher.bis }).eq('id', p.id);
          if (r.error) throw r.error;
          await log(p.id, 'bis', p.bis, vorher.bis);
          if (nachher && p.baustelle) {
            const r2 = await c.from('jahresplan').insert({ team_id: team.id, baustelle_id: p.baustelle.id, von: nachher.von, bis: nachher.bis });
            if (r2.error) throw r2.error;
          }
        } else if (nachher) {
          const r = await c.from('jahresplan').update({ von: nachher.von }).eq('id', p.id);
          if (r.error) throw r.error;
          await log(p.id, 'von', p.von, nachher.von);
        } else {
          // Nur dieser eine Tag war geplant: Einsatz wird durch den neuen ersetzt
          await c.from('planaenderung').delete().eq('jahresplan_id', p.id);
          const r = await c.from('jahresplan').delete().eq('id', p.id);
          if (r.error) throw r.error;
        }
      }
      const r = await c.from('jahresplan').insert({ team_id: team.id, baustelle_id: b.id, von: datum, bis: datum });
      if (r.error) throw r.error;
    } catch (e) {
      setLaeuft(false);
      setFehler('Nicht gespeichert: ' + (e instanceof Error ? e.message : String((e as { message?: string }).message ?? e)));
      return;
    }
    setLaeuft(false);
    setAndereBaustelle(false);
    onGeaendert(`${team.bezeichnung} ist ${tagKurz(d)} auf ${b.bezeichnung ?? b.konto_nr}.`);
  }

  const dazuWahl = personen.filter((p) => !bz.ids.includes(p.id));

  return (
    <Dialog titel={`${team.bezeichnung} · ${tagKurz(d)}`} untertitel={vergangen ? 'Plan und was gemeldet wurde' : 'Baustelle und Leute für diesen Tag'} icon={CalendarDays} onSchliessen={onSchliessen} breit>
      <div className="space-y-6">
        {/* Baustelle */}
        <section className="space-y-2">
          <p className="lbl mb-0">Baustelle {vergangen ? 'geplant' : ''}</p>
          {geplant.length === 0 && <p className="text-sm text-ink3">Für diesen Tag ist nichts geplant.</p>}
          {geplant.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-ink/10 bg-gradient-to-br from-white to-[#f6f3ee] px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2"><span className="knr">{p.baustelle?.konto_nr}</span><span className="truncate text-sm font-semibold text-ink">{p.baustelle?.bezeichnung || 'Baustelle'}</span></span>
                <span className="mt-0.5 block text-[11px] text-ink3">{p.von === p.bis ? 'nur dieser Tag' : `Einsatz ${kurz(ausIso(p.von))} – ${kurz(ausIso(p.bis))}`}</span>
              </span>
              <button type="button" onClick={() => onEinsatz(p)} className="shrink-0 text-xs font-semibold text-steel">Einsatz ändern</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {geplant.length === 0
              ? <button type="button" onClick={onNeuerEinsatz} className="chip rounded-full px-3 py-1.5 text-xs font-semibold">+ Einsatz planen</button>
              : <button type="button" onClick={() => setAndereBaustelle((v) => !v)} className={'chip rounded-full px-3 py-1.5 text-xs font-semibold ' + (andereBaustelle ? 'chip-on' : '')}>Nur {tagKurz(d)} andere Baustelle …</button>}
          </div>
          {andereBaustelle && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-ink3">Der Einsatz bleibt an den anderen Tagen, wie er ist — nur {tagKurz(d)} geht das Team auf die gewählte Baustelle (Notfall, kurzfristig).</p>
              <BaustellenWahl baustellen={baustellen} waehlen={(b) => void nurDiesenTag(b)} autoFokus />
            </div>
          )}
        </section>

        {/* Plan gegen Ist */}
        {vergangen && (
          <section className="space-y-2">
            <p className="lbl mb-0 flex items-center gap-2">Gemeldet {pi && pi !== 'nichts' && <IstZeichen ist={pi} />}</p>
            {gemeldeteBaustellen.length === 0 ? (
              <p className="text-sm text-ink3">Noch nichts gemeldet.</p>
            ) : (
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
            <p className="lbl mb-0">Leute an diesem Tag · {bz.ids.length}</p>
            {mehrTage && (
              <span className="flex rounded-full border border-ink/10 bg-white p-0.5 text-[11px] font-semibold" role="group" aria-label="Gilt für">
                <button type="button" aria-pressed={bereich === 'tag'} onClick={() => setBereich('tag')} className={'rounded-full px-2.5 py-1 ' + (bereich === 'tag' ? 'bg-ink text-white' : 'text-ink2')}>nur {tagKurz(d)}</button>
                <button type="button" aria-pressed={bereich === 'woche'} onClick={() => setBereich('woche')} className={'rounded-full px-2.5 py-1 ' + (bereich === 'woche' ? 'bg-ink text-white' : 'text-ink2')}>bis Freitag</button>
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
                <li key={id} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar name={namen.get(id) ?? '?'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{namen.get(id) ?? '—'}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink3">
                      {id === team.chefmonteur_id && <span>Chefmonteur</span>}
                      {dazu && <span className="font-semibold text-good-deep">eingeteilt{stamm.get(id) ? ` · sonst ${teamName(stamm.get(id)!)}` : ''}</span>}
                      {art && <ArtPille art={art} />}
                    </span>
                  </span>
                  <label className="sr-only" htmlFor={`team-${id}`}>Team für {namen.get(id)}</label>
                  <select id={`team-${id}`} value={team.id} disabled={laeuft || einsatzFehlt} onChange={(e) => void versetzen(id, e.target.value)}
                    className="max-w-[9.5rem] rounded-full border border-ink/10 bg-white py-1.5 pl-3 pr-7 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(17_17_19/0.06)] disabled:opacity-50">
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.id === team.id ? `${t.bezeichnung} (hier)` : `→ ${t.bezeichnung}`}</option>)}
                  </select>
                  {dazu && stamm.get(id) && (
                    <button type="button" disabled={laeuft} onClick={() => void versetzen(id, stamm.get(id)!)} className="shrink-0 text-xs font-semibold text-steel disabled:opacity-50">zurück</button>
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
            {bz.ids.length === 0 && bz.weg.length === 0 && <li className="px-3 py-3 text-sm text-ink3">Niemand — unten Leute dazunehmen.</li>}
          </ul>
          <label className="flex items-center gap-2">
            <UserPlus size={16} className="shrink-0 text-ink3" aria-hidden="true" />
            <select value="" disabled={laeuft || einsatzFehlt} onChange={(e) => { if (e.target.value) void versetzen(e.target.value, team.id); }}
              className="field py-2 text-sm disabled:opacity-50" aria-label="Person dazunehmen">
              <option value="">Person dazunehmen …</option>
              {dazuWahl.map((p) => {
                const wo = woHeute.get(p.id);
                return <option key={p.id} value={p.id}>{p.name}{wo ? ` · ${teamName(wo)}` : ' · ohne Team'}{abwesend.has(p.id) ? ' · abwesend' : ''}</option>;
              })}
            </select>
          </label>
          <p className="text-[11px] text-ink3">
            Gilt {bereich === 'woche' && mehrTage ? `${tagKurz(d)} bis Freitag (nur Werktage)` : `nur am ${tagKurz(d)}`} — das feste Team bleibt, wie es ist (Verwaltung → Teams).
            Das Teamgerät übernimmt die Leute des Tages: Versetzte sind dort abgehakt, Eingeteilte stehen in der Liste.
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
const FELD_TEXT: Record<string, string> = { von: 'Beginn', bis: 'Ende', baustelle: 'Baustelle', team: 'Team' };

function EinsatzDialog({
  entwurf, teams, baustellen, plaene, onSchliessen, onGespeichert,
}: {
  entwurf: Entwurf;
  teams: Team[];
  baustellen: Baustelle[];
  plaene: Plan[];
  onSchliessen: () => void;
  onGespeichert: (text: string) => void;
}) {
  const bestehend = !!entwurf.id;
  const [teamId, setTeamId] = useState(entwurf.teamId);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(entwurf.baustelle);
  const [von, setVon] = useState(entwurf.von);
  const [bis, setBis] = useState(entwurf.bis);
  const [grund, setGrund] = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [loeschenFragen, setLoeschenFragen] = useState(false);
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

  const SCHNELL: { art: Schnellwahl; label: string }[] = [
    { art: 'tag', label: `Nur ${WOCHENTAGE[(tag.getDay() + 6) % 7]} ${kurz(tag)}` },
    { art: 'woche', label: 'Bis Freitag' },
    { art: 'zwei', label: '2 Wochen' },
    { art: 'vier', label: '4 Wochen' },
  ];

  async function speichern() {
    if (!supabase || !gueltig || !baustelle) return;
    setSpeichert(true);
    setFehler(null);
    if (!bestehend) {
      const { error } = await supabase.from('jahresplan').insert({ team_id: teamId, baustelle_id: baustelle.id, von, bis });
      setSpeichert(false);
      if (error) { setFehler('Nicht gespeichert: ' + error.message); return; }
      onGespeichert(`${team?.bezeichnung ?? 'Team'} ist auf ${baustelle.bezeichnung ?? baustelle.konto_nr} eingeplant.`);
      return;
    }
    const alt = entwurf;
    const aenderungen: { feld: string; alt: string; neu: string }[] = [];
    if (alt.von !== von) aenderungen.push({ feld: 'von', alt: alt.von, neu: von });
    if (alt.bis !== bis) aenderungen.push({ feld: 'bis', alt: alt.bis, neu: bis });
    if (alt.baustelle?.id !== baustelle.id) aenderungen.push({ feld: 'baustelle', alt: `${alt.baustelle?.konto_nr ?? ''} ${alt.baustelle?.bezeichnung ?? ''}`.trim(), neu: `${baustelle.konto_nr} ${baustelle.bezeichnung ?? ''}`.trim() });
    if (alt.teamId !== teamId) aenderungen.push({ feld: 'team', alt: teams.find((t) => t.id === alt.teamId)?.bezeichnung ?? '', neu: team?.bezeichnung ?? '' });
    if (aenderungen.length === 0) { setSpeichert(false); onSchliessen(); return; }
    const { error: e1 } = await supabase.from('jahresplan').update({ team_id: teamId, baustelle_id: baustelle.id, von, bis }).eq('id', alt.id!);
    if (e1) { setSpeichert(false); setFehler('Nicht gespeichert: ' + e1.message); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error: e2 } = await supabase.from('planaenderung').insert(aenderungen.map((a) => ({ jahresplan_id: alt.id, ...a, geaendert_von: u.user?.id ?? null, grund: grund.trim() || null })));
    setSpeichert(false);
    if (e2) { setFehler('Gespeichert, aber die Änderung ist nicht protokolliert: ' + e2.message); return; }
    onGespeichert('Einsatz geändert.');
  }

  async function entfernen() {
    if (!supabase || !entwurf.id) return;
    setSpeichert(true);
    // Die Terminhistorie gehört zum Einsatz — ohne Einsatz gibt es nichts mehr zu verschieben
    const { error: e1 } = await supabase.from('planaenderung').delete().eq('jahresplan_id', entwurf.id);
    const { error: e2 } = e1 ? { error: e1 } : await supabase.from('jahresplan').delete().eq('id', entwurf.id);
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
              <span className="block text-xs text-ink3">Team, Baustelle und Zeitraum</span>
            </span>
          </span>
          <button type="button" onClick={onSchliessen} aria-label="Schliessen" className="grid h-9 w-9 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="space-y-5">
          <label className="block">
            <span className="lbl">Team</span>
            <select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.bezeichnung}{t.chefmonteur ? ` · ${t.chefmonteur.name}` : ''}</option>)}
            </select>
          </label>

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
                  <button key={s.art} type="button" onClick={() => { setVon(z.von); setBis(z.bis); }} className={'chip rounded-full px-3 py-1.5 text-xs font-semibold ' + (an ? 'chip-on' : '')}>
                    {s.label}
                  </button>
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

          {andere.length > 0 && (
            <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-3.5 py-2.5 text-xs leading-relaxed text-amber-deep">
              {team?.bezeichnung} ist in dieser Zeit auch auf {andere.map((p) => p.baustelle?.bezeichnung ?? 'einer Baustelle').join(', ')} eingeplant. Beides bleibt stehen — zum Beispiel halber Tag hier, halber Tag dort.
            </p>
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
