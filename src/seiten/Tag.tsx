/**
 * Tagesübersicht für den Bauführer: Wer hat heute gemeldet — und was? Wer noch nicht?
 * Ziel der Kachel «x/20 Teams haben heute gemeldet» auf der Startseite.
 * Gemeldete Teams stehen zuoberst mit allem, was der Bauführer wissen will: Baustelle, Stunden je Person,
 * Abweichung mit Grund, Sprachnotiz als Text, Fotos. Teams ohne Meldung als kompakte Liste darunter.
 * Zeigt nur, was gemeldet wurde und was laut Jahresplan vorgesehen war — keine Urteile (CLAUDE.md #1).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, stunden, WOCHENTAGE } from '../lib/datum';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Meldung {
  id: string; team_id: string; normalfall: boolean; abweichung_typ: string | null; wer_hats_gewollt: string | null;
  transkript: string | null; audio_sekunden: number | null; erfasst_am: string;
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
      if (m.audio_sekunden || m.transkript) b.abweichungen.push({ typ: 'ueberstunden', min: m.zeiteintrag.reduce((s, z) => s + z.ueber_min, 0), wer: m.wer_hats_gewollt, transkript: m.transkript, audio_sekunden: m.audio_sekunden, id: m.id });
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
        c.from('tagesmeldung').select('id,team_id,normalfall,abweichung_typ,wer_hats_gewollt,transkript,audio_sekunden,erfasst_am,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,mitarbeiter_id,mitarbeiter:mitarbeiter_id(name)),foto(id)').eq('datum', tagIso).order('erfasst_am'),
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

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="lbl mb-0.5">Tagesübersicht</p>
            <h1 className="text-[26px] font-semibold tracking-tight lg:text-[28px]">{lang(datum)}</h1>
            <p className="mt-1 text-sm text-ink3">
              {laedt ? 'lädt …' : (
                <>
                  <span className="font-medium text-ink">{gemeldet.length} von {teams.length} Teams</span> haben gemeldet
                  {totalTag > 0 && <> · {stunden(totalTag)} h</>}
                  {abweichungenTag > 0 && <> · <span className="font-medium text-amber-deep">{abweichungenTag} Abweichung{abweichungenTag === 1 ? '' : 'en'}</span></>}
                  {wochenende ? ' · Wochenende' : ''}
                </>
              )}
            </p>
          </div>
          <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-xl border border-line-strong bg-surface">
            <button type="button" className="px-3 text-ink2 transition-colors hover:bg-surface-2" onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück">‹</button>
            <span className="border-x border-line px-3.5 py-2 text-sm whitespace-nowrap">
              <span className="font-semibold">{WOCHENTAGE[(datum.getDay() + 6) % 7]} {kurz(datum)}</span>
              {tagIso === heuteIso && <span className="text-ink3"> · heute</span>}
            </span>
            <button type="button" className="px-3 text-ink2 transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={tagIso >= heuteIso} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor">›</button>
          </div>
        </header>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">Konnte nicht laden: {fehler}</p>}

        {/* Gemeldet zuoberst — das ist die Arbeit von heute */}
        {!laedt && gemeldet.length > 0 && (
          <section className="space-y-3">
            <p className="lbl mb-0">Gemeldet · {gemeldet.length}</p>
            {gemeldet.map((t) => {
              const ms = proTeam.get(t.id) ?? [];
              const total = ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
              const leute = proPerson(ms);
              const zuletzt = ms.reduce((z, m) => (m.erfasst_am > z ? m.erfasst_am : z), ms[0]?.erfasst_am ?? '');
              const hatAbweichung = ms.some((m) => !m.normalfall);
              return (
                <div key={t.id} className={'card space-y-3 ' + (hatAbweichung ? 'border-amber/30' : '')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[15px] font-semibold">
                      {t.bezeichnung} <span className="text-sm font-normal text-ink3">· {t.chefmonteur?.name ?? 'kein Chefmonteur'}</span>
                    </p>
                    <p className="text-sm tabular-nums text-ink2">
                      <span className="font-semibold text-ink">{stunden(total)} h</span> · {leute.length} Pers. · <span className="text-ink3">gemeldet {uhrzeit(zuletzt)}</span>
                    </p>
                  </div>

                  {proBaustelle(ms).map((b) => (
                    <div key={b.schluessel} className="space-y-2 rounded-[12px] bg-ground px-3.5 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {b.konto_nr && <span className="knr">{b.konto_nr}</span>}
                        <span className="font-medium">{b.bezeichnung || 'ohne Baustelle'}</span>
                        {b.normalMin > 0 && <span className="rounded-md bg-good-soft px-2 py-0.5 text-xs font-medium text-good-deep">wie geplant · {stunden(b.normalMin)} h</span>}
                        {b.abweichungen.map((a) => (
                          <span key={a.id} className={'rounded-md px-2 py-0.5 text-xs font-medium ' + (a.typ === 'ueberstunden' ? 'bg-surface-2 text-ink2' : 'bg-amber-soft text-amber-deep')}>{ABWEICHUNG[a.typ] ?? 'Abweichung'} · {stunden(a.min)} h</span>
                        ))}
                        {b.fotos > 0 && <span className="text-xs text-ink3">{b.fotos} Foto{b.fotos === 1 ? '' : 's'}</span>}
                      </div>
                      {b.abweichungen.map((a) => (
                        <div key={a.id} className="text-sm">
                          {a.wer && <p className="text-xs text-ink2">{WER[a.wer] ?? a.wer}</p>}
                          {a.transkript
                            ? <p className="mt-1 rounded-[10px] bg-surface px-3 py-2 italic text-ink2">«{a.transkript}»</p>
                            : a.audio_sekunden ? <p className="mt-1 text-xs text-ink3">Sprachnotiz {a.audio_sekunden} Sek. — Text wird erstellt</p> : null}
                          <Link to={wochenLink(t.id, a.id)} onClick={() => zurWoche(t.id)} className={'mt-1 inline-block text-xs font-semibold ' + (a.typ === 'ueberstunden' ? 'text-steel' : 'text-amber-deep')}>{a.typ === 'ueberstunden' ? 'in der Woche ansehen ›' : 'Regieverdacht in der Woche ansehen ›'}</Link>
                        </div>
                      ))}
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-ink3">
                      {leute.map((p, i) => (
                        <span key={p.name}>{i > 0 ? ' · ' : ''}{kurzName(p.name)} <span className="tabular-nums text-ink2">{stunden(p.min)}</span></span>
                      ))}
                    </p>
                    <Link to={wochenLink(t.id)} onClick={() => zurWoche(t.id)} className="text-xs font-semibold text-steel">Woche prüfen ›</Link>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {!laedt && gemeldet.length === 0 && teams.length > 0 && (
          <p className="card text-sm text-ink3">{wochenende ? 'Wochenende — keine Meldungen.' : tagIso === heuteIso ? 'Noch keine Meldung — die Teams melden am Abend.' : 'An diesem Tag hat kein Team gemeldet.'}</p>
        )}

        {/* Noch nichts gemeldet — kompakt, eine Zeile pro Team */}
        {!laedt && offen.length > 0 && (
          <section className="space-y-2">
            <p className="lbl mb-0">Noch nichts gemeldet · {offen.length}</p>
            {/* Kacheln statt Zeilen: Team gross, darunter Chefmonteur und Baustelle laut Plan — auf einen Blick, nicht in einer Zeile */}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {offen.map((t) => {
                const bs = planFuer(t.id);
                return (
                  <Link key={t.id} to={wochenLink(t.id)} onClick={() => zurWoche(t.id)} className="card group flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold">{t.bezeichnung}</span>
                      <span className="block truncate text-sm text-ink2">{t.chefmonteur?.name ?? 'kein Chefmonteur'}</span>
                      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-ink3">
                        {bs
                          ? <><span className="knr">{bs.konto_nr}</span><span className="truncate">{bs.bezeichnung ?? ''}</span></>
                          : <span>nichts im Jahresplan</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-steel opacity-0 transition-opacity group-hover:opacity-100">Woche ›</span>
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
