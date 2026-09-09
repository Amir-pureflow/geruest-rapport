/**
 * Startseite Chefmonteur: das eigene Team, der heutige Tag, die laufende Woche (Vorwochen erreichbar).
 * Ein Knopf («Tag melden») führt in die Erfassung; das Team ist dasselbe wie dort (TEAM_KEY).
 * Zeigt nur, was gemeldet und was bestellt ist — keine Urteile (CLAUDE.md #1).
 * Meldungen, die noch auf dem Gerät warten, erscheinen in der Woche mit «wartet auf Netz» (CLAUDE.md #4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, lang, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { flushNachSupabase, offeneAnzahl, offeneMeldungen, type MeldungPayload } from '../lib/db';

export const TEAM_KEY = 'teamgeraet-team-id';
/** Zuletzt gewählte Teams auf diesem Gerät (max. 5, neuestes vorne) — gleiche Liste wie in der Erfassung. */
const ZULETZT_KEY = 'teamgeraet-zuletzt';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur: { name: string } | null }
interface Zeit { id: string; normal_min: number; ueber_min: number; status: string; mitarbeiter: { name: string } | null }
interface Meldung {
  id: string; datum: string; normalfall: boolean; abweichung_typ: string | null;
  baustelle: { konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: Zeit[];
  /** true = liegt noch in der Warteschlange auf diesem Gerät */
  lokal: boolean;
}
interface Plan { von: string; bis: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null }
interface Auftrag { id: string; baustelle_id: string; taetigkeit: string; besteller_name: string; geplant_fuer: string | null; stand: string }
/** Eine Korrektur des Bauführers an den Stunden (freigabe_log, Felder normal_min / ueber_min). */
interface Korrektur { zeiteintrag_id: string; feld: 'normal_min' | 'ueber_min'; alt: string | null; neu: string | null; begruendung: string | null; wann: string }

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzlich gearbeitet', warten: 'gewartet', kaputt: 'etwas kaputt' };

function zuletztLesen(): string[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function zuletztMerken(id: string): string[] {
  const liste = [id, ...zuletztLesen().filter((x) => x !== id)].slice(0, 5);
  localStorage.setItem(ZULETZT_KEY, JSON.stringify(liste));
  return liste;
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

export function StartChef() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [zuletzt, setZuletzt] = useState<string[]>(zuletztLesen);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [leute, setLeute] = useState<string[]>([]);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [korrekturen, setKorrekturen] = useState<Korrektur[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const [auftraege, setAuftraege] = useState<Auftrag[]>([]);
  const [wartend, setWartend] = useState(0);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(new Date()));
  const heute = new Date();
  const heuteIso = iso(heute);
  const dieseWocheIso = iso(montag(heute));
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));
  const istDieseWoche = vonIso === dieseWocheIso;
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

  /** Meldungen aus der lokalen Warteschlange für Team + Woche — ohne Netz das Einzige, was wir sicher wissen. */
  const lokaleLaden = useCallback(async (planRows: Plan[]): Promise<Meldung[]> => {
    if (!teamId) return [];
    const offene = await offeneMeldungen();
    const liste: Meldung[] = [];
    for (const e of offene) {
      const p = e.payload as unknown as Partial<MeldungPayload>;
      if (p.team_id !== teamId || typeof p.datum !== 'string' || p.datum < vonIso || p.datum > bisIso || !Array.isArray(p.eintraege)) continue;
      const geplant = planRows.find((r) => r.baustelle?.id === p.baustelle_id)?.baustelle ?? null;
      const konto = geplant?.konto_nr ?? p.eintraege[0]?.konto_nr ?? '';
      liste.push({
        id: e.client_uuid, datum: p.datum, normalfall: p.normalfall ?? true, abweichung_typ: p.abweichung_typ ?? null,
        baustelle: geplant ?? (konto ? { konto_nr: konto, bezeichnung: null } : null),
        zeiteintrag: p.eintraege.map((z) => ({ id: z.id, normal_min: z.normal_min, ueber_min: z.ueber_min, status: 'offen', mitarbeiter: null })),
        lokal: true,
      });
    }
    return liste;
  }, [teamId, vonIso, bisIso]);

  const laden = useCallback(async () => {
    if (!supabase || !teamId) return;
    const c = supabase;
    setLaedt(true);
    setFehler(null);
    try {
      if (navigator.onLine) {
        try { await flushNachSupabase(c); } catch { /* Senden klappt später — die Anzeige darf nicht daran scheitern */ }
      }
      setWartend(await offeneAnzahl());
      const [mg, m, p] = await Promise.all([
        c.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(name,aktiv)').eq('team_id', teamId).is('bis', null),
        c.from('tagesmeldung').select('id,datum,normalfall,abweichung_typ,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(id,normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(name))').eq('team_id', teamId).gte('datum', vonIso).lte('datum', bisIso).order('datum'),
        c.from('jahresplan').select('von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).lte('von', bisIso).gte('bis', vonIso),
      ]);
      const fehlerObj = mg.error ?? m.error ?? p.error;
      if (fehlerObj) throw new Error(fehlerObj.message);
      setLeute(((mg.data ?? []) as unknown as { mitarbeiter: { name: string; aktiv: boolean } | null }[]).map((r) => r.mitarbeiter).filter((x): x is { name: string; aktiv: boolean } => !!x && x.aktiv).map((x) => x.name).sort());
      const planRows = (p.data ?? []) as unknown as Plan[];
      setPlan(planRows);
      const serverMeldungen = ((m.data ?? []) as unknown as Omit<Meldung, 'lokal'>[]).map((x) => ({ ...x, lokal: false }));
      const lokale = await lokaleLaden(planRows);
      setMeldungen([...serverMeldungen, ...lokale].sort((a, b) => a.datum.localeCompare(b.datum)));

      // Korrekturen des Bauführers an den Stunden dieser Woche (CLAUDE.md #7: alles im freigabe_log)
      const zeitIds = serverMeldungen.flatMap((x) => x.zeiteintrag.map((z) => z.id));
      if (zeitIds.length > 0) {
        const { data: k } = await c.from('freigabe_log').select('zeiteintrag_id,feld,alt,neu,begruendung,wann').in('zeiteintrag_id', zeitIds).in('feld', ['normal_min', 'ueber_min']).order('wann');
        setKorrekturen((k ?? []) as Korrektur[]);
      } else setKorrekturen([]);

      const baustellen = planRows.map((r) => r.baustelle?.id).filter((x): x is string => !!x);
      if (baustellen.length > 0) {
        const { data: a } = await c.from('zusatzauftrag_stand').select('id,baustelle_id,taetigkeit,besteller_name,geplant_fuer,stand').in('baustelle_id', baustellen).in('stand', ['bestellt', 'gemeldet']).order('geplant_fuer');
        setAuftraege((a ?? []) as Auftrag[]);
      } else setAuftraege([]);
    } catch (err) {
      // Ohne Netz: wenigstens die lokalen Meldungen zeigen, den Fehler ehrlich benennen
      setFehler(err instanceof Error ? err.message : String(err));
      try {
        const lokale = await lokaleLaden(plan);
        setMeldungen(lokale);
        setWartend(await offeneAnzahl());
      } catch { /* dann eben nur der Fehlertext */ }
    } finally {
      setLaedt(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, vonIso, bisIso, lokaleLaden]);
  useEffect(() => { void laden(); }, [laden]);

  function teamWaehlen(id: string) {
    localStorage.setItem(TEAM_KEY, id);
    setZuletzt(zuletztMerken(id));
    setWeitereTeams(0);
    setTeamId(id);
  }

  // Teamwahl: zuletzt genutzte zuerst (max. 5), der Rest in Fünferblöcken hinter «Weitere Teams …»
  const teamAuswahl = useMemo(() => {
    const vorneIds = zuletzt.filter((x, i, a) => a.indexOf(x) === i);
    const vorne = vorneIds.map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => !!t).slice(0, 5);
    const erste = vorne.length > 0 ? vorne : teams.slice(0, 5);
    const rest = teams.filter((t) => !erste.some((e) => e.id === t.id));
    return { erste, rest };
  }, [teams, zuletzt]);

  const korrekturJeZeit = useMemo(() => korrekturenZusammenfassen(korrekturen), [korrekturen]);

  if (!teamId || (teams.length > 0 && !team)) {
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-bold">Welches Team?</h1>
          <p className="text-sm text-ink3">Einmal wählen — das Gerät merkt es sich. Das ist dann auch das Team in der Erfassung.</p>
          <div className="grid grid-cols-2 gap-2">
            {teamAuswahl.erste.map((t) => (
              <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                {t.bezeichnung}
                {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
              </button>
            ))}
          </div>
          {weitereTeams > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {teamAuswahl.rest.slice(0, weitereTeams).map((t) => (
                <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                  {t.bezeichnung}
                  {t.chefmonteur && <span className="block text-[11px] font-normal text-ink3">{t.chefmonteur.name}</span>}
                </button>
              ))}
            </div>
          )}
          {weitereTeams < teamAuswahl.rest.length && (
            <button type="button" onClick={() => setWeitereTeams((n) => n + 5)} className="btn-ghost w-full">Weitere Teams …</button>
          )}
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
          <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep">
            <strong>{wartend} Meldung{wartend === 1 ? '' : 'en'} auf diesem Gerät noch nicht gesendet.</strong> Wird gesendet, sobald Netz da ist.
          </div>
        )}

        {fehler && (
          <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep">
            <strong>Woche konnte nicht geladen werden.</strong> {navigator.onLine ? fehler : 'Kein Netz — gezeigt wird nur, was auf diesem Gerät liegt.'}
            <button type="button" className="btn-ghost mt-2 block w-full" onClick={() => void laden()}>Nochmals</button>
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
                  {m.baustelle?.bezeichnung ?? (m.baustelle ? `Konto-Nr. ${m.baustelle.konto_nr}` : 'Baustelle')} · {stunden(m.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0))} h · {m.normalfall ? 'wie geplant' : ABWEICHUNG[m.abweichung_typ ?? ''] ?? 'Abweichung'}
                  {m.lokal ? <span className="ml-1 font-mono text-[11px] text-amber-deep">wartet auf Netz</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {!istDieseWoche && <p className="text-[11px] text-ink3">Du schaust eine frühere Woche an — ob heute schon gemeldet ist, siehst du mit › bei «Diese Woche».</p>}
          <Link to="/erfassung" className={heutige.length > 0 || !istDieseWoche ? 'btn-ghost block w-full text-center' : 'cta'}>
            {heutige.length > 0 ? 'Nochmals melden oder ändern' : 'Tag melden'}
          </Link>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))} aria-label="Vorwoche">‹</button>
            <span className="text-center">
              <span className="block text-sm font-semibold">{istDieseWoche ? 'Diese Woche' : `${kurz(wochenStart)} – ${kurz(addTage(wochenStart, 6))}`}</span>
              <span className="block font-mono text-xs text-ink3">{istDieseWoche ? `${kurz(wochenStart)} – ${kurz(addTage(wochenStart, 6))} · ` : ''}{stunden(wochenTotal)} h total</span>
            </span>
            <button type="button" className="btn-ghost" disabled={istDieseWoche} onClick={() => setWochenStart(addTage(wochenStart, 7))} aria-label="nächste Woche">›</button>
          </div>
          <div className="card divide-y divide-line p-0">
            {laedt && meldungen.length === 0 && <p className="px-4 py-3 text-sm text-ink3">Lädt …</p>}
            {tage.map((d, i) => {
              const dIso = iso(d);
              const ms = meldungen.filter((m) => m.datum === dIso);
              const zukunft = dIso > heuteIso;
              const geplant = plan.find((p) => p.von <= dIso && p.bis >= dIso)?.baustelle ?? null;
              const korr = ms.flatMap((m) => m.zeiteintrag.flatMap((z) => (korrekturJeZeit.get(z.id) ?? []).map((k) => ({ ...k, name: z.mitarbeiter?.name ?? null }))));
              const lokal = ms.some((m) => m.lokal);
              return (
                <div key={dIso} className={'px-4 py-2 text-sm ' + (zukunft ? 'text-ink3' : '')}>
                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 whitespace-nowrap font-mono text-xs">{WOCHENTAGE[i]} {kurz(d)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {ms.length > 0
                        ? ms.map((m) => m.baustelle?.bezeichnung ?? (m.baustelle ? m.baustelle.konto_nr : 'Baustelle')).filter((x, j, a) => a.indexOf(x) === j).join(', ')
                        : geplant ? <span className="text-ink3">{geplant.bezeichnung ?? geplant.konto_nr}</span> : <span className="text-ink3">—</span>}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {ms.length > 0 ? `${stunden(ms.flatMap((m) => m.zeiteintrag).reduce((s, z) => s + z.normal_min + z.ueber_min, 0))} h` : ''}
                    </span>
                    <span className="w-24 shrink-0 text-right text-[11px]">
                      {ms.length > 0
                        ? lokal ? <span className="text-amber-deep">wartet auf Netz</span>
                          : ms.some((m) => m.zeiteintrag.some((z) => z.status === 'freigegeben')) ? <span className="text-good-deep">freigegeben</span>
                            : ms.every((m) => m.normalfall) ? <span className="text-good-deep">gemeldet</span> : <span className="text-amber-deep">Abweichung</span>
                        : zukunft ? '' : i >= 5 ? '' : <span className="text-ink3">nichts</span>}
                    </span>
                  </div>
                  {korr.length > 0 && (
                    <div className="mt-1 space-y-0.5 pl-[4.75rem] text-xs text-amber-deep">
                      {korr.map((k, j) => (
                        <p key={j}>
                          vom Bauführer angepasst{k.name ? ` (${k.name})` : ''}: {k.feld === 'ueber_min' ? 'Überstunden ' : ''}{stunden(k.alt)} → {stunden(k.neu)} h
                          {k.grund ? <span className="text-ink2"> · Grund: {k.grund}</span> : null}
                        </p>
                      ))}
                    </div>
                  )}
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
