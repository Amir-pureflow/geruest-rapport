/**
 * Tagesübersicht für den Bauführer: Welche Teams haben heute gemeldet, welche nicht?
 * Ziel der Kachel «x/20 Teams haben heute gemeldet» auf der Startseite.
 * Zeigt nur, was gemeldet wurde und was laut Jahresplan vorgesehen war — keine Urteile (CLAUDE.md #1).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, stunden, WOCHENTAGE } from '../lib/datum';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Meldung {
  id: string; team_id: string; normalfall: boolean; abweichung_typ: string | null; erfasst_am: string;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: { normal_min: number; ueber_min: number }[];
}
interface Plan { team_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzlich', warten: 'gewartet', kaputt: 'etwas kaputt' };

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
  const tagIso = iso(datum);
  const heuteIso = iso(new Date());

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const [t, m, p] = await Promise.all([
        c.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).order('bezeichnung'),
        c.from('tagesmeldung').select('id,team_id,normalfall,abweichung_typ,erfasst_am,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min)').eq('datum', tagIso).order('erfasst_am'),
        c.from('jahresplan').select('team_id,baustelle:baustelle_id(konto_nr,bezeichnung)').lte('von', tagIso).gte('bis', tagIso),
      ]);
      setTeams((t.data ?? []) as unknown as Team[]);
      setMeldungen((m.data ?? []) as unknown as Meldung[]);
      setPlan((p.data ?? []) as unknown as Plan[]);
      setLaedt(false);
    })();
  }, [tagIso]);

  const proTeam = new Map<string, Meldung[]>();
  for (const m of meldungen) proTeam.set(m.team_id, [...(proTeam.get(m.team_id) ?? []), m]);
  const gemeldet = teams.filter((t) => proTeam.has(t.id));
  const offen = teams.filter((t) => !proTeam.has(t.id));
  const planFuer = (teamId: string) => plan.find((p) => p.team_id === teamId)?.baustelle ?? null;
  const wochenende = datum.getDay() === 0 || datum.getDay() === 6;

  function zurWoche(teamId: string) {
    localStorage.setItem('cockpit-team', teamId);
  }

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <Link to="/" className="text-xs font-semibold text-steel">‹ Start</Link>
            <h1 className="font-display text-2xl font-bold">{lang(datum)}</h1>
            <p className="text-sm text-ink3">
              {laedt ? 'lädt …' : `${gemeldet.length} von ${teams.length} Teams haben gemeldet`}
              {wochenende && !laedt ? ' · Wochenende' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost px-3" onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück">◀</button>
            <span className="font-mono text-xs text-ink3">{WOCHENTAGE[(datum.getDay() + 6) % 7]} {kurz(datum)}</span>
            <button type="button" className="btn-ghost px-3" disabled={tagIso >= heuteIso} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor">▶</button>
          </div>
        </header>

        {!laedt && offen.length > 0 && (
          <section className="space-y-2">
            <p className="lbl">Noch nichts gemeldet — {offen.length}</p>
            {offen.map((t) => {
              const bs = planFuer(t.id);
              return (
                <div key={t.id} className="card flex items-center justify-between gap-3 border-accent/30">
                  <div className="min-w-0">
                    <p className="font-display font-bold">{t.bezeichnung} <span className="font-body text-sm font-normal text-ink3">· {t.chefmonteur?.name ?? 'kein Chefmonteur'}</span></p>
                    <p className="truncate text-sm text-ink3">
                      {bs ? <>laut Plan: <span className="knr">{bs.konto_nr}</span> {bs.bezeichnung ?? ''}</> : 'heute nichts im Jahresplan'}
                    </p>
                  </div>
                  <Link to="/cockpit" onClick={() => zurWoche(t.id)} className="btn-ghost shrink-0 text-xs">Woche ›</Link>
                </div>
              );
            })}
          </section>
        )}

        {!laedt && gemeldet.length > 0 && (
          <section className="space-y-2">
            <p className="lbl">Gemeldet — {gemeldet.length}</p>
            {gemeldet.map((t) => {
              const ms = proTeam.get(t.id) ?? [];
              const total = ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
              const leute = new Set(ms.flatMap((m) => m.zeiteintrag)).size;
              return (
                <div key={t.id} className="card space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display font-bold">{t.bezeichnung} <span className="font-body text-sm font-normal text-ink3">· {t.chefmonteur?.name ?? ''}</span></p>
                    <span className="font-mono text-sm tabular-nums">{stunden(total)} h · {leute} Pers.</span>
                  </div>
                  {ms.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-ink3">{uhrzeit(m.erfasst_am)}</span>
                      {m.baustelle && <><span className="knr">{m.baustelle.konto_nr}</span><span className="truncate text-ink2">{m.baustelle.bezeichnung ?? ''}</span></>}
                      {m.normalfall
                        ? <span className="chip bg-good-soft text-good-deep">wie geplant</span>
                        : <span className="chip bg-amber-100 text-amber-900">{ABWEICHUNG[m.abweichung_typ ?? ''] ?? 'Abweichung'}</span>}
                    </div>
                  ))}
                  <div className="text-right">
                    <Link to="/cockpit" onClick={() => zurWoche(t.id)} className="text-xs font-semibold text-steel">Woche prüfen ›</Link>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {!laedt && teams.length === 0 && <p className="text-sm text-ink3">Keine Teams angelegt — Verwaltung → Teams.</p>}
      </div>
    </Shell>
  );
}
