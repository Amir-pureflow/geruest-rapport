/**
 * Startseite Monteur: «Meine Woche» — die eigenen Stunden, wie auf dem Wochenblatt.
 * Nur lesen. Wer bin ich: einmal Team, dann Person wählen (kein Tippen, CLAUDE.md #2).
 * Korrekturen des Bauführers (freigabe_log) werden am Tag gezeigt — nie versteckt (CLAUDE.md #7).
 */
import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';

const MONTEUR_KEY = 'monteur-id';
/** Zuletzt gewählte Teams auf diesem Gerät — gleiche Liste wie Erfassung/Chefmonteur; auf dem eigenen Handy meist leer. */
const ZULETZT_KEY = 'teamgeraet-zuletzt';

interface Team { id: string; bezeichnung: string }
interface Person { id: string; name: string; funktion: string; typ: string }
interface Eintrag {
  id: string; normal_min: number; ueber_min: number; oev: boolean; km: number; status: string;
  tagesmeldung: { datum: string; normalfall: boolean; baustelle: { konto_nr: string; bezeichnung: string | null } | null; team: { bezeichnung: string } | null };
}
interface Korrektur { zeiteintrag_id: string; feld: 'normal_min' | 'ueber_min'; alt: string | null; neu: string | null; begruendung: string | null; wann: string }

function zuletztLesen(): string[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
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

export function StartMonteur() {
  const [personId, setPersonId] = useState<string | null>(() => localStorage.getItem(MONTEUR_KEY));
  const [person, setPerson] = useState<Person | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [leute, setLeute] = useState<Person[]>([]);
  const [leuteLaden, setLeuteLaden] = useState(false);
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(new Date()));
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [korrekturen, setKorrekturen] = useState<Korrektur[]>([]);
  const [laedt, setLaedt] = useState(true);
  const heuteIso = iso(new Date());
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  // Person laden (oder Auswahl vorbereiten)
  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    if (personId) {
      void c.from('mitarbeiter').select('id,name,funktion,typ').eq('id', personId).maybeSingle().then(({ data }) => {
        if (data) setPerson(data);
        else { localStorage.removeItem(MONTEUR_KEY); setPersonId(null); }
      });
    } else {
      void c.from('team').select('id,bezeichnung').eq('aktiv', true).order('bezeichnung').then(({ data }) => {
        setTeams(((data ?? []) as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
      });
    }
  }, [personId]);

  useEffect(() => {
    if (!supabase || !teamId) { setLeute([]); return; }
    setLeuteLaden(true);
    void supabase.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(id,name,funktion,typ,aktiv)').eq('team_id', teamId).is('bis', null).then(({ data }) => {
      const p = ((data ?? []) as unknown as { mitarbeiter: (Person & { aktiv: boolean }) | null }[]).map((r) => r.mitarbeiter).filter((x): x is Person & { aktiv: boolean } => !!x && x.aktiv);
      setLeute(p.sort((a, b) => a.name.localeCompare(b.name)));
      setLeuteLaden(false);
    });
  }, [teamId]);

  useEffect(() => {
    if (!supabase || !personId) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const { data } = await c
        .from('zeiteintrag')
        .select('id,normal_min,ueber_min,oev,km,status,tagesmeldung:tagesmeldung_id!inner(datum,normalfall,baustelle:baustelle_id(konto_nr,bezeichnung),team:team_id(bezeichnung))')
        .eq('mitarbeiter_id', personId)
        .gte('tagesmeldung.datum', vonIso)
        .lte('tagesmeldung.datum', bisIso);
      const liste = (data ?? []) as unknown as Eintrag[];
      setEintraege(liste);
      // Korrekturen des Bauführers an diesen Einträgen (nur Stundenfelder)
      if (liste.length > 0) {
        const { data: k } = await c.from('freigabe_log').select('zeiteintrag_id,feld,alt,neu,begruendung,wann').in('zeiteintrag_id', liste.map((e) => e.id)).in('feld', ['normal_min', 'ueber_min']).order('wann');
        setKorrekturen((k ?? []) as Korrektur[]);
      } else setKorrekturen([]);
      setLaedt(false);
    })();
  }, [personId, vonIso, bisIso]);

  function waehlen(p: Person) {
    localStorage.setItem(MONTEUR_KEY, p.id);
    setPerson(p);
    setPersonId(p.id);
  }

  // Teamwahl: max. 5 sichtbar (zuletzt genutzte zuerst, sonst die ersten fünf), der Rest in Fünferblöcken hinter «Weitere Teams …»
  const teamAuswahl = useMemo(() => {
    const vorne = zuletztLesen().map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => !!t).slice(0, 5);
    const erste = vorne.length > 0 ? vorne : teams.slice(0, 5);
    const rest = teams.filter((t) => !erste.some((e) => e.id === t.id));
    return { erste, rest };
  }, [teams]);

  const korrekturJeZeit = useMemo(() => korrekturenZusammenfassen(korrekturen), [korrekturen]);

  if (!personId) {
    const teamKnopf = (t: Team) => (
      <button key={t.id} type="button" onClick={() => setTeamId(t.id)} className={'chip py-3 text-base ' + (t.id === teamId ? 'chip-on' : '')}>{t.bezeichnung}</button>
    );
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold">Wer bist du?</h1>
          <p className="text-sm text-ink3">Zuerst dein Team, dann dein Name. Das Gerät merkt es sich.</p>
          <div className="grid grid-cols-2 gap-2">{teamAuswahl.erste.map(teamKnopf)}</div>
          {weitereTeams > 0 && <div className="grid grid-cols-2 gap-2">{teamAuswahl.rest.slice(0, weitereTeams).map(teamKnopf)}</div>}
          {weitereTeams < teamAuswahl.rest.length && (
            <button type="button" onClick={() => setWeitereTeams((n) => n + 5)} className="btn-ghost w-full">Weitere Teams …</button>
          )}
          {teamId && (
            <div className="space-y-2">
              <p className="lbl mb-0">Name</p>
              <div className="grid gap-2">
                {leute.map((p) => (
                  <button key={p.id} type="button" onClick={() => waehlen(p)} className="chip py-3 text-left text-base">{p.name}{p.typ === 'temporaer' ? <span className="ml-1 text-[11px] text-ink3">temp</span> : null}</button>
                ))}
                {leute.length === 0 && <p className="text-sm text-ink3">{leuteLaden ? 'Lädt …' : 'Niemand in diesem Team.'}</p>}
              </div>
            </div>
          )}
          {teams.length === 0 && <p className="card text-sm text-ink3">Keine Teams — als Bauführer unter Verwaltung anlegen oder den Demo-Betrieb laden.</p>}
        </div>
      </Shell>
    );
  }

  const tage = Array.from({ length: 7 }, (_, i) => addTage(wochenStart, i));
  const total = eintraege.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
  const normal = eintraege.reduce((s, e) => s + e.normal_min, 0);
  const ueber = eintraege.reduce((s, e) => s + e.ueber_min, 0);
  const km = eintraege.reduce((s, e) => s + e.km, 0);
  const oevTage = new Set(eintraege.filter((e) => e.oev).map((e) => e.tagesmeldung.datum)).size;
  const alleFrei = eintraege.length > 0 && eintraege.every((e) => e.status === 'freigegeben');
  const offen = eintraege.filter((e) => e.status !== 'freigegeben').length;
  const dieseWoche = vonIso === iso(montag(new Date()));
  const tageMitEintrag = new Set(eintraege.map((e) => e.tagesmeldung.datum)).size;

  return (
    <Shell>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="lbl mb-0.5">Meine Woche</p>
            <h1 className="truncate font-display text-2xl font-semibold">{person?.name ?? '…'}</h1>
          </div>
          <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(MONTEUR_KEY); setPerson(null); setPersonId(null); setTeamId(null); }}>Nicht ich</button>
        </header>

        {/* Wochenwahl: ein Element, wie in der Wochenübersicht */}
        <div className="inline-flex w-full items-stretch overflow-hidden rounded-xl border border-line-strong bg-surface">
          <button type="button" className="px-4 text-ink2 transition-colors hover:bg-surface-2" onClick={() => setWochenStart(addTage(wochenStart, -7))} aria-label="Vorwoche">‹</button>
          <span className="flex-1 border-x border-line px-3 py-2 text-center text-sm">
            <span className="font-semibold">KW {kw(wochenStart)}</span>
            <span className="text-ink3"> · {kurz(wochenStart)} – {kurz(addTage(wochenStart, 6))}{dieseWoche ? ' · jetzt' : ''}</span>
          </span>
          <button type="button" className="px-4 text-ink2 transition-colors hover:bg-surface-2 disabled:opacity-30" disabled={dieseWoche || bisIso >= heuteIso} onClick={() => setWochenStart(addTage(wochenStart, 7))} aria-label="nächste Woche">›</button>
        </div>

        {/* Die Summe zuoberst — das ist die Zahl, die der Monteur wissen will */}
        {!laedt && (
          <section className="card">
            <div className="space-y-2.5">
              <div>
                <p className="font-mono text-[34px] font-semibold leading-none tabular-nums">{stunden(total)} <span className="text-lg font-medium text-ink3">h</span></p>
                <p className="mt-1.5 text-sm text-ink2">
                  {stunden(normal)} h normal
                  {ueber > 0 && <> + <span className="font-semibold text-amber-deep">{stunden(ueber)} h Überstunden</span></>}
                  {tageMitEintrag > 0 && <span className="text-ink3"> · {tageMitEintrag} {tageMitEintrag === 1 ? 'Tag' : 'Tage'}</span>}
                </p>
                {(km > 0 || oevTage > 0) && (
                  <p className="mt-0.5 text-xs text-ink3">{km > 0 ? `${km} km Anreise` : ''}{km > 0 && oevTage > 0 ? ' · ' : ''}{oevTage > 0 ? `öV an ${oevTage} ${oevTage === 1 ? 'Tag' : 'Tagen'}` : ''}</p>
                )}
              </div>
              {eintraege.length > 0 && (
                alleFrei
                  ? <span className="inline-block rounded-full bg-good-soft px-3 py-1 text-xs font-semibold text-good-deep">✓ vom Bauführer angeschaut</span>
                  : <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-ink2">{offen === eintraege.length ? 'noch nicht vom Bauführer angeschaut' : `${offen} Einträge noch nicht angeschaut`}</span>
              )}
            </div>
          </section>
        )}

        {/* Ein Tag = eine Karte. Zukunft und leere Wochenenden bleiben weg — weniger Zeilen, mehr Ruhe. */}
        <div className="space-y-2">
          {tage.map((d, i) => {
            const dIso = iso(d);
            const es = eintraege.filter((e) => e.tagesmeldung.datum === dIso);
            const zukunft = dIso > heuteIso;
            if (zukunft) return null;
            if (es.length === 0 && i >= 5) return null;
            const tagMin = es.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
            const tagUeber = es.reduce((s, e) => s + e.ueber_min, 0);
            const tagFrei = es.length > 0 && es.every((e) => e.status === 'freigegeben');
            return (
              <div key={dIso} className={'card flex gap-3 px-4 py-3 ' + (es.length === 0 ? 'bg-surface/60' : '')}>
                <div className="w-11 shrink-0 text-center">
                  <span className={'block text-[15px] font-semibold ' + (dIso === heuteIso ? 'text-accent-deep' : '')}>{WOCHENTAGE[i]}</span>
                  <span className="block text-[11px] tabular-nums text-ink3">{kurz(d)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {es.length === 0 ? (
                    <p className="py-1 text-sm text-ink3">nichts gemeldet</p>
                  ) : (
                    <>
                      {es.map((e) => {
                        const korr = korrekturJeZeit.get(e.id) ?? [];
                        return (
                          <div key={e.id} className="space-y-1">
                            <p className="text-sm font-medium leading-snug">
                              {e.tagesmeldung.baustelle?.bezeichnung ?? 'Baustelle'}
                              {e.tagesmeldung.baustelle && <span className="knr ml-1.5 align-middle">{e.tagesmeldung.baustelle.konto_nr}</span>}
                            </p>
                            <p className="text-xs text-ink3">
                              {stunden(e.normal_min)} h normal
                              {e.ueber_min > 0 && <> + <span className="font-semibold text-amber-deep">{stunden(e.ueber_min)} h Überstunden</span></>}
                              {e.oev ? ' · öV' : e.km > 0 ? ` · ${e.km} km` : ''}
                            </p>
                            {korr.length > 0 && (
                              <div className="rounded-[8px] bg-amber-soft px-2.5 py-1.5 text-xs text-amber-deep">
                                <p className="font-semibold">Bauführer hat angepasst{korr[0].grund ? ` · ${korr[0].grund}` : ''}</p>
                                {korr.map((k, j) => (
                                  <p key={j}>{k.feld === 'ueber_min' ? 'Überstunden' : 'Normal'}: {stunden(k.alt)} → {stunden(k.neu)} h</p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
                {es.length > 0 && (
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[17px] font-semibold tabular-nums">{stunden(tagMin)} h</p>
                    {tagUeber > 0 && <p className="text-[10px] text-amber-deep">inkl. Überstunden</p>}
                    <p className={'mt-0.5 text-[11px] font-medium ' + (tagFrei ? 'text-good-deep' : 'text-ink3')}>{tagFrei ? '✓ angeschaut' : 'offen'}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {laedt ? (
          <p className="text-sm text-ink3">lädt …</p>
        ) : (
          <p className="text-xs text-ink3">«✓ angeschaut» heisst: der Bauführer hat die Stunden geprüft. Stimmt etwas nicht, sag es deinem Chefmonteur.</p>
        )}
      </div>
    </Shell>
  );
}
