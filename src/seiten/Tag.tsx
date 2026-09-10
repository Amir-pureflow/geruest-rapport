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
  zeiteintrag: { normal_min: number; ueber_min: number; mitarbeiter_id: string }[];
}
interface Plan { team_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzlich', warten: 'gewartet', kaputt: 'etwas kaputt' };

/** Meldungen eines Teams nach Baustelle bündeln: normale Stunden + Abweichungen je Art. */
function proBaustelle(ms: Meldung[]) {
  const map = new Map<string, { schluessel: string; konto_nr: string | null; bezeichnung: string; zuletzt: string; normalMin: number; abweichungen: { typ: string; min: number }[] }>();
  for (const m of ms) {
    const schluessel = m.baustelle?.konto_nr ?? 'ohne';
    const b = map.get(schluessel) ?? { schluessel, konto_nr: m.baustelle?.konto_nr ?? null, bezeichnung: m.baustelle?.bezeichnung ?? '', zuletzt: m.erfasst_am, normalMin: 0, abweichungen: [] };
    const min = m.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
    if (m.normalfall) b.normalMin += min;
    else {
      const typ = m.abweichung_typ ?? 'abweichung';
      const a = b.abweichungen.find((x) => x.typ === typ);
      if (a) a.min += min; else b.abweichungen.push({ typ, min });
    }
    if (m.erfasst_am > b.zuletzt) b.zuletzt = m.erfasst_am;
    map.set(schluessel, b);
  }
  return [...map.values()];
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
  const tagIso = iso(datum);
  const heuteIso = iso(new Date());

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const [t, m, p] = await Promise.all([
        c.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).order('bezeichnung'),
        c.from('tagesmeldung').select('id,team_id,normalfall,abweichung_typ,erfasst_am,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,mitarbeiter_id)').eq('datum', tagIso).order('erfasst_am'),
        c.from('jahresplan').select('team_id,baustelle:baustelle_id(konto_nr,bezeichnung)').lte('von', tagIso).gte('bis', tagIso),
      ]);
      setTeams(((t.data ?? []) as unknown as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
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
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="lbl mb-0.5">Tagesübersicht</p>
            <h1 className="font-display text-2xl font-semibold">{lang(datum)}</h1>
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
                    <p className="font-display font-semibold">{t.bezeichnung} <span className="font-body text-sm font-normal text-ink3">· {t.chefmonteur?.name ?? 'kein Chefmonteur'}</span></p>
                    <p className="truncate text-sm text-ink3">
                      {bs ? <>laut Plan: <span className="knr">{bs.konto_nr}</span> {bs.bezeichnung ?? ''}</> : 'heute nichts im Jahresplan'}
                    </p>
                  </div>
                  <Link to={`/cockpit?woche=${tagIso}&tag=${tagIso}&team=${t.id}`} onClick={() => zurWoche(t.id)} className="btn-ghost shrink-0 text-xs">Woche ›</Link>
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
              // Personen, nicht Einträge: normaler Tag + Abweichung sind zwei Meldungen derselben Leute
              const leute = new Set(ms.flatMap((m) => m.zeiteintrag.map((z) => z.mitarbeiter_id))).size;
              return (
                <div key={t.id} className="card space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display font-semibold">{t.bezeichnung} <span className="font-body text-sm font-normal text-ink3">· {t.chefmonteur?.name ?? ''}</span></p>
                    <span className="font-mono text-sm tabular-nums">{stunden(total)} h · {leute} Pers.</span>
                  </div>
                  {/* Eine Zeile pro Baustelle: normaler Tag + Abweichung sind zwei Meldungen derselben Leute am selben Ort */}
                  {proBaustelle(ms).map((b) => (
                    <div key={b.schluessel} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-ink3">{uhrzeit(b.zuletzt)}</span>
                      {b.konto_nr && <><span className="knr">{b.konto_nr}</span><span className="truncate text-ink2">{b.bezeichnung}</span></>}
                      {b.normalMin > 0 && <span className="chip bg-good-soft py-1 text-xs text-good-deep">wie geplant · {stunden(b.normalMin)} h</span>}
                      {b.abweichungen.map((a) => (
                        <span key={a.typ} className="chip bg-amber-soft py-1 text-xs text-amber-deep">{ABWEICHUNG[a.typ] ?? 'Abweichung'} · {stunden(a.min)} h</span>
                      ))}
                    </div>
                  ))}
                  <div className="text-right">
                    <Link to={`/cockpit?woche=${tagIso}&tag=${tagIso}&team=${t.id}`} onClick={() => zurWoche(t.id)} className="text-xs font-semibold text-steel">Woche prüfen ›</Link>
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
