/**
 * Tagesübersicht für den Bauführer: Wer hat heute gemeldet — und was? Wer noch nicht?
 * Ziel der Kachel «x/20 Teams haben heute gemeldet» auf der Startseite.
 * Gemeldete Teams stehen zuoberst mit allem, was der Bauführer wissen will: Baustelle, Stunden je Person,
 * Abweichung mit Grund, Sprachnotiz als Text, Fotos. Teams ohne Meldung als kompakte Liste darunter.
 * Zeigt nur, was gemeldet wurde und was laut Jahresplan vorgesehen war — keine Urteile (CLAUDE.md #1).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, ChevronLeft, ChevronRight, CircleDashed, Languages } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, stunden, WOCHENTAGE } from '../lib/datum';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Meldung {
  id: string; team_id: string; normalfall: boolean; abweichung_typ: string | null; wer_hats_gewollt: string | null;
  transkript: string | null; transkript_sprache?: string | null; audio_sekunden: number | null; erfasst_am: string;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: { normal_min: number; ueber_min: number; mitarbeiter_id: string; mitarbeiter: { name: string } | null }[];
  foto: { id: string }[];
}
interface Plan { team_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzlich gearbeitet', warten: 'warten müssen', kaputt: 'etwas kaputt', laenger: 'länger gearbeitet', ueberstunden: 'Überstunden' };
const WER: Record<string, string> = { kunde: 'der Kunde wollte es', chef: 'der Chef wollte es', niemand: 'niemand hat es verlangt' };

/** Meldungen eines Teams nach Baustelle bündeln: normale Stunden + Abweichungen je Art, mit Notiz und Fotos. */
function proBaustelle(ms: Meldung[]) {
  const map = new Map<string, {
    schluessel: string; konto_nr: string | null; bezeichnung: string; zuletzt: string; normalMin: number;
    abweichungen: { typ: string; min: number; wer: string | null; transkript: string | null; audio_sekunden: number | null; id: string }[];
    fotos: number;
  }>();
  for (const m of ms) {
    const schluessel = m.baustelle?.konto_nr ?? 'ohne';
    const b = map.get(schluessel) ?? { schluessel, konto_nr: m.baustelle?.konto_nr ?? null, bezeichnung: m.baustelle?.bezeichnung ?? '', zuletzt: m.erfasst_am, normalMin: 0, abweichungen: [], fotos: 0 };
    const min = m.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
    if (m.normalfall) {
      b.normalMin += min;
      // Überstunden mit Grund am normalen Tag — wie eine Abweichung zeigen, mit wer/Notiz
      const ueberMin = m.zeiteintrag.reduce((s, z) => s + z.ueber_min, 0);
      if (ueberMin > 0) b.abweichungen.push({ typ: 'ueberstunden', min: ueberMin, wer: m.wer_hats_gewollt, transkript: m.transkript, audio_sekunden: m.audio_sekunden, id: m.id });
    } else b.abweichungen.push({ typ: m.abweichung_typ ?? 'abweichung', min, wer: m.wer_hats_gewollt, transkript: m.transkript, audio_sekunden: m.audio_sekunden, id: m.id });
    b.fotos += m.foto?.length ?? 0;
    if (m.erfasst_am > b.zuletzt) b.zuletzt = m.erfasst_am;
    map.set(schluessel, b);
  }
  return [...map.values()];
}

/** Stunden je Person über alle Meldungen des Teams (normal + Abweichung derselben Leute). */
function proPerson(ms: Meldung[]) {
  const map = new Map<string, { name: string; min: number }>();
  for (const m of ms) for (const z of m.zeiteintrag) {
    const e = map.get(z.mitarbeiter_id) ?? { name: z.mitarbeiter?.name ?? '?', min: 0 };
    e.min += z.normal_min + z.ueber_min;
    map.set(z.mitarbeiter_id, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function kurzName(name: string): string {
  const t = name.trim().split(' ');
  return t.length > 1 ? `${t[0][0]}. ${t.slice(1).join(' ')}` : name;
}

function uhrzeit(ts: string): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Tag() {
  const [datum, setDatum] = useState<Date>(() => new Date());
  const [teams, setTeams] = useState<Team[]>([]);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState('');
  const tagIso = iso(datum);
  const heuteIso = iso(new Date());

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const [t, m, p] = await Promise.all([
        c.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).order('bezeichnung'),
        c.from('tagesmeldung').select('id,team_id,normalfall,abweichung_typ,wer_hats_gewollt,transkript,transkript_sprache,audio_sekunden,erfasst_am,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,mitarbeiter_id,mitarbeiter:mitarbeiter_id(name)),foto(id)').eq('datum', tagIso).order('erfasst_am'),
        c.from('jahresplan').select('team_id,baustelle:baustelle_id(konto_nr,bezeichnung)').lte('von', tagIso).gte('bis', tagIso),
      ]);
      setFehler(t.error?.message ?? m.error?.message ?? '');
      setTeams(((t.data ?? []) as unknown as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
      setMeldungen((m.data ?? []) as unknown as Meldung[]);
      setPlan((p.data ?? []) as unknown as Plan[]);
      setLaedt(false);
    })();
  }, [tagIso]);

  const proTeam = new Map<string, Meldung[]>();
  for (const m of meldungen) proTeam.set(m.team_id, [...(proTeam.get(m.team_id) ?? []), m]);
  // Neueste Meldung zuoberst — was gerade reinkam, will der Bauführer zuerst sehen
  const zuletztVon = (teamId: string) => (proTeam.get(teamId) ?? []).reduce((z, m) => (m.erfasst_am > z ? m.erfasst_am : z), '');
  const gemeldet = teams.filter((t) => proTeam.has(t.id)).sort((a, b) => zuletztVon(b.id).localeCompare(zuletztVon(a.id)));
  const offen = teams.filter((t) => !proTeam.has(t.id));
  const planFuer = (teamId: string) => plan.find((p) => p.team_id === teamId)?.baustelle ?? null;
  const wochenende = datum.getDay() === 0 || datum.getDay() === 6;
  const totalTag = meldungen.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
  const abweichungenTag = meldungen.filter((m) => !m.normalfall).length;

  function zurWoche(teamId: string) {
    localStorage.setItem('cockpit-team', teamId);
  }
  const wochenLink = (teamId: string, meldungId?: string) => `/cockpit?woche=${tagIso}&tag=${tagIso}&team=${teamId}${meldungId ? `&meldung=${meldungId}` : ''}`;

  // Was Aufmerksamkeit braucht (Überstunden, Abweichung) zuerst, danach das Neueste
  const mitHinweis = (teamId: string) => (proTeam.get(teamId) ?? []).some((m) => !m.normalfall || m.zeiteintrag.some((z) => z.ueber_min > 0));
  const sortiert = [...gemeldet].sort((a, b) => Number(mitHinweis(b.id)) - Number(mitHinweis(a.id)));
  const anzHinweis = gemeldet.filter((t) => mitHinweis(t.id)).length;

  return (
    <Shell zurueck>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="lbl mb-0.5">Tagesübersicht</p>
            <h1 className="font-display text-[26px] font-semibold tracking-tight lg:text-[28px]">{lang(datum)}</h1>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {laedt ? <span className="text-sm text-ink3">lädt …</span> : (
                <>
                  <Kennzahl wert={`${gemeldet.length}/${teams.length}`} text="Teams gemeldet" />
                  {totalTag > 0 && <Kennzahl wert={`${stunden(totalTag)} h`} text="total" />}
                  {anzHinweis > 0 && <Kennzahl wert={String(anzHinweis)} text={anzHinweis === 1 ? 'mit Überstunden' : 'mit Überstunden'} farbe="text-amber-deep" />}
                  {abweichungenTag > 0 && <Kennzahl wert={String(abweichungenTag)} text={abweichungenTag === 1 ? 'Abweichung' : 'Abweichungen'} farbe="text-amber-deep" />}
                  {wochenende && <Kennzahl wert="" text="Wochenende" />}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-ink/10 bg-white shadow-[0_1px_2px_rgb(17_17_19/0.06)]">
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep" onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück"><ChevronLeft size={17} /></button>
              <span className="min-w-[96px] text-center text-sm font-semibold tabular-nums">{WOCHENTAGE[(datum.getDay() + 6) % 7]} {kurz(datum)}</span>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep disabled:opacity-30" disabled={tagIso >= heuteIso} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor"><ChevronRight size={17} /></button>
            </div>
            {tagIso !== heuteIso && <button type="button" className="btn-ghost py-2" onClick={() => setDatum(new Date())}>Heute</button>}
          </div>
        </header>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">Konnte nicht laden: {fehler}</p>}

        {/* Gemeldet — das ist die Arbeit von heute */}
        {!laedt && sortiert.length > 0 && (
          <section className="space-y-3">
            <p className="lbl mb-0">Gemeldet · {sortiert.length}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {sortiert.map((t) => {
                const ms = proTeam.get(t.id) ?? [];
                const total = ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
                const leute = proPerson(ms);
                const zuletzt = ms.reduce((z, m) => (m.erfasst_am > z ? m.erfasst_am : z), ms[0]?.erfasst_am ?? '');
                const hinweis = mitHinweis(t.id);
                return (
                  <article key={t.id} className={'flex flex-col overflow-hidden rounded-[18px] border bg-white shadow-[0_1px_2px_rgb(17_17_19/0.04),0_10px_28px_-18px_rgb(17_17_19/0.28)] ' + (hinweis ? 'border-amber/40 bg-gradient-to-br from-white via-white to-[#fdf0cf]' : 'border-ink/[0.06]')}>
                    <div className="flex items-start justify-between gap-3 px-4 pt-4">
                      <div className="min-w-0">
                        <p className="font-display text-[15px] font-semibold">{t.bezeichnung}</p>
                        <p className="truncate text-xs text-ink3">{t.chefmonteur?.name ?? 'kein Chefmonteur'} · {leute.length} Personen</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-display text-[20px] font-semibold leading-none tabular-nums">{stunden(total)} h</span>
                        <span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ' + (hinweis ? 'bg-amber text-white' : 'bg-good-soft text-good-deep')}>
                          <Check size={11} strokeWidth={3} aria-hidden="true" />{uhrzeit(zuletzt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-2.5 px-4 py-3">
                      {proBaustelle(ms).map((b) => (
                        <div key={b.schluessel} className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            {b.konto_nr && <span className="knr">{b.konto_nr}</span>}
                            <span className="min-w-0 truncate font-medium">{b.bezeichnung || 'ohne Baustelle'}</span>
                            {b.abweichungen.map((a) => (
                              <span key={a.id} className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber-deep">{ABWEICHUNG[a.typ] ?? 'Abweichung'} · {stunden(a.min)} h</span>
                            ))}
                            {b.fotos > 0 && <span className="inline-flex items-center gap-1 text-xs text-ink3"><Camera size={12} aria-hidden="true" />{b.fotos}</span>}
                          </div>
                          {b.abweichungen.map((a) => {
                            const m = ms.find((x) => x.id === a.id);
                            const fremd = m?.transkript_sprache && m.transkript_sprache !== 'de';
                            return (
                              <div key={a.id} className="rounded-[12px] border border-amber/30 bg-white/80 px-3 py-2.5 text-sm">
                                {a.wer && <p className="mb-1 text-xs text-ink2">{WER[a.wer] ?? a.wer}</p>}
                                {a.transkript
                                  ? <p className="italic leading-snug text-ink2">«{a.transkript}»</p>
                                  : a.audio_sekunden ? <p className="text-xs text-ink3">Sprachnotiz {a.audio_sekunden} Sek. — Text wird erstellt</p> : null}
                                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                                  {fremd ? <span className="inline-flex items-center gap-1 text-[11px] text-ink3"><Languages size={12} aria-hidden="true" />aus dem {SPRACHE_ADJ[m!.transkript_sprache!] ?? 'Original'} übersetzt</span> : <span />}
                                  <Link to={wochenLink(t.id, a.id)} onClick={() => zurWoche(t.id)} className="text-xs font-semibold text-amber-deep">Prüfen ›</Link>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2/40 px-4 py-2.5">
                      <p className="min-w-0 truncate text-xs text-ink3">
                        {leute.map((p, i) => (
                          <span key={p.name}>{i > 0 ? ' · ' : ''}{kurzName(p.name)} <span className="tabular-nums text-ink2">{stunden(p.min)}</span></span>
                        ))}
                      </p>
                      <Link to={wochenLink(t.id)} onClick={() => zurWoche(t.id)} className="shrink-0 text-xs font-semibold text-steel">Woche ›</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!laedt && gemeldet.length === 0 && teams.length > 0 && (
          <p className="card text-sm text-ink3">{wochenende ? 'Wochenende — keine Meldungen.' : tagIso === heuteIso ? 'Noch keine Meldung — die Teams melden am Abend.' : 'An diesem Tag hat kein Team gemeldet.'}</p>
        )}

        {/* Noch nichts gemeldet — ruhige Kacheln mit Baustelle laut Planung */}
        {!laedt && offen.length > 0 && (
          <section className="space-y-3">
            <p className="lbl mb-0">Noch nichts gemeldet · {offen.length}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {offen.map((t) => {
                const bs = planFuer(t.id);
                return (
                  <Link key={t.id} to={wochenLink(t.id)} onClick={() => zurWoche(t.id)} className="group rounded-[16px] border border-line bg-white px-4 py-3 shadow-[0_1px_2px_rgb(17_17_19/0.04),0_10px_24px_-18px_rgb(17_17_19/0.28)] transition hover:-translate-y-px">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-display text-[15px] font-semibold">{t.bezeichnung}</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink3 ring-1 ring-line-strong"><CircleDashed size={11} strokeWidth={2.5} aria-hidden="true" />offen</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink2">{t.chefmonteur?.name ?? 'kein Chefmonteur'}</span>
                    {/* Ohne Plan-Eintrag bleibt die Zeile leer — «nichts im Jahresplan» verwirrte Firmen ohne Planung (05.10.2026) */}
                    {bs && (
                      <span className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-ink3">
                        <span className="knr">{bs.konto_nr}</span><span className="truncate">{bs.bezeichnung ?? ''}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            {tagIso === heuteIso && !wochenende && <p className="text-xs text-ink3">Die Teams melden am Abend — vorher ist diese Liste normal lang.</p>}
          </section>
        )}

        {!laedt && teams.length === 0 && <p className="text-sm text-ink3">Keine Teams angelegt — Verwaltung → Teams.</p>}
      </div>
    </Shell>
  );
}

const SPRACHE_ADJ: Record<string, string> = { it: 'Italienischen', fr: 'Französischen', pl: 'Polnischen', pt: 'Portugiesischen', sq: 'Albanischen', ar: 'Arabischen', en: 'Englischen' };

function Kennzahl({ wert, text, farbe = 'text-ink' }: { wert: string; text: string; farbe?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-ink/10 bg-white px-3.5 py-1.5 text-xs text-ink2 shadow-[0_1px_2px_rgb(17_17_19/0.05)]">
      {wert && <b className={'text-sm tabular-nums ' + farbe}>{wert}</b>}{text}
    </span>
  );
}
