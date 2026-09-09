/**
 * Startseite Monteur: «Meine Woche» — die eigenen Stunden, wie auf dem Wochenblatt.
 * Nur lesen. Wer bin ich: einmal Team, dann Person wählen (kein Tippen, CLAUDE.md #2).
 */
import { useEffect, useState } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';

const MONTEUR_KEY = 'monteur-id';

interface Team { id: string; bezeichnung: string }
interface Person { id: string; name: string; funktion: string; typ: string }
interface Eintrag {
  id: string; normal_min: number; ueber_min: number; oev: boolean; km: number; status: string;
  tagesmeldung: { datum: string; normalfall: boolean; baustelle: { konto_nr: string; bezeichnung: string | null } | null; team: { bezeichnung: string } | null };
}

export function StartMonteur() {
  const [personId, setPersonId] = useState<string | null>(() => localStorage.getItem(MONTEUR_KEY));
  const [person, setPerson] = useState<Person | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [leute, setLeute] = useState<Person[]>([]);
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(new Date()));
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
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
    void supabase.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(id,name,funktion,typ,aktiv)').eq('team_id', teamId).is('bis', null).then(({ data }) => {
      const p = ((data ?? []) as unknown as { mitarbeiter: (Person & { aktiv: boolean }) | null }[]).map((r) => r.mitarbeiter).filter((x): x is Person & { aktiv: boolean } => !!x && x.aktiv);
      setLeute(p.sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, [teamId]);

  useEffect(() => {
    if (!supabase || !personId) return;
    setLaedt(true);
    void supabase
      .from('zeiteintrag')
      .select('id,normal_min,ueber_min,oev,km,status,tagesmeldung:tagesmeldung_id!inner(datum,normalfall,baustelle:baustelle_id(konto_nr,bezeichnung),team:team_id(bezeichnung))')
      .eq('mitarbeiter_id', personId)
      .gte('tagesmeldung.datum', vonIso)
      .lte('tagesmeldung.datum', bisIso)
      .then(({ data }) => { setEintraege((data ?? []) as unknown as Eintrag[]); setLaedt(false); });
  }, [personId, vonIso, bisIso]);

  function waehlen(p: Person) {
    localStorage.setItem(MONTEUR_KEY, p.id);
    setPerson(p);
    setPersonId(p.id);
  }

  if (!personId) {
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-bold">Wer bist du?</h1>
          <p className="text-sm text-ink3">Zuerst dein Team, dann dein Name. Das Gerät merkt es sich.</p>
          <div className="grid grid-cols-2 gap-2">
            {teams.map((t) => (
              <button key={t.id} type="button" onClick={() => setTeamId(t.id)} className={'chip py-3 text-base ' + (t.id === teamId ? 'chip-on' : '')}>{t.bezeichnung}</button>
            ))}
          </div>
          {teamId && (
            <div className="space-y-2">
              <p className="lbl mb-0">Name</p>
              <div className="grid gap-2">
                {leute.map((p) => (
                  <button key={p.id} type="button" onClick={() => waehlen(p)} className="chip py-3 text-left text-base">{p.name}{p.typ === 'temporaer' ? <span className="ml-1 text-[11px] text-ink3">temp</span> : null}</button>
                ))}
                {leute.length === 0 && <p className="text-sm text-ink3">Niemand in diesem Team.</p>}
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
  const alleFrei = eintraege.length > 0 && eintraege.every((e) => e.status === 'freigegeben');

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="lbl mb-0.5">Monteur</p>
            <h1 className="font-display text-2xl font-bold">{person?.name ?? '…'}</h1>
            <p className="text-sm text-ink3">Meine Woche · KW {kw(wochenStart)}</p>
          </div>
          <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(MONTEUR_KEY); setPerson(null); setPersonId(null); setTeamId(null); }}>Nicht ich</button>
        </header>

        <div className="flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))}>‹</button>
          <span className="font-mono text-xs text-ink2">{kurz(wochenStart)} – {kurz(addTage(wochenStart, 6))}{vonIso === iso(montag(new Date())) ? ' · diese Woche' : ''}</span>
          <button type="button" className="btn-ghost" disabled={bisIso >= heuteIso && vonIso >= iso(montag(new Date()))} onClick={() => setWochenStart(addTage(wochenStart, 7))}>›</button>
        </div>

        <div className="card divide-y divide-line p-0">
          {tage.map((d, i) => {
            const dIso = iso(d);
            const es = eintraege.filter((e) => e.tagesmeldung.datum === dIso);
            const zukunft = dIso > heuteIso;
            return (
              <div key={dIso} className={'px-4 py-2 text-sm ' + (zukunft ? 'text-ink3' : '')}>
                <div className="flex items-center gap-3">
                  <span className="w-16 shrink-0 whitespace-nowrap font-mono text-xs">{WOCHENTAGE[i]} {kurz(d)}</span>
                  <span className="min-w-0 flex-1">
                    {es.length === 0 && <span className="text-ink3">{zukunft || i >= 5 ? '—' : 'nichts gemeldet'}</span>}
                    {es.map((e) => (
                      <span key={e.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {e.tagesmeldung.baustelle ? <><span className="knr">{e.tagesmeldung.baustelle.konto_nr}</span> {e.tagesmeldung.baustelle.bezeichnung ?? ''}</> : 'Baustelle'}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums">
                          {stunden(e.normal_min + e.ueber_min)} h{e.ueber_min > 0 ? <span className="text-ink3"> ({stunden(e.ueber_min)} über)</span> : null}
                          {e.status === 'freigegeben' ? <span className="ml-1 text-good" title="freigegeben">✓</span> : null}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="font-display font-bold">Total</span>
            <span className="font-mono tabular-nums">
              <strong>{stunden(total)} h</strong>{ueber > 0 ? <span className="text-ink3"> · {stunden(ueber)} über</span> : null}{km > 0 ? <span className="text-ink3"> · {km} km</span> : null}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-ink3">
          {laedt ? 'lädt …' : alleFrei ? 'Alles vom Bauführer angeschaut (✓).' : '✓ = vom Bauführer angeschaut. Stimmt etwas nicht? Sag es deinem Chefmonteur oder dem Bauführer — hier kann man nichts ändern.'}
        </p>
      </div>
    </Shell>
  );
}
