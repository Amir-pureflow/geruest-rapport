/**
 * Tagesübersicht für den Bauführer: Wer hat heute gemeldet — und was? Wer noch nicht?
 * Ziel der Kachel «x/20 Teams haben heute gemeldet» auf der Startseite.
 * Konzept A (Amir, 10.11.2026): eine Liste mit allen Teams, wie die Wochenübersicht — Team mit Avatar, Baustelle,
 * Leute mit Stunden, Status, Total. Teams mit Regie/Überstunden zuoberst, die Sprachnotiz direkt unter der Zeile;
 * Teams ohne Meldung darunter mit der Baustelle laut Plan.
 * Zeigt nur, was gemeldet wurde und was laut Jahresplan vorgesehen war — keine Urteile (CLAUDE.md #1).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, ChevronLeft, ChevronRight, CircleDashed, Languages, TriangleAlert } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, stunden, WOCHENTAGE } from '../lib/datum';
import { gelbePersonen } from '../lib/einstellungen';
import { initialen, teamFarbe, teamKuerzel } from '../lib/teamStil';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Meldung {
  id: string; team_id: string; normalfall: boolean; abweichung_typ: string | null; wer_hats_gewollt: string | null;
  transkript: string | null; transkript_sprache?: string | null; audio_sekunden: number | null; erfasst_am: string;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: { normal_min: number; ueber_min: number; mitarbeiter_id: string; mitarbeiter: { name: string } | null }[];
  foto: { id: string }[];
}
interface Plan { team_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'Regie ausgeführt', warten: 'warten müssen', kaputt: 'etwas kaputt', laenger: 'länger gearbeitet', ueberstunden: 'Überstunden' };
/** Kurzwort im Status-Schild der Zeile (Konzept A, 10.11.2026) */
const ABWEICHUNG_KURZ: Record<string, string> = { zusaetzlich: 'Regie', warten: 'Warten', kaputt: 'Kaputt', laenger: 'Länger', ueberstunden: 'Überstunden' };
const WER: Record<string, string> = { kunde: 'der Kunde wollte es', chef: 'der Chef wollte es', niemand: 'niemand hat es verlangt' };

/**
 * Meldungen eines Teams nach Baustelle bündeln: normale Stunden + Abweichungen je Art, mit Notiz und Fotos.
 * `gelb` = Personen, deren Überstunden ab «Gelb markieren ab» der Firma gelb werden (09.10.2026).
 */
function proBaustelle(ms: Meldung[], gelb: Set<string>) {
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
      // Überstunden mit Grund am normalen Tag — wie eine Abweichung zeigen, mit wer/Notiz. Erst ab «Gelb markieren ab»
      // (Tagestotal einer Person); darunter sieht der Tag aus wie jeder andere, die Stunden stehen unten je Person.
      const ueberMin = m.zeiteintrag.reduce((s, z) => s + z.ueber_min, 0);
      if (m.zeiteintrag.some((z) => z.ueber_min > 0 && gelb.has(z.mitarbeiter_id))) b.abweichungen.push({ typ: 'ueberstunden', min: ueberMin, wer: m.wer_hats_gewollt, transkript: m.transkript, audio_sekunden: m.audio_sekunden, id: m.id });
    } else b.abweichungen.push({ typ: m.abweichung_typ ?? 'abweichung', min, wer: m.wer_hats_gewollt, transkript: m.transkript, audio_sekunden: m.audio_sekunden, id: m.id });
    b.fotos += m.foto?.length ?? 0;
    if (m.erfasst_am > b.zuletzt) b.zuletzt = m.erfasst_am;
    map.set(schluessel, b);
  }
  return [...map.values()];
}

/** Stunden je Person über alle Meldungen des Teams (normal + Abweichung derselben Leute). */
function proPerson(ms: Meldung[]) {
  const map = new Map<string, { id: string; name: string; min: number }>();
  for (const m of ms) for (const z of m.zeiteintrag) {
    const e = map.get(z.mitarbeiter_id) ?? { id: z.mitarbeiter_id, name: z.mitarbeiter?.name ?? '?', min: 0 };
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

  function zurWoche(teamId: string) {
    localStorage.setItem('cockpit-team', teamId);
  }
  const wochenLink = (teamId: string, meldungId?: string) => `/cockpit?woche=${tagIso}&tag=${tagIso}&team=${teamId}${meldungId ? `&meldung=${meldungId}` : ''}`;

  // Gelb erst ab dem Tagestotal einer Person (Firmen-Einstellung «Gelb markieren ab») — über alle Meldungen des Tages
  const gelb = gelbePersonen(meldungen.flatMap((m) => m.zeiteintrag.map((z) => ({ person: z.mitarbeiter_id, normal_min: z.normal_min, ueber_min: z.ueber_min }))));
  // Was Aufmerksamkeit braucht (Überstunden, Abweichung) zuerst, danach das Neueste
  const mitHinweis = (teamId: string) => (proTeam.get(teamId) ?? []).some((m) => !m.normalfall || m.zeiteintrag.some((z) => z.ueber_min > 0 && gelb.has(z.mitarbeiter_id)));
  const sortiert = [...gemeldet].sort((a, b) => Number(mitHinweis(b.id)) - Number(mitHinweis(a.id)));
  const anzHinweis = gemeldet.filter((t) => mitHinweis(t.id)).length;

  const fotosTag = meldungen.reduce((s, m) => s + (m.foto?.length ?? 0), 0);
  // Alle Teams in einer Liste (Konzept A, Amir 10.11.2026): gemeldet zuerst (mit Hinweis zuoberst), danach offen
  const zeilen = [...sortiert, ...offen];
  const zelle = '2xl:flex 2xl:min-h-[76px] 2xl:items-center 2xl:px-[22px] 2xl:py-4';
  const rand = (an: boolean) => (an ? '2xl:border-b 2xl:border-line' : '');
  const kopf = 'hidden border-b border-line bg-[#fbfaf8] px-[22px] py-[13px] text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink3 2xl:block';

  return (
    <Shell zurueck mittel>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="lbl mb-0.5">Tagesübersicht</p>
            <h1 className="font-display text-[28px] font-bold tracking-tight lg:text-[30px]">{lang(datum)}</h1>
          </div>
          <div className="flex items-center gap-2">
            {tagIso !== heuteIso && <button type="button" className="btn-ghost py-2" onClick={() => setDatum(new Date())}>Heute</button>}
            <div className="flex h-10 items-center rounded-full border border-line-strong bg-white">
              <button type="button" className="grid h-10 w-10 place-items-center rounded-full text-ink3 hover:text-accent-deep" onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück"><ChevronLeft size={16} /></button>
              <span className="min-w-[78px] text-center text-sm font-bold tabular-nums">{WOCHENTAGE[(datum.getDay() + 6) % 7]} {kurz(datum)}</span>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-full text-ink3 hover:text-accent-deep disabled:opacity-30" disabled={tagIso >= heuteIso} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor"><ChevronRight size={16} /></button>
            </div>
          </div>
        </header>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">Konnte nicht laden: {fehler}</p>}

        {laedt ? <p className="text-sm text-ink3">lädt …</p> : teams.length === 0 ? (
          <p className="text-sm text-ink3">Keine Teams angelegt — Verwaltung → Teams.</p>
        ) : (
          <>
            {/* Fortschritt: ein Balken je Team, in derselben Reihenfolge wie die Liste */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div className="w-full max-w-[520px] flex-1 basis-[320px]">
                <div className="mb-[7px] flex justify-between gap-4 text-[13px] text-ink2">
                  <span><b className="font-semibold text-ink">{gemeldet.length} von {teams.length} {teams.length === 1 ? 'Team' : 'Teams'}</b> {gemeldet.length === 1 ? 'hat' : 'haben'} gemeldet</span>
                  <span className="text-ink3">{wochenende ? 'Wochenende' : tagIso === heuteIso && offen.length > 0 ? 'Die Teams melden am Abend' : ''}</span>
                </div>
                <div className="flex gap-[5px]" aria-hidden="true">
                  {zeilen.map((t) => (
                    <i key={t.id} className={'h-2.5 flex-1 rounded-full ' + (!proTeam.has(t.id) ? 'bg-[#e4e0d9]' : mitHinweis(t.id) ? 'bg-amber' : 'bg-good')} />
                  ))}
                </div>
              </div>
              <div className="flex gap-7 lg:ml-auto">
                <div><b className="block font-display text-[22px] font-bold leading-tight tracking-tight tabular-nums">{stunden(totalTag)} h</b><span className="text-xs text-ink3">gemeldet total</span></div>
                <div><b className={'block font-display text-[22px] font-bold leading-tight tracking-tight tabular-nums ' + (anzHinweis > 0 ? 'text-amber-deep' : '')}>{anzHinweis}</b><span className="text-xs text-ink3">Regie / Überstunden</span></div>
                <div><b className="block font-display text-[22px] font-bold leading-tight tracking-tight tabular-nums">{fotosTag}</b><span className="text-xs text-ink3">Fotos</span></div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--color-line),0_18px_40px_-30px_rgb(40_30_20/0.4)]">
              <div className="2xl:grid 2xl:grid-cols-[210px_minmax(0,1.1fr)_minmax(0,1fr)_180px_90px]">
                <div className={kopf}>Team</div>
                <div className={kopf}>Baustelle</div>
                <div className={kopf}>Leute</div>
                <div className={kopf}>Status</div>
                <div className={kopf + ' text-right'}>Total</div>

                {zeilen.map((t, i) => {
                  const ms = proTeam.get(t.id) ?? [];
                  const da = ms.length > 0;
                  const letzte = i === zeilen.length - 1;
                  const total = ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
                  const leute = proPerson(ms);
                  const zuletzt = ms.reduce((z, m) => (m.erfasst_am > z ? m.erfasst_am : z), ms[0]?.erfasst_am ?? '');
                  const hinweis = da && mitHinweis(t.id);
                  const baustellen = da ? proBaustelle(ms, gelb) : [];
                  const abw = baustellen.flatMap((b) => b.abweichungen);
                  const bs = planFuer(t.id);
                  // Linie unter der Zeile — fehlt nur ganz unten; mit Notiz zieht sie unter der Notiz durch
                  const strich = rand(!letzte || abw.length > 0);
                  const balken = hinweis ? ' 2xl:shadow-[inset_4px_0_0_var(--color-amber)]' : '';
                  return (
                    <div key={t.id} className={'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-4 md:gap-x-6 md:px-6 md:py-5 2xl:contents' + (letzte ? '' : ' border-b border-line') + (hinweis ? ' shadow-[inset_4px_0_0_var(--color-amber)] 2xl:shadow-none' : '')}>
                      {/* Team */}
                      <Link to={wochenLink(t.id)} onClick={() => zurWoche(t.id)} className={'order-1 flex min-w-0 items-center gap-3 2xl:order-none ' + zelle + ' ' + (abw.length ? '' : strich) + balken}>
                        <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-sm font-bold ' + teamFarbe(t.id) + (da ? '' : ' opacity-55')} aria-hidden="true">{initialen(t.chefmonteur?.name) ?? teamKuerzel(t.bezeichnung)}</span>
                        <span className="min-w-0">
                          <span className={'block font-display text-[15px] font-bold ' + (da ? '' : 'text-[#b3ada3]')}>{t.bezeichnung}</span>
                          <span className="block truncate text-[12.5px] text-ink3">{t.chefmonteur?.name ? kurzName(t.chefmonteur.name) : 'kein Chefmonteur'}{da && <span className="2xl:hidden">{` · ${leute.length} ${leute.length === 1 ? 'Person' : 'Leute'}`}</span>}</span>
                        </span>
                      </Link>

                      {/* Baustelle */}
                      <div className={'order-3 col-span-2 flex-col justify-center gap-1.5 2xl:order-none 2xl:col-span-1 2xl:!items-start ' + zelle + ' ' + strich + (da || bs ? '' : ' hidden 2xl:flex')}>
                        {da ? baustellen.map((b) => (
                          <div key={b.schluessel} className="w-full min-w-0">
                            <div className="flex min-w-0 items-baseline gap-2">
                              {b.konto_nr && <span className="knr">{b.konto_nr}</span>}
                              <span className="line-clamp-2 text-sm font-semibold leading-snug" title={b.bezeichnung || undefined}>{b.bezeichnung || 'ohne Baustelle'}</span>
                            </div>
                            {(b.fotos > 0 || b.abweichungen.length > 0) && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink3">
                                {b.fotos > 0 && <span className="inline-flex items-center gap-1"><Camera size={12} aria-hidden="true" />{b.fotos} {b.fotos === 1 ? 'Foto' : 'Fotos'}</span>}
                                {b.abweichungen.map((a) => <span key={a.id}>{ABWEICHUNG[a.typ] ?? 'Abweichung'}</span>)}
                              </div>
                            )}
                          </div>
                        )) : bs ? (
                          // Ohne Plan-Eintrag bleibt die Zelle leer — «nichts im Jahresplan» verwirrte Firmen ohne Planung (05.10.2026)
                          <div className="flex w-full min-w-0 items-center gap-2"><span className="knr">{bs.konto_nr}</span><span className="truncate text-sm font-medium text-ink3">{bs.bezeichnung ?? ''} · laut Plan</span></div>
                        ) : <span className="text-[#c9c4bb]">—</span>}
                      </div>

                      {/* Leute */}
                      <div className={'order-4 col-span-2 flex-wrap items-center gap-1.5 md:col-span-1 2xl:order-none ' + zelle + ' ' + strich + (da ? ' flex' : ' hidden')}>
                        {da ? leute.map((p) => {
                          const ue = gelb.has(p.id);
                          return (
                            <span key={p.id} className={'inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-[3px] text-[12.5px] text-ink2 ring-1 ring-inset ' + (ue ? 'ring-amber/45' : 'ring-line')}>
                                                            {kurzName(p.name)} <b className={'font-semibold tabular-nums ' + (ue ? 'text-amber-deep' : 'text-ink')}>{stunden(p.min)}</b>
                            </span>
                          );
                        }) : <span className="text-[#c9c4bb]">—</span>}
                      </div>

                      {/* Status */}
                      <div className={'order-5 col-span-2 md:col-span-1 md:justify-self-end 2xl:order-none 2xl:justify-self-auto ' + zelle + ' ' + strich}>
                        {!da ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-bold text-ink3 ring-[1.5px] ring-inset ring-line-strong"><CircleDashed size={11} strokeWidth={2.5} aria-hidden="true" />noch offen</span>
                        ) : hinweis ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-soft px-2.5 py-[3px] text-xs font-bold text-amber-deep"><TriangleAlert size={11} strokeWidth={2.75} aria-hidden="true" />{ABWEICHUNG_KURZ[abw[0]?.typ ?? ''] ?? 'Hinweis'} · {uhrzeit(zuletzt)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-good-soft px-2.5 py-[3px] text-xs font-bold text-good-deep"><Check size={11} strokeWidth={3} aria-hidden="true" />gemeldet · {uhrzeit(zuletzt)}</span>
                        )}
                      </div>

                      {/* Total — auf dem Handy rechts neben dem Team */}
                      <div className={'order-2 text-right 2xl:order-none 2xl:justify-end ' + zelle + ' ' + strich}>
                        <span className={'whitespace-nowrap font-display text-[20px] font-bold tracking-tight tabular-nums ' + (da ? '' : 'text-[#b3ada3]')}>{da ? `${stunden(total)} h` : '–'}</span>
                      </div>

                      {/* Sprachnotiz direkt unter der Zeile */}
                      {abw.length > 0 && (
                        <>
                          <div className={'hidden 2xl:block ' + rand(!letzte)} />
                          <div className={'order-6 col-span-2 space-y-2 2xl:order-none 2xl:col-span-4 2xl:px-[22px] 2xl:pb-4 ' + rand(!letzte)}>
                            {abw.map((a) => {
                              const m = ms.find((x) => x.id === a.id);
                              const fremd = m?.transkript_sprache && m.transkript_sprache !== 'de';
                              return (
                                <div key={a.id} className="flex items-start gap-3.5 rounded-[14px] border border-amber/35 bg-white px-3 py-2.5 text-[13px] leading-[1.45]">
                                  <div className="min-w-0 flex-1">
                                    <p className="mb-0.5 text-[11.5px] text-ink3">{ABWEICHUNG[a.typ] ?? 'Abweichung'} · {stunden(a.min)} h{a.wer ? ` · ${WER[a.wer] ?? a.wer}` : ''}</p>
                                    {a.transkript
                                      ? <p className="italic text-ink2">«{a.transkript}»</p>
                                      : a.audio_sekunden ? <p className="text-xs text-ink3">Sprachnotiz {a.audio_sekunden} Sek. — Text wird erstellt</p> : null}
                                    {fremd && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink3"><Languages size={12} aria-hidden="true" />aus dem {SPRACHE_ADJ[m!.transkript_sprache!] ?? 'Original'} übersetzt</p>}
                                  </div>
                                  <Link to={wochenLink(t.id, a.id)} onClick={() => zurWoche(t.id)} className="shrink-0 self-center text-xs font-bold text-amber-deep">Prüfen ›</Link>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

const SPRACHE_ADJ: Record<string, string> = { it: 'Italienischen', fr: 'Französischen', es: 'Spanischen', pl: 'Polnischen', pt: 'Portugiesischen', sq: 'Albanischen', ar: 'Arabischen', en: 'Englischen' };

