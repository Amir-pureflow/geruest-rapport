import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Building2, ChevronDown, Clock, Download, FileSpreadsheet, HardHat, Users } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, ausIso, iso, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { useAnsicht } from '../lib/ansicht';
import { MONATE, ZahlKarte } from '../ui/Karten';
import { Blaettern, Schalter, Segment, SegmentZahl } from '../ui/Segment';
import { bueroExcel, rapportExcel } from '../lib/excel';
import {
  lohnZeilen,
  monatsGrenzen,
  monatsSpalten,
  temporaerBueroBlaetter,
  ueberstunden,
  wochenImMonat,
  wochenSpalten,
  wochenTitel,
  OHNE_BUERO,
  type BueroBlatt,
  type LohnEintrag,
} from '../lib/lohn';

/**
 * Phase 5 — Übergabe. SORBA hat keinen Import (Arbnor, 27.08.):
 * Die Rasteransicht zeigt die freigegebenen Zahlen im Layout des Tagesrapports,
 * damit der Bauführer sehend tippt statt suchend. Das Excel geht ans Sekretariat
 * (Lohn, Überstunden) und ans Temporärbüro — je Büro ein Blatt, Person × Tag × Konto.
 *
 * Rechte (Bauführer 20.09.: «Bauführer kein zugriff hier drauf»): Der Bauführer sieht nur das
 * SORBA-Raster — Lohnstunden, Überstunden und Temporärbüros gehören dem Sekretariat. Das
 * Sekretariat kann je Temporärbüro ein eigenes Excel ziehen (nur deren Leute), zum Weiterschicken.
 *
 * Die Rechnerei liegt in src/lib/lohn.ts (mit Tests); hier nur Laden und Anzeigen. Das Excel selbst
 * (Aufbau, Farben, Formeln, Druck) baut src/lib/excel.ts mit ExcelJS — nachgeladen erst beim Klick.
 */

interface Zeile {
  normal_min: number; ueber_min: number; oev: boolean; km: number; status: string; konto_nr: string | null;
  mitarbeiter: { id: string; name: string; typ: string; funktion: string; temporaerbuero: string | null };
  tagesmeldung: { datum: string; normalfall: boolean; team_id: string | null; baustelle: { konto_nr: string; bezeichnung: string | null } | null };
}
interface JahresZeile {
  ueber_min: number; status: string;
  mitarbeiter: { id: string; name: string; typ: string; temporaerbuero: string | null };
  tagesmeldung: { datum: string };
}
interface Team { id: string; bezeichnung: string }
type Zeitraum = 'woche' | 'monat';
/** Reiter der Export-Seite (06.10.2026): eine Tabelle auf einmal statt vier Blöcke untereinander */
type Tab = 'lohn' | 'ueber' | 'bueros' | 'raster';

const SEITE = 1000;
const ALLE = 'alle';

/**
 * Woche aus ?woche=JJJJ-MM-TT (Montag der Woche), sonst die aktuelle Woche — am Montag und Dienstag die Vorwoche,
 * dann wird sie noch abgeschlossen (09.10.2026, Amir; gleich wie die Startseite des Sekretariats).
 */
function startAusUrl(): { wochenStart: Date; zeitraum: Zeitraum } {
  const p = new URLSearchParams(window.location.search);
  const w = p.get('woche');
  const zeitraum: Zeitraum = p.get('zeitraum') === 'monat' ? 'monat' : 'woche';
  if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const d = ausIso(w);
    if (!Number.isNaN(d.getTime())) return { wochenStart: montag(d), zeitraum };
  }
  const heute = new Date();
  const vorwoche = heute.getDay() === 1 || heute.getDay() === 2;
  return { wochenStart: montag(vorwoche ? addTage(heute, -7) : heute), zeitraum };
}

function zuEintrag(z: Zeile): LohnEintrag {
  return {
    datum: z.tagesmeldung.datum,
    mitarbeiter: { id: z.mitarbeiter.id, name: z.mitarbeiter.name, typ: z.mitarbeiter.typ, temporaerbuero: z.mitarbeiter.temporaerbuero },
    normal_min: z.normal_min,
    ueber_min: z.ueber_min,
    oev: z.oev,
    km: z.km,
    konto_nr: z.konto_nr ?? z.tagesmeldung.baustelle?.konto_nr ?? null,
  };
}

/** Dateiname ohne Zeichen, die Windows/macOS nicht mögen. */
function dateiName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').trim();
}

export function Export() {
  // Seit 04.10.2026 nur noch fürs Sekretariat erreichbar (Bauführer hat die Seite nicht mehr);
  // die lohnSichtbar-Weiche bleibt als Sicherheitsnetz, falls der Zugang je zurückkommt.
  const lohnSichtbar = useAnsicht() === 'sekretariat';
  const [anfang] = useState(startAusUrl);
  const [wochenStart, setWochenStart] = useState<Date>(anfang.wochenStart);
  const [zeitraum, setZeitraum] = useState<Zeitraum>(anfang.zeitraum);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>(ALLE);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [jahr, setJahr] = useState<JahresZeile[]>([]);
  const [nurFrei, setNurFrei] = useState(true);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [gewaehlt, setGewaehlt] = useState<Tab>('lohn');

  // Zeitraum: Woche Mo–So oder ganzer Monat (der Monat, in dem der gewählte Montag liegt)
  const monatJahr = wochenStart.getFullYear();
  const monat = wochenStart.getMonth();
  const wochen = useMemo(() => (zeitraum === 'monat' ? wochenImMonat(monatJahr, monat) : [wochenStart]), [zeitraum, monatJahr, monat, wochenStart]);
  const { vonIso, bisIso } = useMemo(() => {
    if (zeitraum === 'monat') { const g = monatsGrenzen(monatJahr, monat); return { vonIso: g.von, bisIso: g.bis }; }
    return { vonIso: iso(wochenStart), bisIso: iso(addTage(wochenStart, 6)) };
  }, [zeitraum, monatJahr, monat, wochenStart]);
  const jahresStart = `${bisIso.slice(0, 4)}-01-01`;

  // Adresse mitführen, damit man die Ansicht weitergeben oder neu laden kann
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('woche', iso(wochenStart));
    if (zeitraum === 'monat') p.set('zeitraum', 'monat'); else p.delete('zeitraum');
    history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [wochenStart, zeitraum]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung').order('bezeichnung').then(({ data }) => {
      if (data) setTeams(data.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
    });
  }, []);

  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    setFehler('');
    // Supabase liefert höchstens 1000 Zeilen pro Antwort — ein Monat mit 75 Leuten hat mehr. Darum seitenweise.
    async function alle<T>(bau: (von: number, bis: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
      const out: T[] = [];
      for (let von = 0; ; von += SEITE) {
        const { data, error } = await bau(von, von + SEITE - 1);
        if (error) throw new Error(error.message);
        const teil = (data ?? []) as T[];
        out.push(...teil);
        if (teil.length < SEITE) return out;
      }
    }
    try {
      const [z, j] = await Promise.all([
        alle<Zeile>((von, bis) => {
          let q = c
            .from('zeiteintrag')
            .select('normal_min,ueber_min,oev,km,status,konto_nr,mitarbeiter:mitarbeiter_id(id,name,typ,funktion,temporaerbuero),tagesmeldung:tagesmeldung_id!inner(datum,normalfall,team_id,baustelle:baustelle_id(konto_nr,bezeichnung))')
            .gte('tagesmeldung.datum', vonIso).lte('tagesmeldung.datum', bisIso);
          if (teamId !== ALLE) q = q.eq('tagesmeldung.team_id', teamId);
          if (nurFrei) q = q.eq('status', 'freigegeben');
          return q.order('id').range(von, bis);
        }),
        // Überstunden seit Jahresbeginn: nur Zeilen mit Überstunden, unabhängig vom Team (die Person zählt) — nur fürs Sekretariat
        lohnSichtbar
          ? alle<JahresZeile>((von, bis) => {
            let q = c
              .from('zeiteintrag')
              .select('ueber_min,status,mitarbeiter:mitarbeiter_id(id,name,typ,temporaerbuero),tagesmeldung:tagesmeldung_id!inner(datum)')
              .gte('tagesmeldung.datum', jahresStart).lte('tagesmeldung.datum', bisIso).gt('ueber_min', 0);
            if (nurFrei) q = q.eq('status', 'freigegeben');
            return q.order('id').range(von, bis);
          })
          : Promise.resolve([] as JahresZeile[]),
      ]);
      setZeilen(z);
      setJahr(j);
    } catch (e) {
      setFehler('Laden: ' + (e instanceof Error ? e.message : String(e)));
      setZeilen([]);
      setJahr([]);
    }
    setLaedt(false);
  }, [vonIso, bisIso, jahresStart, teamId, nurFrei, lohnSichtbar]);
  useEffect(() => { void laden(); }, [laden]);

  const eintraege = useMemo(() => zeilen.map(zuEintrag), [zeilen]);
  const lohn = useMemo(() => lohnZeilen(eintraege), [eintraege]);
  const alleBueros = useMemo(() => temporaerBueroBlaetter(eintraege), [eintraege]);
  // Nur echte Büros bekommen Karte, Blatt und eigenes Excel; Temporäre ohne Büro stehen im Lohn-Blatt und als Hinweis
  const bueros = useMemo(() => alleBueros.filter((b) => b.buero !== OHNE_BUERO), [alleBueros]);
  const ohneBuero = alleBueros.find((b) => b.buero === OHNE_BUERO);
  const ueber = useMemo(
    () => ueberstunden(
      eintraege,
      jahr.map((j) => ({ datum: j.tagesmeldung.datum, mitarbeiter: j.mitarbeiter, normal_min: 0, ueber_min: j.ueber_min, oev: false, km: 0, konto_nr: null })),
    ),
    [eintraege, jahr],
  );
  // Spalten der Lohntabelle: Woche → Mo–So, Monat → eine je KW
  const spalten = useMemo(() => (zeitraum === 'monat' ? wochen.map((w) => `KW ${kw(w)}`) : WOCHENTAGE), [zeitraum, wochen]);
  const werte = useCallback(
    (z: (typeof lohn)[number]) => (zeitraum === 'monat' ? monatsSpalten(z, wochen) : wochenSpalten(z, wochenStart)),
    [zeitraum, wochen, wochenStart],
  );

  // Raster: Zeile = Konto (Zusatzarbeit aus alten Meldungen getrennt), Spalte = Person
  const raster = useMemo(() => {
    const personen = [...new Map(zeilen.map((z) => [z.mitarbeiter.id, z.mitarbeiter])).values()].sort((a, b) => a.name.localeCompare(b.name));
    const vorgaenge = new Map<string, { konto: string; bezeichnung: string; regie: boolean; min: Map<string, number> }>();
    for (const z of zeilen) {
      const b = z.tagesmeldung.baustelle;
      const key = `${b?.konto_nr ?? '—'}|${z.tagesmeldung.normalfall ? 'n' : 'r'}`;
      const v = vorgaenge.get(key) ?? { konto: b?.konto_nr ?? '—', bezeichnung: b?.bezeichnung ?? 'ohne Baustelle', regie: !z.tagesmeldung.normalfall, min: new Map() };
      v.min.set(z.mitarbeiter.id, (v.min.get(z.mitarbeiter.id) ?? 0) + z.normal_min + z.ueber_min);
      vorgaenge.set(key, v);
    }
    return { personen, vorgaenge: [...vorgaenge.values()].sort((a, b) => a.konto.localeCompare(b.konto) || Number(a.regie) - Number(b.regie)) };
  }, [zeilen]);

  const titel = zeitraum === 'monat' ? `${MONATE[monat]} ${monatJahr}` : wochenTitel(wochenStart);
  const dateiTeil = zeitraum === 'monat' ? `${monatJahr}-${String(monat + 1).padStart(2, '0')}` : `KW${kw(wochenStart)}_${vonIso}`;

  function blaettern(richtung: -1 | 1) {
    if (zeitraum === 'monat') setWochenStart(montag(new Date(monatJahr, monat + richtung, 1, 12)));
    else setWochenStart(addTage(wochenStart, 7 * richtung));
  }

  const teamName = (id: string) => (id === ALLE ? 'alle Teams' : teams.find((t) => t.id === id)?.bezeichnung ?? '');
  const zeitraumText = zeitraum === 'monat' ? 'in diesem Monat' : 'in dieser Woche';
  // Untertitel auf jedem Blatt: Zeitraum, Team, Filter — das Büro sieht, was drin ist, ohne nachzufragen
  const untertitel = { zeitraum: titel, filter: [teamName(teamId), nurFrei ? 'nur Freigegebenes' : 'alle Einträge, auch nicht freigegebene'] };

  // Summen für Kopfzahlen und Fusszeile der Lohntabelle
  const summeLohn = lohn.reduce((s, l) => s + l.total_min, 0);
  const summeUeber = lohn.reduce((s, l) => s + l.ueber_min, 0);
  const summeBueros = bueros.reduce((s, b) => s + b.total_min, 0);
  const tempPersonen = bueros.reduce((s, b) => s + b.personen.length, 0);
  const spaltenSummen = spalten.map((_, k) => lohn.reduce((s, l) => s + (werte(l)[k] ?? 0), 0));
  const ueberListe = ueber.filter((u) => u.zeitraum_min > 0 || u.jahr_min > 0);
  const ueberMax = Math.max(1, ...ueberListe.map((u) => u.jahr_min));
  const tab: Tab = lohnSichtbar ? gewaehlt : 'raster';
  const leer = (was: string) => (
    <p className="px-5 py-10 text-center text-sm text-ink3">{laedt ? 'Lädt …' : `Keine ${nurFrei ? 'freigegebenen ' : ''}${was} ${zeitraumText} (${teamName(teamId)}).`}</p>
  );

  async function excel() {
    setFehler('');
    try {
      await rapportExcel({
        unter: untertitel,
        monat: zeitraum === 'monat',
        jahr: bisIso.slice(0, 4),
        lohn: lohnSichtbar
          ? {
            spalten,
            zeilen: lohn.map((l) => ({ name: l.person.name, typ: l.person.typ, buero: l.person.temporaerbuero, werte: werte(l), total_min: l.total_min, ueber_min: l.ueber_min, oevTage: l.oevTage, km: l.km })),
            ueber: ueber.map((u) => ({ name: u.person.name, typ: u.person.typ, zeitraum_min: u.zeitraum_min, jahr_min: u.jahr_min })),
            bueros,
          }
          : null,
        raster,
        dateiname: `${lohnSichtbar ? 'Rapport' : 'Stundenraster'}_${dateiTeil}.xlsx`,
      });
    } catch (e) {
      setFehler('Excel: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Nur ein Temporärbüro, nur dessen Leute — die Datei, die das Sekretariat dem Büro schickt (Bauführer 20.09.). */
  async function excelBuero(b: BueroBlatt) {
    setFehler('');
    try {
      await bueroExcel(b, untertitel, `Temporaer_${dateiName(b.buero)}_${dateiTeil}.xlsx`);
    } catch (e) {
      setFehler('Excel: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  const reiter: { wert: Tab; text: string; n: number }[] = [
    { wert: 'lohn', text: 'Lohnstunden', n: lohn.length },
    { wert: 'ueber', text: 'Überstunden', n: ueberListe.length },
    { wert: 'bueros', text: 'Temporärbüros', n: bueros.length },
    { wert: 'raster', text: 'Stundenraster', n: raster.vorgaenge.length },
  ];
  const kopfZelle = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink3';

  return (
    <Shell zurueck>
      <div className="space-y-5">
        {/* Kopf: Titel links, Zeitraum rechts */}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="lbl mb-0.5">{lohnSichtbar ? 'Stunden & Daten' : 'Planung & Daten'}</p>
            <h1 className="font-display text-[26px] font-semibold tracking-tight lg:text-[28px]">{lohnSichtbar ? 'Export' : 'Stundenraster'}</h1>
            <p className="mt-1 max-w-xl text-sm text-ink3">
              {lohnSichtbar
                ? 'Die freigegebenen Stunden fürs Lohnbüro — ein Excel mit Lohn, Überstunden und je Temporärbüro einem Blatt.'
                : 'Die freigegebenen Stunden je Baustelle und Person — zum Abtippen ins Lohnsystem.'}
            </p>
          </div>
          <Blaettern titel={titel} zurueck={() => blaettern(-1)} vor={() => blaettern(1)} labelZurueck={zeitraum === 'monat' ? 'Monat zurück' : 'Woche zurück'} labelVor={zeitraum === 'monat' ? 'Monat vor' : 'Woche vor'} />
        </header>

        {/* Werkzeugleiste: Zeitraum, Team, Filter — und rechts die eine Hauptaktion */}
        <div className="card flex flex-wrap items-center gap-3 px-3 py-3">
          <Segment label="Zeitraum" wert={zeitraum} aendern={setZeitraum} optionen={[{ wert: 'woche', text: 'Woche' }, { wert: 'monat', text: 'Monat' }]} />
          {teams.length <= 6 ? (
            <Segment label="Team" wert={teamId} aendern={setTeamId} optionen={[{ wert: ALLE, text: 'alle Teams' }, ...teams.map((t) => ({ wert: t.id, text: t.bezeichnung }))]} />
          ) : (
            <label className="relative inline-flex items-center">
              <Users size={15} className="pointer-events-none absolute left-3 text-ink3" aria-hidden="true" />
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team"
                className="appearance-none rounded-full border border-ink/10 bg-white py-2 pl-9 pr-9 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(17_17_19/0.06)] focus:border-accent focus:outline-none">
                <option value={ALLE}>alle Teams</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.bezeichnung}</option>)}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 text-ink3" aria-hidden="true" />
            </label>
          )}
          <Schalter an={nurFrei} aendern={setNurFrei} text="nur Freigegebenes" />
          <button type="button" onClick={() => void excel()} disabled={zeilen.length === 0}
            className="cta inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm disabled:opacity-50 sm:ml-auto sm:w-auto">
            <Download size={16} strokeWidth={2.4} aria-hidden="true" />
            {lohnSichtbar ? 'Excel herunterladen' : 'Raster als Excel'}
          </button>
        </div>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">{fehler}</p>}

        {/* Auf einen Blick — nur Sekretariat */}
        {lohnSichtbar && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ZahlKarte titel="Stunden" wert={`${stunden(summeLohn)} h`} label={`${lohn.length} Personen`} farbe="blau" icon={Clock} />
            <ZahlKarte titel="Überstunden" wert={`${stunden(summeUeber)} h`} label={`${ueber.filter((u) => u.zeitraum_min > 0).length} Personen`} farbe="gelb" icon={AlarmClock} />
            <ZahlKarte titel="Temporärbüros" wert={`${stunden(summeBueros)} h`} label={`${bueros.length} Büros · ${tempPersonen} Personen`} farbe="neutral" icon={Building2} />
            <ZahlKarte titel="Baustellen" wert={String(raster.vorgaenge.length)} label="Konten im Stundenraster" farbe="gruen" icon={HardHat} />
          </div>
        )}

        {/* Eine Tabelle auf einmal — Reiter statt vier Blöcke untereinander */}
        <section className="card overflow-hidden p-0">
          {lohnSichtbar && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <Segment label="Ansicht" wert={tab} aendern={setGewaehlt}
                optionen={reiter.map((r) => ({ wert: r.wert, text: <>{r.text} <SegmentZahl n={r.n} an={tab === r.wert} /></> }))} />
              <span className="text-xs text-ink3">
                {tab === 'lohn' && 'Ein Blatt «Lohn» im Excel — Stunden je Person und Tag'}
                {tab === 'ueber' && 'Blatt «Überstunden» — Zeitraum und seit 1. Januar'}
                {tab === 'bueros' && 'Je Büro ein eigenes Blatt — oder ein eigenes Excel zum Weiterschicken'}
                {tab === 'raster' && 'Zeile Baustelle, Spalte Person'}
              </span>
            </div>
          )}

          {tab === 'lohn' && (lohn.length === 0 ? leer('Stunden') : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60">
                  <tr>
                    <th className={kopfZelle + ' pl-5 text-left'}>Person</th>
                    {spalten.map((t) => <th key={t} className={kopfZelle + ' text-right'}>{t}</th>)}
                    <th className={kopfZelle + ' text-right'}>{zeitraum === 'monat' ? 'Monat' : 'Total'}</th>
                    <th className={kopfZelle + ' pr-5 text-right'}>öV / km</th>
                  </tr>
                </thead>
                <tbody>
                  {lohn.map((l) => (
                    <tr key={l.person.id} className="border-t border-line transition-colors hover:bg-surface-2/40">
                      <td className="whitespace-nowrap py-2.5 pl-5 pr-3">
                        <span className="font-medium text-ink">{l.person.name}</span>
                        {l.person.typ === 'temporaer' && l.person.temporaerbuero && <span className="ml-2 rounded-full bg-steel-soft px-2 py-0.5 text-[11px] font-semibold text-steel">{l.person.temporaerbuero}</span>}
                      </td>
                      {werte(l).map((t, i) => <td key={i} className={'px-3 py-2.5 text-right tabular-nums ' + (t ? 'text-ink2' : 'text-ink/20')}>{t ? stunden(t) : '·'}</td>)}
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{stunden(l.total_min)}</td>
                      <td className="py-2.5 pl-3 pr-5 text-right text-xs text-ink3">{l.oevTage ? `öV × ${l.oevTage}` : l.km ? `${l.km} km` : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong bg-surface-2/60">
                    <td className="py-3 pl-5 pr-3 text-sm font-semibold text-ink">Total · {lohn.length} Personen</td>
                    {spaltenSummen.map((t, i) => <td key={i} className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-ink2">{t ? stunden(t) : ''}</td>)}
                    <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-ink">{stunden(summeLohn)}</td>
                    <td className="pr-5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          {tab === 'ueber' && (ueberListe.length === 0 ? leer('Überstunden') : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60">
                  <tr>
                    <th className={kopfZelle + ' pl-5 text-left'}>Person</th>
                    <th className={kopfZelle + ' text-right'}>{zeitraum === 'monat' ? 'Monat' : 'Woche'}</th>
                    <th className={kopfZelle + ' w-[40%] pr-5 text-left'}>Seit 1. Januar</th>
                  </tr>
                </thead>
                <tbody>
                  {ueberListe.map((u) => (
                    <tr key={u.person.id} className="border-t border-line transition-colors hover:bg-surface-2/40">
                      <td className="whitespace-nowrap py-2.5 pl-5 pr-3 font-medium text-ink">{u.person.name}</td>
                      <td className={'px-3 py-2.5 text-right tabular-nums ' + (u.zeitraum_min ? 'font-semibold text-amber-deep' : 'text-ink/20')}>{u.zeitraum_min ? stunden(u.zeitraum_min) : '·'}</td>
                      <td className="py-2.5 pl-3 pr-5">
                        <span className="flex items-center gap-3">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]" aria-hidden="true">
                            <span className="block h-full rounded-full bg-amber" style={{ width: `${Math.max(4, (u.jahr_min / ueberMax) * 100)}%` }} />
                          </span>
                          <span className="w-12 text-right font-semibold tabular-nums text-ink">{stunden(u.jahr_min)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {tab === 'bueros' && (bueros.length === 0 && !ohneBuero ? leer('Stunden von Temporären') : (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {ohneBuero && (
                <div className="rounded-[16px] border border-amber/40 bg-amber-soft/60 p-4 sm:col-span-2">
                  <p className="text-sm font-semibold text-amber-deep">Temporär, aber kein Büro eingetragen</p>
                  <p className="mt-0.5 text-xs text-ink2">
                    {ohneBuero.personen.map((p) => `${p.name} ${stunden(p.total_min)} h`).join(' · ')} — die Stunden stehen im Lohn-Blatt. Für ein eigenes Büro-Excel das Temporärbüro eintragen.{' '}
                    <Link to="/verwaltung" className="font-semibold text-steel">Zur Verwaltung ›</Link>
                  </p>
                </div>
              )}
              {bueros.map((b) => (
                <div key={b.buero} className="flex flex-col rounded-[16px] border border-line bg-gradient-to-br from-white to-[#f6f4ef] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-[12px] bg-steel text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.35)]" aria-hidden="true"><Building2 size={17} strokeWidth={2.2} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-ink">{b.buero}</span>
                        <span className="block text-xs text-ink3">{b.personen.length} {b.personen.length === 1 ? 'Person' : 'Personen'}</span>
                      </span>
                    </span>
                    <span className="text-[22px] font-semibold leading-none tabular-nums tracking-tight text-ink">{stunden(b.total_min)} h</span>
                  </div>
                  <ul className="mt-3 flex-1 space-y-1 text-[13px]">
                    {b.personen.map((p) => (
                      <li key={p.name} className="flex justify-between gap-3 text-ink2"><span className="truncate">{p.name}</span><span className="tabular-nums text-ink">{stunden(p.total_min)}</span></li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => void excelBuero(b)} className="btn-ghost mt-3 self-start">
                    <Download size={14} strokeWidth={2.4} aria-hidden="true" /> Excel für {b.buero}
                  </button>
                </div>
              ))}
            </div>
          ))}

          {tab === 'raster' && (raster.vorgaenge.length === 0 ? leer('Einträge') : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2/60">
                  <tr>
                    <th className={kopfZelle + ' sticky left-0 bg-[#f7f6f3] pl-5 text-left'}>Baustelle</th>
                    {raster.personen.map((p) => <th key={p.id} className="px-1.5 py-2.5 text-right text-[10px] font-semibold text-ink3">{p.name.split(' ').map((s, i, a) => (i < a.length - 1 ? s[0] + '.' : s)).join(' ')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {raster.vorgaenge.map((v) => (
                    <tr key={v.konto + v.regie} className={'border-t border-line ' + (v.regie ? 'bg-accent-soft' : 'hover:bg-surface-2/40')}>
                      <td className={'sticky left-0 whitespace-nowrap py-2 pl-5 pr-3 ' + (v.regie ? 'bg-accent-soft' : 'bg-white')}><span className="knr mr-1.5">{v.konto}</span>{v.bezeichnung}{v.regie && <span className="ml-1.5 text-[10px] font-semibold text-accent-deep">ZUSATZARBEIT</span>}</td>
                      {raster.personen.map((p) => <td key={p.id} className="px-1.5 py-2 text-right tabular-nums text-ink2">{v.min.has(p.id) ? stunden(v.min.get(p.id)!) : ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <p className="flex items-center gap-2 text-xs text-ink3">
          <FileSpreadsheet size={14} aria-hidden="true" />
          {lohnSichtbar
            ? <>Das Excel enthält: Lohn, Überstunden, je Temporärbüro ein Blatt (Person × Tag × Konto-Nr.){bueros.length > 0 ? ` — ${bueros.map((b) => b.buero).join(', ')}` : ''}, Stundenraster.</>
            : <>Lohnstunden und Temporärbüro-Abrechnung liegen beim Sekretariat.</>}
        </p>
      </div>
    </Shell>
  );
}
