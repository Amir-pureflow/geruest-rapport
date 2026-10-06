import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, ausIso, iso, kurz, kw, lang, montag, WOCHENTAGE } from '../lib/datum';
import { arbeitstage, spuren, ueberschneiden, zeitraumVorschlag, type Schnellwahl, type Zeitraum } from '../lib/planung';

/**
 * Planung (06.10.2026, ersetzt das Board): Zeilen = Teams, Spalten = Tage. Ein Einsatz ist ein Balken über
 * die geplanten Tage. Freien Tag antippen = an diesem Tag planen, Balken antippen = ändern oder entfernen.
 *
 * Geschrieben wird in `jahresplan`; Erfassung und Tagesübersicht schlagen daraus die Baustelle vor.
 * Änderungen an bestehenden Einsätzen landen in `planaenderung` (Terminhistorie, wie beim Board).
 */

interface Team { id: string; bezeichnung: string; chefmonteur: { name: string } | null }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null; status: string | null }
interface Plan { id: string; team_id: string | null; von: string; bis: string; baustelle: Baustelle | null }

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

const SPUR_HOEHE = 40;

/** Was der Dialog bearbeitet: neuer Einsatz (ohne id) oder ein bestehender. */
interface Entwurf { id?: string; teamId: string; baustelle: Baustelle | null; von: string; bis: string; tag: string }

export function Planung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [plaene, setPlaene] = useState<Plan[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [start, setStart] = useState(() => montag(new Date()));
  const [anzahlTage, setAnzahlTage] = useState<7 | 14>(7);
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [rueckmeldung, setRueckmeldung] = useState<string | null>(null);

  const tage = useMemo(() => Array.from({ length: anzahlTage }, (_, i) => addTage(start, i)), [start, anzahlTage]);
  const startIso = iso(start);
  const endeIso = iso(addTage(start, anzahlTage - 1));
  const heuteIso = iso(new Date());

  const laden = useCallback(async () => {
    if (!supabase) return;
    setLaedt(true);
    const [t, b, p] = await Promise.all([
      supabase.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      supabase.from('baustelle').select('id,konto_nr,bezeichnung,status').neq('status', 'abgeschlossen').order('bezeichnung'),
      supabase.from('jahresplan').select('id,team_id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung,status)').gte('bis', startIso).lte('von', endeIso),
    ]);
    const err = t.error ?? b.error ?? p.error;
    setFehler(err ? 'Planung konnte nicht geladen werden: ' + err.message : null);
    setTeams(((t.data ?? []) as unknown as Team[]).sort((x, y) => x.bezeichnung.localeCompare(y.bezeichnung, 'de', { numeric: true })));
    setBaustellen((b.data ?? []) as Baustelle[]);
    setPlaene((p.data ?? []) as unknown as Plan[]);
    setLaedt(false);
  }, [startIso, endeIso]);
  useEffect(() => { void laden(); }, [laden]);

  useEffect(() => {
    if (!rueckmeldung) return;
    const t = setTimeout(() => setRueckmeldung(null), 3000);
    return () => clearTimeout(t);
  }, [rueckmeldung]);

  const proTeam = useMemo(() => {
    const m = new Map<string, ReturnType<typeof spuren<Plan>>>();
    for (const team of teams) m.set(team.id, spuren(plaene.filter((p) => p.team_id === team.id), startIso, anzahlTage));
    return m;
  }, [teams, plaene, startIso, anzahlTage]);

  const ohneEinsatz = teams.filter((t) => (proTeam.get(t.id) ?? []).length === 0);

  // Wochenende schmaler — dort wird selten gearbeitet, die Spalten bleiben aber da (Samstagseinsätze)
  const tagSpalten = tage.map((d) => ((d.getDay() + 6) % 7 >= 5 ? 'minmax(0,0.55fr)' : 'minmax(0,1fr)')).join(' ');
  const titel = anzahlTage === 7
    ? `KW ${kw(start)} · ${kurz(start)} – ${kurz(addTage(start, 6))}`
    : `KW ${kw(start)}–${kw(addTage(start, 7))} · ${kurz(start)} – ${kurz(addTage(start, 13))}`;

  const schliessen = useCallback(() => setEntwurf(null), []);

  function neu(teamId: string, tag: Date) {
    const z = zeitraumVorschlag('tag', tag);
    setEntwurf({ teamId, baustelle: null, ...z, tag: iso(tag) });
  }

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Planung &amp; Daten</p>
            <h1 className="font-display text-2xl font-semibold">Planung</h1>
            <p className="mt-1 text-sm text-ink3">Welches Team wann auf welcher Baustelle ist — für einen Tag, eine Woche oder länger.</p>
          </div>
          <button
            type="button"
            onClick={() => neu(teams[0]?.id ?? '', new Date(Math.max(Date.now(), start.getTime())))}
            disabled={teams.length === 0}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7),inset_0_1px_0_rgb(255_255_255/0.3)] transition hover:-translate-y-px disabled:opacity-60"
          >
            <Plus size={16} strokeWidth={2.6} aria-hidden="true" /> Einsatz planen
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-ink/10 bg-white shadow-[0_1px_2px_rgb(17_17_19/0.06)]">
              <button type="button" aria-label="Zurück" onClick={() => setStart(addTage(start, -7))} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep"><ChevronLeft size={17} /></button>
              <span className="min-w-[180px] px-1 text-center text-sm font-semibold tabular-nums text-ink">{titel}</span>
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
            <div className="min-w-[860px]">
              {/* Kopf: Tage */}
              <div className="grid border-b border-line bg-surface-2/60" style={{ gridTemplateColumns: '200px minmax(0,1fr)' }}>
                <span className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Team</span>
                <div className="grid" style={{ gridTemplateColumns: tagSpalten }}>
                  {tage.map((d) => {
                    const istHeute = iso(d) === heuteIso;
                    return (
                      <span key={iso(d)} className="flex flex-col items-center justify-center py-2 text-[11px] leading-tight">
                        <span className={'font-semibold ' + (istHeute ? 'text-accent-deep' : 'text-ink3')}>{WOCHENTAGE[(d.getDay() + 6) % 7]}</span>
                        <span className={'mt-0.5 rounded-full px-1.5 tabular-nums ' + (istHeute ? 'bg-accent text-white' : 'text-ink2')}>{kurz(d)}</span>
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
                return (
                  <div key={team.id} className="grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: '200px minmax(0,1fr)' }}>
                    <div className="flex min-w-0 flex-col justify-center px-4 py-2.5">
                      <span className="truncate font-display text-[14px] font-semibold text-ink">{team.bezeichnung}</span>
                      {team.chefmonteur && <span className="truncate text-xs text-ink3">{kurzName(team.chefmonteur.name)}</span>}
                    </div>
                    <div className="grid py-2" style={{ gridTemplateColumns: tagSpalten, gridTemplateRows: `repeat(${anzSpuren}, ${SPUR_HOEHE}px)`, rowGap: 6 }}>
                      {/* Freie Felder: antippen = an diesem Tag planen */}
                      {freieFelder.map(({ d, i, spur }) => {
                        return (
                          <button
                            key={iso(d) + '-' + spur}
                            type="button"
                            onClick={() => neu(team.id, d)}
                            aria-label={`${team.bezeichnung} am ${lang(d)} planen`}
                            style={{ gridColumn: i + 1, gridRow: spur + 1 }}
                            className="group/tag mx-0.5 grid place-items-center rounded-[10px] transition hover:bg-accent-soft/60"
                          >
                            <Plus size={15} className="text-accent opacity-0 transition group-hover/tag:opacity-100" aria-hidden="true" />
                          </button>
                        );
                      })}
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
                              'relative z-10 mx-0.5 flex min-w-0 items-center gap-2 bg-gradient-to-br px-2.5 text-left ring-1 shadow-[0_1px_2px_rgb(17_17_19/0.05),0_6px_14px_-10px_rgb(17_17_19/0.35)] transition hover:-translate-y-px hover:shadow-[0_1px_2px_rgb(17_17_19/0.05),0_12px_22px_-12px_rgb(17_17_19/0.45)] ' +
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <p className="text-[11px] text-ink3">Freien Tag antippen = dort planen · Balken antippen = ändern oder entfernen · Erfassung und Tagesübersicht schlagen die geplante Baustelle vor.</p>
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
    </Shell>
  );
}

// ── Dialog: Einsatz planen / ändern ─────────────────────────────────────────────

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
  const [suche, setSuche] = useState('');
  const [von, setVon] = useState(entwurf.von);
  const [bis, setBis] = useState(entwurf.bis);
  const [grund, setGrund] = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [loeschenFragen, setLoeschenFragen] = useState(false);
  const sucheRef = useRef<HTMLInputElement>(null);
  const tag = ausIso(entwurf.tag);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSchliessen(); };
    document.addEventListener('keydown', esc);
    if (!entwurf.baustelle) setTimeout(() => sucheRef.current?.focus(), 0);
    return () => document.removeEventListener('keydown', esc);
  }, [entwurf.baustelle, onSchliessen]);

  const q = suche.trim().toLowerCase();
  const treffer = (q ? baustellen.filter((b) => b.konto_nr.includes(q) || (b.bezeichnung ?? '').toLowerCase().includes(q)) : baustellen.filter((b) => b.status === 'aktiv')).slice(0, 40);

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
                <button type="button" className="shrink-0 text-xs font-semibold text-steel" onClick={() => { setBaustelle(null); setTimeout(() => sucheRef.current?.focus(), 0); }}>ändern</button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[14px] border border-line-strong">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
                  <input ref={sucheRef} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name oder Kontonummer …" className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {treffer.map((b) => (
                    <button key={b.id} type="button" onClick={() => setBaustelle(b)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ground">
                      <span className="knr">{b.konto_nr}</span>
                      <span className="truncate text-ink2">{b.bezeichnung || 'Baustelle'}</span>
                    </button>
                  ))}
                  {treffer.length === 0 && <p className="px-3 py-3 text-sm text-ink3">Nichts gefunden.</p>}
                </div>
              </div>
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
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">von</span>
                <input type="date" className="field" value={von} onChange={(e) => { setVon(e.target.value); if (e.target.value > bis) setBis(e.target.value); }} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">bis</span>
                <input type="date" className="field" value={bis} min={von} onChange={(e) => setBis(e.target.value)} />
              </label>
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
