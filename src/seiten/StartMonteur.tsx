/**
 * Startseite Monteur: «Meine Woche» — die eigenen Stunden, wie auf dem Wochenblatt.
 * Nur lesen. Wer bin ich: einmal Team, dann Person wählen (kein Tippen, CLAUDE.md #2).
 * Korrekturen des Bauführers (freigabe_log) werden am Tag gezeigt — nie versteckt (CLAUDE.md #7).
 */
import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { zeitenText } from '../lib/zeiten';
import { festeAnsicht } from '../lib/ansicht';
import { artText } from '../lib/abwesenheit';
import { istDemoFirma } from '../lib/demo';
import { ArtPille } from '../ui/ArtPille';

const MONTEUR_KEY = 'monteur-id';
/** Zuletzt gewählte Teams auf diesem Gerät — gleiche Liste wie Erfassung/Chefmonteur; auf dem eigenen Handy meist leer. */
const ZULETZT_KEY = 'teamgeraet-zuletzt';

interface Team { id: string; bezeichnung: string }
interface Person { id: string; name: string; funktion: string; typ: string }
interface Eintrag {
  id: string; normal_min: number; ueber_min: number; oev: boolean; km: number; status: string;
  /** Zeiten von–bis, falls das Team welche eingetragen hat (Migration 0016; dritte Spanne nach Znüni-Abzug 0029) */
  von_min?: number | null; bis_min?: number | null; von2_min?: number | null; bis2_min?: number | null; von3_min?: number | null; bis3_min?: number | null;
  tagesmeldung: { datum: string; normalfall: boolean; baustelle: { konto_nr: string; bezeichnung: string | null } | null; team: { bezeichnung: string } | null };
}
/** Vom Sekretariat eingetragen (0036): Ferien, Krank, Unfall … */
interface Abwesend { datum: string; art: string; minuten: number }
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
  const [abwesend, setAbwesend] = useState<Abwesend[]>([]);
  const [laedt, setLaedt] = useState(true);
  /**
   * Konnte etwas nicht geladen werden? Dann sagen — nie «nichts gemeldet» oder «Keine Teams» zeigen, wenn es nur an
   * der Verbindung lag (13.10.2026).
   */
  const [fehler, setFehler] = useState<string | null>(null);
  const [nochmal, setNochmal] = useState(0);
  const heuteIso = iso(new Date());
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  // Person laden (oder Auswahl vorbereiten)
  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setFehler(null);
    if (personId) {
      void c.from('mitarbeiter').select('id,name,funktion,typ').eq('id', personId).maybeSingle().then(({ data, error }) => {
        // Nur vergessen, wenn die Datenbank geantwortet hat und es die Person wirklich nicht gibt — ein Netzfehler
        // hiess vorher auch «gibt es nicht», und der Monteur musste sich jedes Mal neu wählen (13.10.2026)
        if (error) { setFehler('Dein Name konnte gerade nicht geladen werden — Verbindung prüfen.'); return; }
        if (data) setPerson(data);
        else { localStorage.removeItem(MONTEUR_KEY); setPersonId(null); }
      });
    } else {
      void c.from('team').select('id,bezeichnung').eq('aktiv', true).order('bezeichnung').then(({ data, error }) => {
        if (error) { setFehler('Die Teams konnten nicht geladen werden — Verbindung prüfen und nochmals versuchen.'); return; }
        setTeams(((data ?? []) as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
      });
    }
  }, [personId, nochmal]);

  useEffect(() => {
    if (!supabase || !teamId) { setLeute([]); return; }
    setLeuteLaden(true);
    void supabase.from('team_mitglied').select('mitarbeiter:mitarbeiter_id(id,name,funktion,typ,aktiv)').eq('team_id', teamId).is('bis', null).then(({ data }) => {
      const p = ((data ?? []) as unknown as { mitarbeiter: (Person & { aktiv: boolean }) | null }[]).map((r) => r.mitarbeiter).filter((x): x is Person & { aktiv: boolean } => !!x && x.aktiv);
      setLeute(p.sort((a, b) => a.name.localeCompare(b.name)));
      setLeuteLaden(false);
    });
  }, [teamId]);

  const [wocheFehler, setWocheFehler] = useState<string | null>(null);
  /** Die Stunden selbst fehlen (nicht nur die Anpassungen) — dann steht an den Tagen nicht «nichts gemeldet» */
  const [stundenFehlen, setStundenFehlen] = useState(false);
  useEffect(() => {
    if (!supabase || !personId) return;
    const c = supabase;
    setLaedt(true);
    setWocheFehler(null);
    setStundenFehlen(false);
    void (async () => {
      // Zeiten von–bis (Migration 0016, dritte Spanne 0029) mitladen — fehlen die Spalten noch, ohne sie
      const lade = (mitZeiten: boolean, mitDritter = mitZeiten) => c
        .from('zeiteintrag')
        .select('id,normal_min,ueber_min,oev,km,status,' + (mitZeiten ? 'von_min,bis_min,von2_min,bis2_min,' + (mitDritter ? 'von3_min,bis3_min,' : '') : '') + 'tagesmeldung:tagesmeldung_id!inner(datum,normalfall,baustelle:baustelle_id(konto_nr,bezeichnung),team:team_id(bezeichnung))')
        .eq('mitarbeiter_id', personId)
        .gte('tagesmeldung.datum', vonIso)
        .lte('tagesmeldung.datum', bisIso);
      let erg = await lade(true);
      if (erg.error && /(von3_min|bis3_min) does not exist/.test(erg.error.message)) erg = await lade(true, false);
      if (erg.error && /(von2?_min|bis2?_min) does not exist/.test(erg.error.message)) erg = await lade(false);
      if (erg.error) {
        // Ein Fehler ist nicht «nichts gemeldet» — die Tage bleiben leer, oben steht warum
        setEintraege([]);
        setKorrekturen([]);
        setStundenFehlen(true);
        setWocheFehler('Deine Stunden konnten gerade nicht geladen werden — Verbindung prüfen und nochmals versuchen.');
        setLaedt(false);
        return;
      }
      const liste = (erg.data ?? []) as unknown as Eintrag[];
      setEintraege(liste);
      // Korrekturen des Bauführers an diesen Einträgen (nur Stundenfelder)
      if (liste.length > 0) {
        const { data: k, error: ke } = await c.from('freigabe_log').select('zeiteintrag_id,feld,alt,neu,begruendung,wann').in('zeiteintrag_id', liste.map((e) => e.id)).in('feld', ['normal_min', 'ueber_min']).order('wann');
        if (ke) setWocheFehler('Die Anpassungen des Bauführers konnten nicht geladen werden — die Stunden unten sind die gemeldeten.');
        setKorrekturen((k ?? []) as Korrektur[]);
      } else setKorrekturen([]);
      // Abwesenheiten (0036) — fehlt die Tabelle noch, bleibt die Liste leer
      const ab = await c.from('abwesenheit').select('datum,art,minuten').eq('mitarbeiter_id', personId).gte('datum', vonIso).lte('datum', bisIso);
      setAbwesend(ab.error ? [] : ((ab.data ?? []) as Abwesend[]));
      setLaedt(false);
    })();
  }, [personId, vonIso, bisIso, nochmal]);

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
          {fehler ? (
            <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep">
              {fehler}
              <button type="button" className="btn-ghost mt-2 block w-full" onClick={() => setNochmal((n) => n + 1)}>Nochmals</button>
            </div>
          ) : teams.length === 0 && (
            <p className="card text-sm text-ink3">Keine Teams — als Bauführer unter Verwaltung anlegen{istDemoFirma() ? ' oder den Demo-Betrieb laden' : ''}.</p>
          )}
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
  const abwesendMin = abwesend.reduce((s, a) => s + a.minuten, 0);
  const abwesendArten = [...new Set(abwesend.map((a) => artText(a.art)))].join(', ');

  return (
    <Shell>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="lbl mb-0.5">Meine Woche</p>
            <h1 className="truncate font-display text-2xl font-semibold">{person?.name ?? '…'}</h1>
          </div>
          {/* Persönlicher Zugang (0033): die Person kommt aus der Anmeldung, «Nicht ich» heisst dann abmelden */}
          {!festeAnsicht() && <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { localStorage.removeItem(MONTEUR_KEY); setPerson(null); setPersonId(null); setTeamId(null); }}>Nicht ich</button>}
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

        {(fehler || wocheFehler) && (
          <div className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep" role="alert">
            {fehler ?? wocheFehler}
            <button type="button" className="btn-ghost mt-2 block w-full" onClick={() => setNochmal((n) => n + 1)}>Nochmals</button>
          </div>
        )}

        {/* Die Summe zuoberst — das ist die Zahl, die der Monteur wissen will */}
        {!laedt && !stundenFehlen && (
          <section className="card">
            <div className="space-y-2.5">
              <div>
                <p className="font-mono text-[34px] font-semibold leading-none tabular-nums">{stunden(total)} <span className="text-lg font-medium text-ink3">h</span></p>
                <p className="mt-1.5 text-sm text-ink2">
                  {stunden(normal)} h normal
                  {ueber > 0 && <> + <span className="font-semibold text-amber-deep">{stunden(ueber)} h Überstunden</span></>}
                  {tageMitEintrag > 0 && <span className="text-ink3"> · {tageMitEintrag} {tageMitEintrag === 1 ? 'Tag' : 'Tage'}</span>}
                </p>
                {abwesend.length > 0 && (
                  <p className="mt-0.5 text-sm text-ink2">+ {stunden(abwesendMin)} h {abwesendArten} <span className="text-ink3">· {abwesend.length} {abwesend.length === 1 ? 'Tag' : 'Tage'}, vom Büro eingetragen</span></p>
                )}
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
            const ab = abwesend.find((a) => a.datum === dIso);
            if (zukunft && !ab) return null;
            if (es.length === 0 && !ab && i >= 5) return null;
            const tagMin = es.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
            const tagUeber = es.reduce((s, e) => s + e.ueber_min, 0);
            const tagFrei = es.length > 0 && es.every((e) => e.status === 'freigegeben');
            return (
              <div key={dIso} className={'card flex gap-3 px-4 py-3 ' + (es.length === 0 && !ab ? 'bg-surface/60' : '')}>
                <div className="w-11 shrink-0 text-center">
                  <span className={'block text-[15px] font-semibold ' + (dIso === heuteIso ? 'text-accent-deep' : '')}>{WOCHENTAGE[i]}</span>
                  <span className="block text-[11px] tabular-nums text-ink3">{kurz(d)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {ab && <p className={'flex items-center gap-2 text-sm ' + (es.length > 0 ? 'mb-1.5' : 'py-1')}><ArtPille art={ab.art} gross /><span className="text-ink3">vom Büro eingetragen</span></p>}
                  {es.length === 0 ? (
                    !ab && <p className="py-1 text-sm text-ink3">{stundenFehlen ? 'nicht geladen' : 'nichts gemeldet'}</p>
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
                              {zeitenText(e) && <span className="font-mono tabular-nums"> · {zeitenText(e)}</span>}
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
                {es.length === 0 && ab && (
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[17px] font-semibold tabular-nums text-ink2">{stunden(ab.minuten)} h</p>
                  </div>
                )}
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
