import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarOff, TriangleAlert, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { alle, stuecke } from '../../lib/abfrage';
import { seitenFuer, useAnsicht } from '../../lib/ansicht';
import { useNeuesteAnfrage } from '../../lib/auffrischen';
import { addTage, ausIso, iso, stunden } from '../../lib/datum';
import { normaltagMin } from '../../lib/einstellungen';
import { FUNKTION_BUERO } from '../../lib/benutzername';
import { ARTEN, artText, bloecke, werktage, type Abwesenheit, type AbwesenheitArt, type Block } from '../../lib/abwesenheit';
import { DatumWahl } from '../../ui/DatumWahl';
import { Blaettern, Segment } from '../../ui/Segment';
import { Avatar } from '../../ui/Dialog';
import { PersonWahl } from '../../ui/PersonWahl';
import { ArtPille } from '../../ui/ArtPille';
import { LoeschLeiste, Papierkorb, type Frage } from '../../ui/LoeschFrage';
import { MONATE } from '../../ui/Karten';

/**
 * Abwesenheiten (Migration 0036, Arbnor 10.10.2026): Ferien, Krankheit, Unfall, Todesfall usw. je Person eintragen.
 * Ein Zeitraum wird als einzelne Werktage gespeichert (Sa/So fallen weg); jeder Tag zählt den normalen Arbeitstag der
 * Firma (Einstellungen), halber Tag oder unbezahlt (0 h) gehen auch. Wirkung: Das Teamgerät hakt die Person an dem Tag
 * ab, «Meine Woche» zeigt den Tag, der Export rechnet die Stunden fürs Lohnbüro mit.
 */

interface Person { id: string; name: string; funktion: string }
const ALLE = 'alle';
const STUECK = 500;

/**
 * Rückfrage nach dem Eintragen (24.10.2026, Caturix-Analyse): Ist die Person an diesen Tagen in ein Team eingeteilt,
 * stünde sie dort weiter auf dem Plan — Einteilung löschen? Fehlt sie ihrem festen Team an geplanten Tagen, ein Hinweis
 * mit Link in die Planung (dort steht es auch unter «Zu lösen»).
 */
interface PlanFrage {
  einteilungen: { mitarbeiter_id: string; datum: string; team: string }[];
  /** Festes Team mit Einsatz an diesen Tagen (nur bei einer Person) */
  weniger: { team: string; tage: number; chef: boolean }[];
  woche: string;
  geloescht: number;
}

async function planungPruefen(ids: string[], tage: string[]): Promise<PlanFrage | null> {
  if (!supabase || ids.length === 0 || tage.length === 0) return null;
  const c = supabase;
  const von = tage[0];
  const bis = tage[tage.length - 1];
  const tagSet = new Set(tage);
  const [ep, tm, tt] = await Promise.all([
    Promise.all(stuecke(ids).map((s) => c.from('einsatz_person').select('mitarbeiter_id,datum,team_id').in('mitarbeiter_id', s).gte('datum', von).lte('datum', bis))),
    ids.length === 1 ? c.from('team_mitglied').select('team_id').eq('mitarbeiter_id', ids[0]).is('bis', null) : Promise.resolve({ data: [] as { team_id: string }[], error: null }),
    c.from('team').select('id,bezeichnung,chefmonteur_id').eq('aktiv', true),
  ]);
  // Ohne Einteilungen (0036) oder ohne Verbindung: keine Rückfrage — die Abwesenheit ist ja gespeichert
  if (ep.some((r) => r.error) || tm.error || tt.error) return null;
  const teams = (tt.data ?? []) as { id: string; bezeichnung: string; chefmonteur_id: string | null }[];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.bezeichnung ?? 'anderes Team';
  const einteilungen = ep.flatMap((r) => (r.data ?? []) as { mitarbeiter_id: string; datum: string; team_id: string }[])
    .filter((e) => tagSet.has(e.datum))
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((e) => ({ mitarbeiter_id: e.mitarbeiter_id, datum: e.datum, team: teamName(e.team_id) }));
  const weniger: PlanFrage['weniger'] = [];
  const fest = ((tm.data ?? []) as { team_id: string }[]).map((x) => x.team_id);
  if (fest.length > 0) {
    const jp = await c.from('jahresplan').select('team_id,von,bis').in('team_id', fest).lte('von', bis).gte('bis', von);
    if (!jp.error) {
      const plaene = (jp.data ?? []) as { team_id: string; von: string; bis: string }[];
      for (const t of fest) {
        // Tage, an denen das feste Team geplant ist — ohne die, an denen die Person ohnehin in einem anderen Team wäre
        const n = tage.filter((d) => plaene.some((p) => p.team_id === t && p.von <= d && p.bis >= d) && !einteilungen.some((e) => e.datum === d)).length;
        if (n > 0) weniger.push({ team: teamName(t), tage: n, chef: teams.find((x) => x.id === t)?.chefmonteur_id === ids[0] });
      }
    }
  }
  if (einteilungen.length === 0 && weniger.length === 0) return null;
  return { einteilungen, weniger, woche: von, geloescht: 0 };
}

/** Heute, am Wochenende der nächste Montag — Ferien trägt man selten für einen Sonntag ein. */
function naechsterArbeitstag(): string {
  let d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d = addTage(d, 1);
  return iso(d);
}

/** «Mo 13.10.» */
function tag(isoDatum: string): string {
  const d = ausIso(isoDatum);
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

/** «Ivo Meier ist Mi 28.10. in Team 3 eingeteilt.» · «Ivo Meier ist an 3 Tagen eingeteilt (Team 3).» · «7 Einteilungen …» */
function einteilungText(e: PlanFrage['einteilungen'], name: (id: string) => string): string {
  const personen = new Set(e.map((x) => x.mitarbeiter_id));
  if (personen.size > 1) return `An diesen Tagen sind ${e.length} Einteilungen in Teams geplant — die Leute fehlen dort.`;
  const teams = [...new Set(e.map((x) => x.team))].join(', ');
  return e.length === 1
    ? `${name(e[0].mitarbeiter_id)} ist ${tag(e[0].datum)} in ${teams} eingeteilt.`
    : `${name(e[0].mitarbeiter_id)} ist an ${e.length} dieser Tage eingeteilt (${teams}).`;
}

function fehlerText(m: string): string {
  return /abwesenheit/i.test(m) && /does not exist|schema cache|relation/i.test(m)
    ? 'Die Datenbank kennt die Abwesenheiten noch nicht — Migration 0036 fehlt.'
    : m;
}

export function Abwesenheiten() {
  const normal = normaltagMin();
  const start = naechsterArbeitstag();
  const [leute, setLeute] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [art, setArt] = useState<AbwesenheitArt>('ferien');
  const [von, setVon] = useState(start);
  const [bis, setBis] = useState(start);
  const [minuten, setMinuten] = useState(normal);
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null);

  const [monat, setMonat] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1, 12); });
  const [liste, setListe] = useState<Abwesenheit[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState('');
  const [frage, setFrage] = useState<Frage<Block> | null>(null);
  const [planFrage, setPlanFrage] = useState<PlanFrage | null>(null);
  const [loeschtEinteilung, setLoeschtEinteilung] = useState(false);
  const ansicht = useAnsicht();
  const darfPlanen = ansicht ? seitenFuer(ansicht).includes('planung') : false;
  const anfrage = useNeuesteAnfrage();

  const monatVon = iso(monat);
  const monatBis = iso(new Date(monat.getFullYear(), monat.getMonth() + 1, 0, 12));

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('mitarbeiter').select('id,name,funktion').eq('aktiv', true).order('name').then(({ data }) => setLeute((data ?? []) as Person[]));
  }, []);

  // Seitenweise (13.10.2026): ein Feiertag für alle sind schon 75 Zeilen — die Blöcke und «löschen» brauchen jeden Tag
  // des Monats, nicht die ersten 1000. Blättert man schnell, zählt nur die Antwort zum angezeigten Monat.
  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    const aktuell = anfrage();
    setLaedt(true);
    try {
      const daten = await alle<Abwesenheit>((von, bis) => c.from('abwesenheit').select('id,mitarbeiter_id,datum,art,minuten').gte('datum', monatVon).lte('datum', monatBis).order('datum').order('id').range(von, bis));
      if (!aktuell()) return;
      setFehler('');
      setListe(daten);
    } catch (e) {
      if (!aktuell()) return;
      setFehler(fehlerText(e instanceof Error ? e.message : String(e)));
      setListe([]);
    }
    setLaedt(false);
  }, [monatVon, monatBis, anfrage]);
  useEffect(() => { void laden(); }, [laden]);

  // Unbezahlt zählt 0 h; zurück zu einer bezahlten Art → wieder der normale Tag
  function artWaehlen(a: AbwesenheitArt) {
    setArt(a);
    if (a === 'unbezahlt') setMinuten(0);
    else if (minuten === 0) setMinuten(normal);
  }

  const tage = useMemo(() => werktage(von, bis), [von, bis]);
  const ziel = useMemo(() => (personId === ALLE ? leute.filter((p) => p.funktion !== FUNKTION_BUERO) : leute.filter((p) => p.id === personId)), [personId, leute]);
  const halb = Math.round(normal / 2);
  const stundenWahl = minuten === normal ? 'ganz' : minuten === halb ? 'halb' : minuten === 0 ? 'null' : 'eigen';

  async function eintragen() {
    if (!supabase || speichert) return;
    if (ziel.length === 0) { setMeldung({ text: 'Zuerst eine Person wählen.', art: 'fehler' }); return; }
    if (tage.length === 0) { setMeldung({ text: bis < von ? '«Bis» liegt vor «von».' : 'Im Zeitraum liegt kein Arbeitstag (Mo–Fr).', art: 'fehler' }); return; }
    setSpeichert(true);
    setMeldung(null);
    setPlanFrage(null);
    const zeilen = ziel.flatMap((p) => tage.map((datum) => ({ mitarbeiter_id: p.id, datum, art, minuten })));
    // Gleicher Tag schon eingetragen → ersetzen (Korrektur), nicht doppelt
    for (let i = 0; i < zeilen.length; i += STUECK) {
      const { error } = await supabase.from('abwesenheit').upsert(zeilen.slice(i, i + STUECK), { onConflict: 'mitarbeiter_id,datum' });
      if (error) { setSpeichert(false); setMeldung({ text: fehlerText(error.message), art: 'fehler' }); return; }
    }
    setSpeichert(false);
    const wer = personId === ALLE ? `${ziel.length} Personen` : ziel[0].name;
    setMeldung({ text: `Eingetragen ✓ ${artText(art)} · ${wer} · ${tage.length} ${tage.length === 1 ? 'Tag' : 'Tage'}`, art: 'ok' });
    void planungPruefen(ziel.map((p) => p.id), tage).then(setPlanFrage);
    // Formular für die nächste Person frei machen (21.10.2026): sonst meldete es gleich nach dem Eintragen
    // «N Tage sind schon eingetragen — wird ersetzt» — über genau die Tage, die eben eingetragen wurden.
    setPersonId('');
    // Liste auf den Monat des Eintrags stellen, damit man ihn sieht
    const d = ausIso(von);
    const neu = new Date(d.getFullYear(), d.getMonth(), 1, 12);
    if (iso(neu) !== monatVon) setMonat(neu); else void laden();
  }

  /** Rückfrage «Einteilung löschen»: die Person ist an diesen Tagen wieder im festen Team (dort abwesend). */
  async function einteilungenLoeschen() {
    if (!supabase || !planFrage || loeschtEinteilung) return;
    setLoeschtEinteilung(true);
    const jePerson = new Map<string, string[]>();
    for (const e of planFrage.einteilungen) jePerson.set(e.mitarbeiter_id, [...(jePerson.get(e.mitarbeiter_id) ?? []), e.datum]);
    for (const [id, daten] of jePerson) {
      const { error } = await supabase.from('einsatz_person').delete().eq('mitarbeiter_id', id).in('datum', daten);
      if (error) { setLoeschtEinteilung(false); setMeldung({ text: 'Einteilung nicht gelöscht: ' + error.message, art: 'fehler' }); return; }
    }
    setLoeschtEinteilung(false);
    setPlanFrage({ ...planFrage, einteilungen: [], geloescht: planFrage.einteilungen.length });
  }

  async function loeschen() {
    if (!supabase || !frage || frage.laeuft) return;
    const b = frage.ding;
    setFrage({ ...frage, laeuft: true });
    const { error } = await supabase.from('abwesenheit').delete().in('id', b.ids);
    if (error) { setFrage({ ...frage, text: fehlerText(error.message), knopf: null, laeuft: false }); return; }
    setFrage(null);
    void laden();
  }

  const name = (id: string) => leute.find((p) => p.id === id)?.name ?? '—';
  const liste2 = useMemo(() => bloecke(liste).sort((a, b) => a.von.localeCompare(b.von) || name(a.mitarbeiter_id).localeCompare(name(b.mitarbeiter_id))), [liste, leute]); // eslint-disable-line react-hooks/exhaustive-deps
  const summe = liste.reduce((s, a) => s + a.minuten, 0);
  const schonDa = personId && personId !== ALLE ? liste.filter((a) => a.mitarbeiter_id === personId && tage.includes(a.datum)).length : 0;

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-steel text-white shadow-[0_4px_10px_-4px_rgb(43_108_176/0.6)]">
            <CalendarOff size={19} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-[15px] font-semibold">Abwesenheit eintragen</h2>
            <p className="mt-0.5 text-xs text-ink3">
              Ferien, Krankheit, Unfall … Jeder Arbeitstag zählt den normalen Tag ({stunden(normal)} h, unter Einstellungen). Im Teamgerät ist
              die Person an diesen Tagen abgehakt, im Export stehen die Stunden fürs Lohnbüro.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="lbl" htmlFor="abw-person">Person</label>
            <PersonWahl id="abw-person" leute={leute} wert={personId} aendern={setPersonId}
              oben={{ id: ALLE, text: 'Alle Mitarbeitenden', hinweis: 'z. B. ein Feiertag für alle', icon: <Users size={14} aria-hidden="true" /> }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="lbl">Von</p>
              <DatumWahl label="Von" wert={von} aendern={(v) => { setVon(v); if (bis < v) setBis(v); }} leerErlaubt={false} />
            </div>
            <div>
              <p className="lbl">Bis</p>
              <DatumWahl label="Bis" wert={bis} aendern={setBis} min={von} leerErlaubt={false} />
            </div>
          </div>
        </div>

        <div>
          <p className="lbl">Art</p>
          <div className="flex flex-wrap gap-2">
            {ARTEN.map((a) => (
              <button key={a.wert} type="button" title={a.hinweis} aria-pressed={art === a.wert} onClick={() => artWaehlen(a.wert)} className={'chip px-3 py-2 text-sm ' + (art === a.wert ? 'chip-on' : '')}>{a.text}</button>
            ))}
          </div>
          {ARTEN.find((a) => a.wert === art)?.hinweis && <p className="mt-1.5 text-[11px] text-ink3">{ARTEN.find((a) => a.wert === art)?.hinweis}</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="lbl">Stunden pro Tag</p>
            <Segment
              label="Stunden pro Tag"
              wert={stundenWahl}
              aendern={(w) => setMinuten(w === 'ganz' ? normal : w === 'halb' ? halb : w === 'null' ? 0 : minuten)}
              optionen={[
                { wert: 'ganz', text: `ganzer Tag · ${stunden(normal)} h` },
                { wert: 'halb', text: `halber Tag · ${stunden(halb)} h` },
                { wert: 'null', text: '0 h' },
                ...(stundenWahl === 'eigen' ? [{ wert: 'eigen' as const, text: `${stunden(minuten)} h` }] : []),
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink3">
            andere:
            <input type="number" inputMode="decimal" min={0} max={12} step={0.25} value={Number((minuten / 60).toFixed(2))}
              onChange={(e) => { const h = Number(e.target.value); if (Number.isFinite(h)) setMinuten(Math.min(720, Math.max(0, Math.round(h * 60)))); }}
              className="field w-20 py-1.5 text-sm" aria-label="Stunden pro Tag" />
            h
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-ground px-3.5 py-2.5 text-sm">
          <span className="text-ink2">
            {tage.length === 0
              ? <span className="text-amber-deep">Kein Arbeitstag im Zeitraum</span>
              : <><b className="text-ink">{tage.length} {tage.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}</b> · {stunden(tage.length * minuten)} h{personId === ALLE ? ` je Person · ${ziel.length} Personen` : ''}<span className="text-ink3"> · Sa/So zählen nicht</span></>}
            {schonDa > 0 && <span className="block text-xs text-amber-deep">{schonDa} {schonDa === 1 ? 'Tag ist' : 'Tage sind'} schon eingetragen — wird ersetzt.</span>}
          </span>
          <button type="button" onClick={() => void eintragen()} disabled={speichert || !personId || tage.length === 0} className="cta w-full px-5 py-2.5 text-sm disabled:opacity-50 sm:w-auto">
            {speichert ? 'Speichert …' : 'Eintragen'}
          </button>
        </div>
        {meldung && <p className={'text-sm font-semibold ' + (meldung.art === 'ok' ? 'text-good-deep' : 'text-accent-deep')}>{meldung.text}</p>}
        {planFrage && (
          <div className="space-y-2.5 rounded-[14px] border border-amber/40 bg-amber-soft/70 px-4 py-3 text-sm" role="status">
            <p className="flex items-center gap-2 font-semibold text-amber-deep"><TriangleAlert size={15} aria-hidden="true" /> Betrifft die Planung</p>
            {planFrage.einteilungen.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink2">{einteilungText(planFrage.einteilungen, name)}</span>
                <span className="flex shrink-0 gap-1.5">
                  <button type="button" disabled={loeschtEinteilung} onClick={() => void einteilungenLoeschen()} className="cta whitespace-nowrap px-3.5 py-1.5 text-xs disabled:opacity-50">
                    {loeschtEinteilung ? 'Löscht …' : planFrage.einteilungen.length === 1 ? 'Einteilung löschen' : 'Einteilungen löschen'}
                  </button>
                  <button type="button" onClick={() => setPlanFrage({ ...planFrage, einteilungen: [] })} className="btn-ghost whitespace-nowrap px-3 py-1.5 text-xs">So lassen</button>
                </span>
              </div>
            )}
            {planFrage.geloescht > 0 && <p className="font-medium text-good-deep">✓ {planFrage.geloescht === 1 ? 'Einteilung gelöscht' : `${planFrage.geloescht} Einteilungen gelöscht`} — wieder im festen Team.</p>}
            {planFrage.weniger.map((w) => (
              <p key={w.team} className="text-ink2">
                {w.team} hat an {w.tage === 1 ? 'einem geplanten Tag' : `${w.tage} geplanten Tagen`} eine Person weniger{w.chef ? ' — und keinen Chefmonteur' : ''}.
              </p>
            ))}
            {darfPlanen && planFrage.weniger.length > 0 && (
              <Link to={`/planung?woche=${planFrage.woche}`} className="inline-block text-xs font-semibold text-steel hover:underline">In der Planung ansehen →</Link>
            )}
          </div>
        )}
      </section>

      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-sm text-ink2">
            <b className="text-ink">{liste2.length}</b> {liste2.length === 1 ? 'Eintrag' : 'Einträge'}
            {summe > 0 && <span className="text-ink3"> · {stunden(summe)} h</span>}
          </p>
          <Blaettern titel={`${MONATE[monat.getMonth()]} ${monat.getFullYear()}`}
            zurueck={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1, 12))}
            vor={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1, 12))}
            labelZurueck="Monat zurück" labelVor="Monat vor" />
        </div>
        {fehler ? (
          <p className="m-4 rounded-[12px] border border-amber/40 bg-amber-soft px-3.5 py-2 text-xs text-amber-deep">{fehler}</p>
        ) : liste2.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink3">{laedt ? 'Lädt …' : `Keine Abwesenheiten im ${MONATE[monat.getMonth()]}.`}</p>
        ) : (
          <ul className="divide-y divide-line">
            {liste2.map((b) => {
              const key = b.ids[0];
              const offen = frage?.ding.ids[0] === key;
              return (
                <li key={key}>
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={name(b.mitarbeiter_id)} gross />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-sm font-medium text-ink">{name(b.mitarbeiter_id)}</span>
                        <ArtPille art={b.art} />
                      </span>
                      <span className="block text-xs tabular-nums text-ink3">
                        {b.von === b.bis ? tag(b.von) : `${tag(b.von)} – ${tag(b.bis)}`}
                        {' · '}{b.tage} {b.tage === 1 ? 'Tag' : 'Tage'}{b.minutenProTag !== null && b.tage > 1 ? ` à ${stunden(b.minutenProTag)} h` : ''}
                      </span>
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">{stunden(b.minuten)} h</span>
                    <Papierkorb titel="Abwesenheit löschen" onClick={() => setFrage({ ding: b, text: `${artText(b.art)} von ${name(b.mitarbeiter_id)} (${b.tage} ${b.tage === 1 ? 'Tag' : 'Tage'}) löschen?`, knopf: 'Löschen', entscheid: null, laeuft: false })} />
                  </div>
                  {offen && frage && <LoeschLeiste frage={frage} art="tabelle" onAbbrechen={() => setFrage(null)} onBestaetigen={() => void loeschen()} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-xs text-ink3">Ein Zeitraum über das Monatsende steht in beiden Monaten mit seinen Tagen; gelöscht werden die Tage des angezeigten Monats.</p>
    </div>
  );
}
