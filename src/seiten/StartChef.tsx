/**
 * Startseite Chefmonteur: das eigene Team, der heutige Tag, die laufende Woche.
 * Ein Knopf («Tag melden») führt in die Erfassung; das Team ist dasselbe wie dort (TEAM_KEY).
 * Zeigt nur, was gemeldet und was bestellt ist — keine Urteile (CLAUDE.md #1).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl } from '../lib/db';

export const TEAM_KEY = 'teamgeraet-team-id';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Meldung {
  id: string; datum: string; normalfall: boolean; abweichung_typ: string | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: { normal_min: number; ueber_min: number; status: string }[];
}
interface Plan { von: string; bis: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null }
interface Auftrag { id: string; baustelle_id: string; taetigkeit: string; besteller_name: string; geplant_fuer: string | null; stand: string }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzlich gearbeitet', warten: 'gewartet', kaputt: 'etwas kaputt' };

export function StartChef() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [leute, setLeute] = useState<string[]>([]);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const [auftraege, setAuftraege] = useState<Auftrag[]>([]);
  const [wartend, setWartend] = useState(0);
  const [laedt, setLaedt] = useState(true);
  const heute = new Date();
  const heuteIso = iso(heute);
  const wochenStart = montag(heute);
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));
  const team = teams.find((t) => t.id === teamId) ?? null;

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).order('bezeichnung').then(({ data }) => {
      const s = ((data ?? []) as unknown as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
      setTeams(s);
      const gespeichert = localStorage.getItem(TEAM_KEY);
      if (gespeichert && !s.some((t) => t.id === gespeichert)) { localStorage.removeItem(TEAM_KEY); setTeamId(null); }
    });
  }, []);

  const laden = useCallback(async () => {
    if (!supabase || !teamId) return;
    const c = supabase;
    setLaedt(true);
    if (navigator.onLine) await flushNachSupabase(c);
    setWartend(await offeneAnzahl());
    const [mg, m, p] = await Promise.all([
      c.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(name,aktiv)').eq('team_id', teamId).is('bis', null),
      c.from('tagesmeldung').select('id,datum,normalfall,abweichung_typ,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,status)').eq('team_id', teamId).gte('datum', vonIso).lte('datum', bisIso).order('datum'),
      c.from('jahresplan').select('von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).lte('von', bisIso).gte('bis', vonIso),
    ]);
    setLeute(((mg.data ?? []) as unknown as { mitarbeiter: { name: string; aktiv: boolean } | null }[]).map((r) => r.mitarbeiter).filter((x): x is { name: string; aktiv: boolean } => !!x && x.aktiv).map((x) => x.name).sort());
    setMeldungen((m.data ?? []) as unknown as Meldung[]);
    const planRows = (p.data ?? []) as unknown as Plan[];
    setPlan(planRows);
    const baustellen = planRows.map((r) => r.baustelle?.id).filter((x): x is string => !!x);
    if (baustellen.length > 0) {
      const { data: a } = await c.from('zusatzauftrag_stand').select('id,baustelle_id,taetigkeit,besteller_name,geplant_fuer,stand').in('baustelle_id', baustellen).in('stand', ['bestellt', 'gemeldet']).order('geplant_fuer');
      setAuftraege((a ?? []) as Auftrag[]);
    } else setAuftraege([]);
    setLaedt(false);
  }, [teamId, vonIso, bisIso]);
  useEffect(() => { void laden(); }, [laden]);

  function teamWaehlen(id: string) {
    localStorage.setItem(TEAM_KEY, id);
    setTeamId(id);
  }

  if (!teamId || (teams.length > 0 && !team)) {
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-bold">Welches Team?</h1>
          <p className="text-sm text-ink3">Einmal wählen — das Gerät merkt es sich. Das ist dann auch das Team in der Erfassung.</p>
          <div className="grid grid-cols-2 gap-2">
            {teams.map((t) => (
              <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                {t.bezeichnung}
                {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
              </button>
            ))}
          </div>
          {teams.length === 0 && <p className="card text-sm text-ink3">Keine Teams — als Bauführer unter Verwaltung anlegen oder den Demo-Betrieb laden.</p>}
        </div>
      </Shell>
    );
  }

  const heutige = meldungen.filter((m) => m.datum === heuteIso);
  const planHeute = plan.find((p) => p.von <= heuteIso && p.bis >= heuteIso)?.baustelle ?? null;
  const tage = Array.from({ length: 7 }, (_, i) => addTage(wochenStart, i));
  const wochenTotal = meldungen.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0);
  const baustelleName = (id: string) => plan.find((p) => p.baustelle?.id === id)?.baustelle;

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="lbl mb-0.5">Chefmonteur</p>
            <h1 className="font-display text-2xl font-bold">{team?.bezeichnung ?? 'Team'}</h1>
            <p className="text-sm text-ink3">
              {team?.chefmonteur?.name ?? 'kein Chefmonteur hinterlegt'}{leute.length > 0 ? ` · ${leute.length} Personen` : ''}{team?.fahrzeug ? ` · ${team.fahrzeug}` : ''}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(TEAM_KEY); setTeamId(null); }}>Team wechseln</button>
        </header>

        {wartend > 0 && (
          <div className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            <strong>{wartend} Meldung{wartend === 1 ? '' : 'en'} auf diesem Gerät noch nicht gesendet.</strong> Wird gesendet, sobald Netz da ist.
          </div>
        )}

        <section className="card space-y-2">
          <p className="lbl mb-0">Heute · {lang(heute)}</p>
          {planHeute
            ? <p className="text-sm text-ink2">Laut Plan: <span className="knr">{planHeute.konto_nr}</span> {planHeute.bezeichnung ?? ''}</p>
            : <p className="text-sm text-ink3">Heute nichts im Jahresplan — in der Erfassung die Baustelle wählen.</p>}
          {heutige.length > 0 ? (
            <div className="rounded-[10px] border border-good/40 bg-good-soft px-3 py-2 text-sm text-good-deep">
              <strong>Heute gemeldet</strong>
              {heutige.map((m) => (
                <span key={m.id} className="block">
                  {m.baustelle?.bezeichnung ?? 'Baustelle'} · {stunden(m.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0))} h · {m.normalfall ? 'wie geplant' : ABWEICHUNG[m.abweichung_typ ?? ''] ?? 'Abweichung'}
                </span>
              ))}
            </div>
          ) : null}
          <Link to="/erfassung" className={heutige.length > 0 ? 'btn-ghost block w-full text-center' : 'cta'}>
            {heutige.length > 0 ? 'Nochmals melden oder ändern' : 'Tag melden'}
          </Link>
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="lbl mb-0">Diese Woche</p>
            <span className="font-mono text-xs text-ink3">{stunden(wochenTotal)} h total</span>
          </div>
          <div className="card divide-y divide-line p-0">
            {tage.map((d, i) => {
              const dIso = iso(d);
              const ms = meldungen.filter((m) => m.datum === dIso);
              const zukunft = dIso > heuteIso;
              const geplant = plan.find((p) => p.von <= dIso && p.bis >= dIso)?.baustelle ?? null;
              return (
                <div key={dIso} className={'flex items-center gap-3 px-4 py-2 text-sm ' + (zukunft ? 'text-ink3' : '')}>
                  <span className="w-16 shrink-0 whitespace-nowrap font-mono text-xs">{WOCHENTAGE[i]} {kurz(d)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {ms.length > 0
                      ? ms.map((m) => m.baustelle?.bezeichnung ?? 'Baustelle').join(', ')
                      : geplant ? <span className="text-ink3">{geplant.bezeichnung ?? geplant.konto_nr}</span> : <span className="text-ink3">—</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {ms.length > 0 ? `${stunden(ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0))} h` : ''}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[11px]">
                    {ms.length > 0
                      ? ms.some((m) => m.zeiteintrag.some((z) => z.status === 'freigegeben')) ? <span className="text-good-deep">freigegeben</span>
                        : ms.every((m) => m.normalfall) ? <span className="text-good-deep">gemeldet</span> : <span className="text-amber-900">Abweichung</span>
                      : zukunft ? '' : i >= 5 ? '' : <span className="text-ink3">nichts</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">«freigegeben» heisst: der Bauführer hat die Stunden angeschaut. Änderungen bitte ihm sagen.</p>
        </section>

        {auftraege.length > 0 && (
          <section className="space-y-2">
            <p className="lbl mb-0">Vom Kunden bestellt — auf euren Baustellen</p>
            {auftraege.map((a) => {
              const b = baustelleName(a.baustelle_id);
              return (
                <div key={a.id} className="card space-y-0.5 py-3">
                  <p className="text-sm font-semibold">{a.taetigkeit}</p>
                  <p className="text-xs text-ink3">
                    {b ? <><span className="knr">{b.konto_nr}</span> {b.bezeichnung ?? ''} · </> : null}
                    bestellt von {a.besteller_name}{a.geplant_fuer ? ` · geplant ${kurz(new Date(a.geplant_fuer + 'T12:00:00'))}` : ''}
                    {a.stand === 'gemeldet' ? ' · schon gemeldet' : ''}
                  </p>
                </div>
              );
            })}
            <p className="text-[11px] text-ink3">Wenn ihr das macht: am Abend «zusätzlich gearbeitet» melden, mit Bild. So wird es Regie.</p>
          </section>
        )}

        {laedt && <p className="text-center text-xs text-ink3">lädt …</p>}
      </div>
    </Shell>
  );
}
