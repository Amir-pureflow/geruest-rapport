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
  const ueber = eintraege.reduce((s, e) => s + e.ueber_min, 0);
  const km = eintraege.reduce((s, e) => s + e.km, 0);
  const oevTage = new Set(eintraege.filter((e) => e.oev).map((e) => e.tagesmeldung.datum)).size;
  const alleFrei = eintraege.length > 0 && eintraege.every((e) => e.status === 'freigegeben');

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="lbl mb-0.5">Monteur</p>
            <h1 className="font-display text-2xl font-semibold">{person?.name ?? '…'}</h1>
            <p className="text-sm text-ink3">Meine Woche · KW {kw(wochenStart)}</p>
          </div>
          <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(MONTEUR_KEY); setPerson(null); setPersonId(null); setTeamId(null); }}>Nicht ich</button>
        </header>

        <div className="flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))} aria-label="Vorwoche">‹</button>
          <span className="font-mono text-xs text-ink2">{kurz(wochenStart)} – {kurz(addTage(wochenStart, 6))}{vonIso === iso(montag(new Date())) ? ' · diese Woche' : ''}</span>
          <button type="button" className="btn-ghost" disabled={bisIso >= heuteIso && vonIso >= iso(montag(new Date()))} onClick={() => setWochenStart(addTage(wochenStart, 7))} aria-label="nächste Woche">›</button>
        </div>

        <div className="card divide-y divide-line p-0">
          {tage.map((d, i) => {
            const dIso = iso(d);
            const es = eintraege.filter((e) => e.tagesmeldung.datum === dIso);
            const zukunft = dIso > heuteIso;
            return (
              <div key={dIso} className={'px-4 py-2 text-sm ' + (zukunft ? 'text-ink3' : '')}>
                <div className="flex items-start gap-3">
                  <span className="w-16 shrink-0 whitespace-nowrap font-mono text-xs leading-6">{WOCHENTAGE[i]} {kurz(d)}</span>
                  <span className="min-w-0 flex-1">
                    {es.length === 0 && <span className="leading-6 text-ink3">{zukunft || i >= 5 ? '—' : 'nichts gemeldet'}</span>}
                    {es.map((e) => {
                      const korr = korrekturJeZeit.get(e.id) ?? [];
                      return (
                        <span key={e.id} className="block">
                          <span className="flex items-center justify-between gap-2 leading-6">
                            <span className="min-w-0 truncate">
                              {e.tagesmeldung.baustelle ? <><span className="knr">{e.tagesmeldung.baustelle.konto_nr}</span> {e.tagesmeldung.baustelle.bezeichnung ?? ''}</> : 'Baustelle'}
                            </span>
                            <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-ink3">
                              {e.oev ? 'öV' : e.km > 0 ? `${e.km} km` : ''}
                            </span>
                            <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums">
                              {stunden(e.normal_min + e.ueber_min)} h
                              {e.status === 'freigegeben' ? <span className="ml-1 text-good" title="vom Bauführer angeschaut">✓</span> : <span className="ml-1 opacity-0">✓</span>}
                            </span>
                          </span>
                          {e.ueber_min > 0 && <span className="block text-right text-[11px] text-ink3">davon {stunden(e.ueber_min)} h Überstunden</span>}
                          {korr.map((k, j) => (
                            <span key={j} className="block text-xs text-amber-deep">
                              vom Bauführer angepasst: {k.feld === 'ueber_min' ? 'Überstunden ' : ''}{stunden(k.alt)} → {stunden(k.neu)} h
                              {k.grund ? <span className="text-ink2"> · Grund: {k.grund}</span> : null}
                            </span>
                          ))}
                        </span>
                      );
                    })}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="font-display font-semibold">Total</span>
            <span className="flex items-center gap-2 font-mono tabular-nums">
              <span className="w-24 text-right text-xs text-ink3">
                {oevTage > 0 ? `öV ${oevTage}×` : ''}{oevTage > 0 && km > 0 ? ' · ' : ''}{km > 0 ? `${km} km` : ''}
              </span>
              <span className="w-20 text-right"><strong>{stunden(total)} h</strong></span>
            </span>
          </div>
          {ueber > 0 && <p className="px-4 pb-2 text-right text-[11px] text-ink3">davon {stunden(ueber)} h Überstunden</p>}
        </div>

        {laedt ? (
          <p className="text-sm text-ink3">lädt …</p>
        ) : (
          <p className="text-sm text-ink2">
            {alleFrei ? 'Alles vom Bauführer angeschaut (✓). ' : '✓ heisst: der Bauführer hat die Stunden angeschaut. '}
            Stimmt etwas nicht, sag es deinem Chefmonteur.
          </p>
        )}
      </div>
    </Shell>
  );
}
