/**
 * Tageskarte (24.10.2026, Amir: «so etwas wäre auch krass — mit Karte und wo Einsätze geplant sind», Screenshot Caturix):
 * links der Tag mit allen Einsätzen, rechts die Landkarte mit einem Punkt je Baustelle (Teams, Leute) und dem Werkhof.
 *
 * Daten wie in der Planung: Einsätze (`jahresplan`), Leute des Tages (`besetzung` aus festen Teams und `einsatz_person`,
 * ohne Abwesende). Orte aus Verwaltung → Baustellen («Adresse prüfen», 0050) — ohne geprüften Ort steht die Baustelle in
 * einer eigenen Liste mit Link zum Nachtragen. Die Karte zeigt nur Baustellen, nie Personen (keine Standortverfolgung).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarX2, ChevronLeft, ChevronRight, Clock, Flag, MapPin, MapPinOff, MessageSquareText, Search, Users } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Dialog';
import { supabase } from '../lib/supabase';
import { alleOderFehler } from '../lib/abfrage';
import { useAuffrischen, useNeuesteAnfrage } from '../lib/auffrischen';
import { addTage, ausIso, iso, kurz, montag } from '../lib/datum';
import { besetzung, type Versetzung } from '../lib/planung';
import { leuteAm, type KartenPerson } from '../lib/tageskarte';
import { feiertag } from '../lib/feiertage';
import { adresseText } from '../lib/adresse';
import { punktPasst, punkteAm, type KartenPunkt, type PunktBaustelle } from '../lib/karte';
import { eigeneFirma } from '../lib/einstellungen';
import { FUNKTION_BUERO } from '../lib/benutzername';
import { uhrzeit } from '../lib/zeiten';

// Die Landkarte (MapLibre) nur hier laden — die anderen Seiten (und das Teamgerät beim Start) brauchen sie nicht
const Landkarte = lazy(() => import('../ui/Landkarte').then((m) => ({ default: m.Landkarte })));

const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

interface Daten {
  punkte: { mitOrt: KartenPunkt[]; ohneOrt: KartenPunkt[] };
  werkhof: { lat: number; lon: number; adresse: string | null } | null;
}

export function Karte() {
  const [params] = useSearchParams();
  const [tag, setTag] = useState(() => { const t = params.get('tag'); return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : iso(new Date()); });
  const [daten, setDaten] = useState<Daten | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [suche, setSuche] = useState('');
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [luftbild, setLuftbild] = useState(false);
  const anfrage = useNeuesteAnfrage();

  const laden = useCallback(async (still = false) => {
    if (!supabase) return;
    const c = supabase;
    const aktuell = anfrage();
    if (!still) setLaedt(true);
    const firma = eigeneFirma();
    const [t, p, m, v, a, f, fm, ma] = await Promise.all([
      c.from('team').select('id,bezeichnung,chefmonteur_id,chefmonteur:chefmonteur_id(name)').eq('aktiv', true),
      alleOderFehler<{ team_id: string | null; soll_leute: number | null; beginn_min: number | null; treffpunkt: string | null; hinweis: string | null; baustelle: PunktBaustelle | null }>((von, bis) =>
        c.from('jahresplan').select('team_id,soll_leute,beginn_min,treffpunkt,hinweis,baustelle:baustelle_id(id,konto_nr,bezeichnung,strasse,plz,ort,lat,lon)').lte('von', tag).gte('bis', tag).order('id').range(von, bis)),
      c.from('team_mitglied').select('team_id,mitarbeiter:mitarbeiter_id(id,name,aktiv,funktion)').is('bis', null),
      c.from('einsatz_person').select('datum,mitarbeiter_id,team_id').eq('datum', tag),
      c.from('abwesenheit').select('mitarbeiter_id,art').eq('datum', tag),
      firma ? c.from('firma').select('werkhof_adresse,werkhof_lat,werkhof_lon').eq('id', firma.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      // Vom Team als «fehlt» gemeldet (0053) — zählt wie abwesend
      c.from('fehlmeldung').select('id,mitarbeiter_id').eq('status', 'offen').eq('datum', tag),
      // Namen für die Detailkarte (auch Eingeteilte aus anderen Teams und ohne Team)
      c.from('mitarbeiter').select('id,name').eq('aktiv', true),
    ]);
    if (!aktuell()) return;
    const err = t.error ?? p.error ?? m.error;
    if (err) { setFehler('Karte konnte nicht geladen werden: ' + err.message); setLaedt(false); return; }
    const teamZeilen = (t.data ?? []) as unknown as { id: string; bezeichnung: string; chefmonteur_id: string | null; chefmonteur: { name: string } | null }[];
    const teams = new Map(teamZeilen.map((x) => [x.id, { name: x.bezeichnung, chef: x.chefmonteur?.name ?? null }]));
    // Leute je Team an diesem Tag — wie die Planung: feste Leute, versetzt, eingeteilt, ohne Abwesende
    const basis = new Map<string, string[]>();
    const fest = new Map<string, { id: string; name: string }[]>();
    for (const x of (m.data ?? []) as unknown as { team_id: string; mitarbeiter: { id: string; name: string; aktiv: boolean; funktion: string } | null }[]) {
      if (!x.mitarbeiter?.aktiv || x.mitarbeiter.funktion === FUNKTION_BUERO) continue;
      basis.set(x.team_id, [...(basis.get(x.team_id) ?? []), x.mitarbeiter.id]);
      fest.set(x.team_id, [...(fest.get(x.team_id) ?? []), { id: x.mitarbeiter.id, name: x.mitarbeiter.name }]);
    }
    const abwArt = new Map(((a.data ?? []) as { mitarbeiter_id: string; art: string }[]).map((x) => [x.mitarbeiter_id, x.art]));
    const fehlt = new Map(((fm.error ? [] : fm.data ?? []) as { id: string; mitarbeiter_id: string }[]).map((x) => [x.mitarbeiter_id, x.id]));
    const abwesend = new Set([...abwArt.keys(), ...fehlt.keys()]);
    const versetzt = (v.error ? [] : (v.data ?? [])) as Versetzung[];
    const leute = new Map<string, number>();
    for (const [teamId, b] of besetzung(basis, versetzt, tag)) leute.set(teamId, b.ids.filter((id) => !abwesend.has(id)).length);
    // Wer je Team da ist, dazukommt, fehlt oder weg ist — für die Detailkarte, Chefmonteur zuerst
    const namen = new Map(((ma.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    const teamNamen = new Map(teamZeilen.map((x) => [x.id, x.bezeichnung]));
    const personen = new Map<string, KartenPerson[]>();
    for (const tz of teamZeilen) {
      const liste = [...(fest.get(tz.id) ?? [])].sort((x, y) => (x.id === tz.chefmonteur_id ? -1 : y.id === tz.chefmonteur_id ? 1 : x.name.localeCompare(y.name, 'de')));
      personen.set(tz.id, leuteAm({ teamId: tz.id, fest: liste, versetzt, abwesend: abwArt, fehlt, namen, teamNamen, datum: tag }));
    }
    const w = f.error ? null : (f.data as { werkhof_adresse: string | null; werkhof_lat: number | null; werkhof_lon: number | null } | null);
    setDaten({
      punkte: punkteAm({ einsaetze: p.data ?? [], teams, leute, personen }),
      werkhof: w && w.werkhof_lat != null && w.werkhof_lon != null ? { lat: w.werkhof_lat, lon: w.werkhof_lon, adresse: w.werkhof_adresse } : null,
    });
    setFehler(p.error ? 'Einsätze konnten nicht geladen werden.' : null);
    setLaedt(false);
  }, [tag, anfrage]);
  useEffect(() => { setAuswahl(null); void laden(); }, [laden]);
  useAuffrischen(() => laden(true));

  const sichtbar = useMemo(() => (daten ? daten.punkte.mitOrt.filter((p) => punktPasst(p, suche)) : []), [daten, suche]);
  const ohneOrt = useMemo(() => (daten ? daten.punkte.ohneOrt.filter((p) => punktPasst(p, suche)) : []), [daten, suche]);
  const d = ausIso(tag);
  const fei = feiertag(tag);
  const anzahl = (daten?.punkte.mitOrt.length ?? 0) + (daten?.punkte.ohneOrt.length ?? 0);
  const leer = !laedt && daten && anzahl === 0;
  const heute = iso(new Date());
  const gewaehlt = auswahl ? [...(daten?.punkte.mitOrt ?? []), ...(daten?.punkte.ohneOrt ?? [])].find((p) => p.baustelle.id === auswahl) ?? null : null;

  return (
    <Shell zurueck breit>
      <div className="space-y-4">
        <header>
          <p className="lbl mb-0.5">Planung &amp; Daten</p>
          <h1 className="font-display text-2xl font-semibold">Karte</h1>
          <p className="mt-1 text-sm text-ink3">Wo die Teams an einem Tag sind — je Baustelle ein Punkt mit Teams und Leuten.</p>
        </header>
        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">{fehler}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
          {/* Tag, Suche und Liste — am Handy unter der Karte */}
          <section className="card order-2 flex min-h-0 flex-col gap-3 p-3 lg:order-1 lg:h-[calc(100vh-200px)] lg:min-h-[520px]">
            <div className="flex items-center justify-between gap-1">
              <button type="button" aria-label="Tag zurück" onClick={() => setTag(iso(addTage(d, -1)))} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:bg-surface-2"><ChevronLeft size={18} /></button>
              <span className="text-center">
                <span className="block text-[15px] font-semibold text-ink">{TAGE[d.getDay()]} {kurz(d)}{d.getFullYear()}</span>
                <span className="block text-[11px] text-ink3">{fei ? `Feiertag: ${fei}` : tag === heute ? 'heute' : ' '}</span>
              </span>
              <button type="button" aria-label="Tag vor" onClick={() => setTag(iso(addTage(d, 1)))} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:bg-surface-2"><ChevronRight size={18} /></button>
            </div>
            {tag !== heute && <button type="button" onClick={() => setTag(heute)} className="btn-ghost -mt-1 self-center py-1 text-xs">Heute</button>}
            <label className="flex items-center gap-2 rounded-[12px] border border-line-strong bg-white px-3 py-2">
              <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
              <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Team, Chefmonteur, Baustelle …" aria-label="Suchen" className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
            </label>

            <div className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1">
              {laedt && !daten && <p className="px-1 py-6 text-center text-sm text-ink3">Lädt …</p>}
              {leer && (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink3"><CalendarX2 size={18} aria-hidden="true" /></span>
                  <p className="text-sm text-ink2">Für diesen Tag sind keine Einsätze geplant.</p>
                  <Link to={`/planung?woche=${tag}&tag=${tag}`} className="btn-ghost py-1.5 text-sm">Planung öffnen</Link>
                </div>
              )}
              {sichtbar.map((p) => {
                const an = auswahl === p.baustelle.id;
                return (
                  <button key={p.baustelle.id} type="button" onClick={() => setAuswahl(an ? null : p.baustelle.id)} aria-pressed={an}
                    className={'block w-full rounded-[14px] border px-3 py-2.5 text-left transition ' + (an ? 'border-ink bg-ink/[0.03] shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line bg-white hover:border-line-strong')}>
                    <span className="flex items-start gap-2">
                      <span className="knr mt-px">{p.baustelle.konto_nr}</span>
                      <span className="min-w-0 text-sm font-semibold leading-snug text-ink">{p.baustelle.bezeichnung || 'Baustelle'}</span>
                    </span>
                    {adresseText(p.baustelle) && <span className="mt-1 flex items-center gap-1.5 text-xs text-ink3"><MapPin size={12} aria-hidden="true" />{adresseText(p.baustelle)}</span>}
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {p.teams.map((t) => (
                        <span key={t.teamId} className={'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (t.soll !== null && t.leute < t.soll ? 'bg-amber-soft text-amber-deep' : 'bg-surface-2 text-ink2')}>
                          {t.team}
                          <span className="inline-flex items-center gap-0.5 font-medium"><Users size={11} aria-hidden="true" />{t.leute}{t.soll !== null ? `/${t.soll}` : ''}</span>
                          {t.beginn_min !== null && <span className="inline-flex items-center gap-0.5 font-medium"><Clock size={11} aria-hidden="true" />{uhrzeit(t.beginn_min)}</span>}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
              {ohneOrt.length > 0 && (
                <div className="space-y-1.5 rounded-[14px] border border-dashed border-amber/50 bg-amber-soft/40 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-deep"><MapPinOff size={13} aria-hidden="true" /> Ohne geprüften Ort · {ohneOrt.length} — nicht auf der Karte</p>
                  {ohneOrt.map((p) => (
                    <p key={p.baustelle.id} className="truncate text-xs text-ink2"><span className="font-semibold">{p.teams.map((t) => t.team).join(', ')}</span> · {p.baustelle.bezeichnung || p.baustelle.konto_nr}</p>
                  ))}
                  <Link to="/verwaltung#baustellen" className="inline-block pt-0.5 text-xs font-semibold text-steel hover:underline">Orte prüfen →</Link>
                </div>
              )}
            </div>
            {daten?.werkhof && <p className="flex items-center gap-1.5 border-t border-line pt-2 text-[11px] text-ink3"><span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ink" aria-hidden="true" /> Werkhof{daten.werkhof.adresse ? ` · ${daten.werkhof.adresse}` : ''}</p>}
          </section>

          {/* Karte — am Handy oben */}
          <section className="card relative order-1 h-[55vh] min-h-[360px] overflow-hidden p-0 lg:order-2 lg:h-[calc(100vh-200px)] lg:min-h-[520px]">
            <Suspense fallback={<p className="p-6 text-sm text-ink3">Karte lädt …</p>}>
              <Landkarte punkte={sichtbar} werkhof={daten?.werkhof ?? null} auswahl={auswahl} onAuswahl={(id) => setAuswahl(id)} luftbild={luftbild}
                blase={gewaehlt && <TeamBlase punkt={gewaehlt} tag={tag} />} onSchliessen={() => setAuswahl(null)} />
            </Suspense>
            <div className="absolute right-3 top-3 z-[500] flex rounded-full border border-ink/10 bg-white p-1 shadow-[0_2px_8px_-2px_rgb(17_17_19/0.25)]" role="group" aria-label="Kartenart">
              {([false, true] as const).map((lb) => (
                <button key={String(lb)} type="button" aria-pressed={luftbild === lb} onClick={() => setLuftbild(lb)}
                  className={'rounded-full px-3 py-1 text-xs font-semibold transition ' + (luftbild === lb ? 'bg-ink text-white' : 'text-ink2 hover:text-ink')}>
                  {lb ? 'Luftbild' : 'Karte'}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Blase über der gewählten Baustelle (25.10.2026, Amir: «auf der Karte sehen, wer im Team ist — einfach Details zum
 * Team»): je Team Chefmonteur, «x von y», Beginn, Treffpunkt, Hinweis und die Leute mit Namen — da, eingeteilt, fehlt,
 * abwesend, in einem anderen Team. Sitzt als Popup direkt über dem Punkt (Landkarte), × oder Klick daneben schliesst.
 */
function TeamBlase({ punkt, tag }: { punkt: KartenPunkt; tag: string }) {
  const markeVon = (p: KartenPerson) =>
    p.art === 'dazu' ? { text: 'eingeteilt', klasse: 'bg-good-soft text-good-deep' }
      : p.art === 'fehlt' ? { text: 'fehlt gemeldet', klasse: 'bg-amber-soft text-amber-deep' }
        : p.art === 'abwesend' ? { text: p.info ?? 'abwesend', klasse: 'bg-surface-2 text-ink3' }
          : p.art === 'weg' ? { text: `→ ${p.info ?? 'anderes Team'}`, klasse: 'bg-surface-2 text-ink3' }
            : null;
  return (
    <div className="max-h-[min(340px,42vh)] w-[290px] max-w-[calc(100vw-80px)] overflow-y-auto text-left">
      <p className="pr-6 text-[12px] leading-snug text-ink3"><span className="font-mono">{punkt.baustelle.konto_nr}</span> · {punkt.baustelle.bezeichnung || 'Baustelle'}</p>
      <div className="mt-1 divide-y divide-line">
        {punkt.teams.map((t) => {
          const da = (t.personen ?? []).filter((p) => p.art === 'da' || p.art === 'dazu').length;
          const knapp = t.soll !== null && da < t.soll;
          return (
            <section key={t.teamId} className="space-y-2 py-2.5 first:pt-1.5 last:pb-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold text-ink">{t.team}{t.chef && <span className="text-[13px] font-normal text-ink3"> · {t.chef}</span>}</p>
                <span className={'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (knapp ? 'bg-amber-soft text-amber-deep' : 'bg-surface-2 text-ink2')}>
                  <Users size={11} aria-hidden="true" />{da}{t.soll !== null ? ` von ${t.soll}` : ''}
                </span>
              </div>
              {(t.beginn_min !== null || t.treffpunkt) && (
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink2">
                  {t.beginn_min !== null && <span className="inline-flex items-center gap-1"><Clock size={12} className="text-ink3" aria-hidden="true" />ab <b className="font-semibold text-ink">{uhrzeit(t.beginn_min)}</b></span>}
                  {t.treffpunkt && <span className="inline-flex items-center gap-1"><Flag size={12} className="text-ink3" aria-hidden="true" />{t.treffpunkt === 'werkhof' ? 'Werkhof' : 'Baustelle'}</span>}
                </p>
              )}
              {t.hinweis && <p className="flex items-start gap-1.5 rounded-[8px] bg-steel-soft px-2 py-1 text-[12px] text-ink"><MessageSquareText size={12} className="mt-0.5 shrink-0 text-steel" aria-hidden="true" />{t.hinweis}</p>}
              {(t.personen ?? []).length > 0 ? (
                <ul className="space-y-1">
                  {(t.personen ?? []).map((p) => {
                    const m = markeVon(p);
                    const weg = p.art === 'abwesend' || p.art === 'weg' || p.art === 'fehlt';
                    return (
                      <li key={p.id + p.art} className="flex items-center gap-2">
                        <Avatar name={p.name} />
                        <span className={'min-w-0 flex-1 truncate text-[13.5px] ' + (weg ? 'text-ink3' : 'text-ink')}>{p.name}</span>
                        {m && <span className={'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ' + m.klasse}>{m.text}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[12px] text-ink3">Niemand eingeteilt.</p>}
            </section>
          );
        })}
      </div>
      {/* Planung mit diesem Tag, den Teams und dem Einsatz markiert — wie der Sprung in die Wochenübersicht */}
      <Link to={`/planung?woche=${iso(montag(ausIso(tag)))}&tag=${tag}&team=${punkt.teams.map((t) => t.teamId).join(',')}&baustelle=${punkt.baustelle.id}`} className="mt-2 inline-block text-[12px] font-semibold text-steel hover:underline">In der Planung öffnen →</Link>
    </div>
  );
}
