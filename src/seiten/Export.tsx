import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, ausIso, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';
import { MONATE } from '../ui/Karten';
import {
  blattName,
  lohnZeilen,
  monatsGrenzen,
  monatsSpalten,
  temporaerBueroBlaetter,
  ueberstunden,
  wochenImMonat,
  wochenSpalten,
  wochenTitel,
  type LohnEintrag,
} from '../lib/lohn';

/**
 * Phase 5 — Übergabe. SORBA hat keinen Import (Arbnor, 27.08.):
 * Die Rasteransicht zeigt die freigegebenen Zahlen im Layout des Tagesrapports,
 * damit der Bauführer sehend tippt statt suchend. Das Excel geht ans Sekretariat
 * (Lohn, Überstunden) und ans Temporärbüro — je Büro ein Blatt, Person × Tag × Konto.
 *
 * Die Rechnerei liegt in src/lib/lohn.ts (mit Tests); hier nur Laden und Anzeigen.
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

const SEITE = 1000;
const ALLE = 'alle';

/** Woche aus ?woche=JJJJ-MM-TT (Montag der Woche), sonst Vorwoche. */
function startAusUrl(): { wochenStart: Date; zeitraum: Zeitraum } {
  const p = new URLSearchParams(window.location.search);
  const w = p.get('woche');
  const zeitraum: Zeitraum = p.get('zeitraum') === 'monat' ? 'monat' : 'woche';
  if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const d = ausIso(w);
    if (!Number.isNaN(d.getTime())) return { wochenStart: montag(d), zeitraum };
  }
  return { wochenStart: montag(addTage(new Date(), -7)), zeitraum };
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

function h(min: number): number {
  return Number(stunden(min));
}

export function Export() {
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
        // Überstunden seit Jahresbeginn: nur Zeilen mit Überstunden, unabhängig vom Team (die Person zählt)
        alle<JahresZeile>((von, bis) => {
          let q = c
            .from('zeiteintrag')
            .select('ueber_min,status,mitarbeiter:mitarbeiter_id(id,name,typ,temporaerbuero),tagesmeldung:tagesmeldung_id!inner(datum)')
            .gte('tagesmeldung.datum', jahresStart).lte('tagesmeldung.datum', bisIso).gt('ueber_min', 0);
          if (nurFrei) q = q.eq('status', 'freigegeben');
          return q.order('id').range(von, bis);
        }),
      ]);
      setZeilen(z);
      setJahr(j);
    } catch (e) {
      setFehler('Laden: ' + (e instanceof Error ? e.message : String(e)));
      setZeilen([]);
      setJahr([]);
    }
    setLaedt(false);
  }, [vonIso, bisIso, jahresStart, teamId, nurFrei]);
  useEffect(() => { void laden(); }, [laden]);

  const eintraege = useMemo(() => zeilen.map(zuEintrag), [zeilen]);
  const lohn = useMemo(() => lohnZeilen(eintraege), [eintraege]);
  const bueros = useMemo(() => temporaerBueroBlaetter(eintraege), [eintraege]);
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

  // Raster: Zeile = Konto (+ Regie getrennt), Spalte = Person
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

  function excel() {
    const wb = XLSX.utils.book_new();
    const namen = new Set<string>();
    const blatt = (name: string, inhalt: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inhalt), blattName(name, namen));

    // Lohn: Person × Tag (Woche) bzw. Person × KW (Monat), mit Summe
    const kopf = ['Name', 'Anstellung', 'Temporärbüro', ...spalten, zeitraum === 'monat' ? 'Monat h' : 'Total h', 'davon Über h', 'öV-Tage', 'km'];
    blatt('Lohn', [
      [`Lohnstunden ${titel}`], [], kopf,
      ...lohn.map((l) => [l.person.name, l.person.typ, l.person.temporaerbuero ?? '', ...werte(l).map(h), h(l.total_min), h(l.ueber_min), l.oevTage, l.km]),
    ]);

    // Überstunden: Zeitraum + seit Jahresbeginn
    blatt('Überstunden', [
      [`Überstunden ${titel}`], [], ['Name', 'Anstellung', `Über h ${zeitraum === 'monat' ? 'Monat' : 'Woche'}`, `Über h seit 1.1.${bisIso.slice(0, 4)}`],
      ...ueber.map((u) => [u.person.name, u.person.typ, h(u.zeitraum_min), h(u.jahr_min)]),
    ]);

    // Je Temporärbüro ein Blatt: Person × Tag × Konto — so prüft das Sekretariat die Rechnung des Büros Zeile für Zeile
    for (const b of bueros) {
      blatt(b.buero, [
        [`${b.buero} · ${titel}`], [],
        ['Name', 'Datum', 'Konto-Nr.', 'Normal h', 'Über h', 'Total h'],
        ...b.zeilen.map((z) => [z.name, kurz(ausIso(z.datum)) + z.datum.slice(0, 4), z.konto_nr, h(z.normal_min), h(z.ueber_min), h(z.normal_min + z.ueber_min)]),
        [],
        ['Summe je Person', '', '', 'Normal h', 'Über h', 'Total h'],
        ...b.personen.map((p) => [p.name, '', '', h(p.normal_min), h(p.ueber_min), h(p.total_min)]),
        ['Total Büro', '', '', '', '', h(b.total_min)],
      ]);
    }

    const rasterRows = raster.vorgaenge.map((v) => [v.konto, v.bezeichnung, v.regie ? 'Regie' : '', ...raster.personen.map((p) => h(v.min.get(p.id) ?? 0))]);
    blatt('SORBA-Raster', [[`SORBA-Raster ${titel}`], [], ['Konto', 'Baustelle', 'Art', ...raster.personen.map((p) => p.name)], ...rasterRows]);
    XLSX.writeFile(wb, `Rapport_${dateiTeil}.xlsx`);
  }

  const teamName = (id: string) => (id === ALLE ? 'alle Teams' : teams.find((t) => t.id === id)?.bezeichnung ?? '');
  const zeitraumText = zeitraum === 'monat' ? 'in diesem Monat' : 'in dieser Woche';

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-2xl font-semibold">Export</h1>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => blaettern(-1)} aria-label={zeitraum === 'monat' ? 'Monat zurück' : 'Woche zurück'}>‹</button>
            <span className="font-mono text-xs text-ink2">{titel}</span>
            <button type="button" className="btn-ghost" onClick={() => blaettern(1)} aria-label={zeitraum === 'monat' ? 'Monat vor' : 'Woche vor'}>›</button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Zeitraum">
            {(['woche', 'monat'] as const).map((z) => (
              <button key={z} type="button" onClick={() => setZeitraum(z)} className={'chip px-3 py-1 text-xs ' + (zeitraum === z ? 'chip-on' : '')}>
                {z === 'woche' ? 'Woche' : 'Monat'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={nurFrei} onChange={(e) => setNurFrei(e.target.checked)} /> nur Freigegebenes</label>
          <button type="button" onClick={excel} disabled={zeilen.length === 0} className="cta ml-auto w-auto px-4 py-2 text-sm disabled:opacity-50">Excel herunterladen</button>
        </div>

        {teams.length <= 8 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Team">
            {[{ id: ALLE, bezeichnung: 'alle Teams' }, ...teams].map((t) => (
              <button key={t.id} type="button" onClick={() => setTeamId(t.id)} className={'chip px-3 py-1 text-xs ' + (teamId === t.id ? 'chip-on' : '')}>
                {t.bezeichnung}
              </button>
            ))}
          </div>
        ) : (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="field w-auto py-1.5 text-sm" aria-label="Team">
            <option value={ALLE}>alle Teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.bezeichnung}</option>)}
          </select>
        )}

        {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}

        <section className="card overflow-x-auto p-0">
          <p className="lbl px-3 pt-3">SORBA-Raster — so tippt der Bauführer</p>
          {raster.vorgaenge.length === 0 ? (
            <p className="p-3 text-sm text-ink3">{laedt ? 'Lädt …' : `Keine ${nurFrei ? 'freigegebenen ' : ''}Einträge ${zeitraumText} (${teamName(teamId)}).`}</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line-strong">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink3">Vorgang</th>
                  {raster.personen.map((p) => <th key={p.id} className="px-1 py-2 text-right font-mono text-[10px] font-semibold text-ink3">{p.name.split(' ').map((s, i, a) => (i < a.length - 1 ? s[0] + '.' : s)).join(' ')}</th>)}
                </tr>
              </thead>
              <tbody>
                {raster.vorgaenge.map((v) => (
                  <tr key={v.konto + v.regie} className={'border-b border-line last:border-b-0 ' + (v.regie ? 'bg-accent-soft' : '')}>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="knr mr-1.5">{v.konto}</span>{v.bezeichnung}{v.regie && <span className="ml-1.5 font-mono text-[10px] font-semibold text-accent-deep">REGIE</span>}</td>
                    {raster.personen.map((p) => <td key={p.id} className="px-1 py-1.5 text-right font-mono tabular-nums">{v.min.has(p.id) ? stunden(v.min.get(p.id)!) : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card overflow-x-auto p-0">
          <p className="lbl px-3 pt-3">Lohnstunden — fürs Sekretariat</p>
          {lohn.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-line-strong">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink3">Person</th>
                {spalten.map((t) => <th key={t} className="px-1 py-2 text-right font-mono text-[10px] text-ink3">{t}</th>)}
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">{zeitraum === 'monat' ? 'Monat' : 'Total'}</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">öV/km</th>
              </tr></thead>
              <tbody>
                {lohn.map((l) => (
                  <tr key={l.person.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap">{l.person.name}{l.person.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">{l.person.temporaerbuero}</span>}</td>
                    {werte(l).map((t, i) => <td key={i} className="px-1 py-1.5 text-right font-mono tabular-nums">{t ? stunden(t) : ''}</td>)}
                    <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">{stunden(l.total_min)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-ink3">{l.oevTage ? `öV×${l.oevTage}` : l.km ? `${l.km} km` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {ueber.some((u) => u.zeitraum_min > 0 || u.jahr_min > 0) && (
          <section className="card overflow-x-auto p-0">
            <p className="lbl px-3 pt-3">Überstunden — {zeitraum === 'monat' ? 'Monat' : 'Woche'} und seit Jahresbeginn</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-line-strong">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink3">Person</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">{zeitraum === 'monat' ? 'Monat' : 'Woche'}</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">seit 1.1.</th>
              </tr></thead>
              <tbody>
                {ueber.filter((u) => u.zeitraum_min > 0 || u.jahr_min > 0).map((u) => (
                  <tr key={u.person.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap">{u.person.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{u.zeitraum_min ? stunden(u.zeitraum_min) : ''}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">{stunden(u.jahr_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="text-[11px] text-ink3">
          Das Excel enthält: Lohn, Überstunden, je Temporärbüro ein Blatt (Person × Tag × Konto-Nr.){bueros.length > 0 ? ` — ${bueros.map((b) => b.buero).join(', ')}` : ''}, SORBA-Raster.
        </p>
      </div>
    </Shell>
  );
}
