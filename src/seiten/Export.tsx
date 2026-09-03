import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, montag, stunden, WOCHENTAGE } from '../lib/datum';

/**
 * Phase 5 — Übergabe. SORBA hat keinen Import (Arbnor, 27.08.):
 * Die Rasteransicht zeigt die freigegebenen Zahlen im Layout des Tagesrapports,
 * damit der Bauführer sehend tippt statt suchend. Das Excel geht ans Sekretariat
 * (Lohn) und ans Temporärbüro — für die gibt es einen Import.
 */

interface Zeile {
  normal_min: number; ueber_min: number; oev: boolean; km: number; status: string;
  mitarbeiter: { id: string; name: string; typ: string; funktion: string; temporaerbuero: string | null };
  tagesmeldung: { datum: string; normalfall: boolean; team_id: string | null; baustelle: { konto_nr: string; bezeichnung: string | null } | null };
}
interface Team { id: string; bezeichnung: string }

export function Export() {
  const [wochenStart, setWochenStart] = useState<Date>(() => montag(addTage(new Date(), -7)));
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [nurFrei, setNurFrei] = useState(true);
  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung').order('bezeichnung').then(({ data }) => {
      if (data) { const s = data.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })); setTeams(s); if (!teamId && s[0]) setTeamId(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const laden = useCallback(async () => {
    if (!supabase) return;
    let q = supabase
      .from('zeiteintrag')
      .select('normal_min,ueber_min,oev,km,status,mitarbeiter:mitarbeiter_id(id,name,typ,funktion,temporaerbuero),tagesmeldung:tagesmeldung_id!inner(datum,normalfall,team_id,baustelle:baustelle_id(konto_nr,bezeichnung))')
      .gte('tagesmeldung.datum', vonIso).lte('tagesmeldung.datum', bisIso);
    if (teamId !== 'alle' && teamId) q = q.eq('tagesmeldung.team_id', teamId);
    const { data } = await q;
    setZeilen(((data ?? []) as unknown as Zeile[]).filter((z) => !nurFrei || z.status === 'freigegeben'));
  }, [vonIso, bisIso, teamId, nurFrei]);
  useEffect(() => { void laden(); }, [laden]);

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

  // Lohn: Person × Tag
  const lohn = useMemo(() => {
    const m = new Map<string, { person: Zeile['mitarbeiter']; tage: number[]; ueber: number; oevTage: number; km: number }>();
    for (const z of zeilen) {
      const p = m.get(z.mitarbeiter.id) ?? { person: z.mitarbeiter, tage: [0, 0, 0, 0, 0, 0, 0], ueber: 0, oevTage: 0, km: 0 };
      const idx = (new Date(z.tagesmeldung.datum + 'T12:00:00').getDay() + 6) % 7;
      p.tage[idx] += z.normal_min + z.ueber_min;
      p.ueber += z.ueber_min;
      if (z.oev && z.tagesmeldung.normalfall) p.oevTage += 1;
      if (z.tagesmeldung.normalfall) p.km += z.km;
      m.set(z.mitarbeiter.id, p);
    }
    return [...m.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
  }, [zeilen]);

  function excel() {
    const wb = XLSX.utils.book_new();
    const kopf = ['Name', 'Anstellung', 'Temporärbüro', ...WOCHENTAGE, 'Total h', 'davon Über h', 'öV-Tage', 'km'];
    const lohnRows = lohn.map((l) => [l.person.name, l.person.typ, l.person.temporaerbuero ?? '', ...l.tage.map((t) => Number(stunden(t))), Number(stunden(l.tage.reduce((a, b) => a + b, 0))), Number(stunden(l.ueber)), l.oevTage, l.km]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Lohnstunden KW ${kw(wochenStart)} · ${vonIso} – ${bisIso}`], [], kopf, ...lohnRows]), 'Lohn');
    const temp = lohn.filter((l) => l.person.typ === 'temporaer');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Temporäre KW ${kw(wochenStart)}`], [], ['Temporärbüro', 'Name', 'Total h', 'davon Über h'], ...temp.sort((a, b) => (a.person.temporaerbuero ?? '').localeCompare(b.person.temporaerbuero ?? '')).map((l) => [l.person.temporaerbuero ?? '', l.person.name, Number(stunden(l.tage.reduce((a, b) => a + b, 0))), Number(stunden(l.ueber))])]), 'Temporärbüro');
    const rasterRows = raster.vorgaenge.map((v) => [v.konto, v.bezeichnung, v.regie ? 'Regie' : '', ...raster.personen.map((p) => Number(stunden(v.min.get(p.id) ?? 0)))]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`SORBA-Raster KW ${kw(wochenStart)}`], [], ['Konto', 'Baustelle', 'Art', ...raster.personen.map((p) => p.name)], ...rasterRows]), 'SORBA-Raster');
    XLSX.writeFile(wb, `Rapport_KW${kw(wochenStart)}_${vonIso}.xlsx`);
  }

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Export</h1>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))}>‹</button>
            <span className="font-mono text-xs text-ink2">KW {kw(wochenStart)} · {kurz(wochenStart)}–{kurz(addTage(wochenStart, 6))}</span>
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, 7))}>›</button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="field w-auto py-1.5 text-sm">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.bezeichnung}</option>)}
            <option value="alle">alle Teams</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={nurFrei} onChange={(e) => setNurFrei(e.target.checked)} /> nur Freigegebenes</label>
          <button type="button" onClick={excel} disabled={zeilen.length === 0} className="cta ml-auto w-auto px-4 py-2 text-sm">Excel herunterladen</button>
        </div>

        <section className="card overflow-x-auto p-0">
          <p className="lbl px-3 pt-3">SORBA-Raster — so tippt der Bauführer</p>
          {raster.vorgaenge.length === 0 ? (
            <p className="p-3 text-sm text-ink3">Keine {nurFrei ? 'freigegebenen ' : ''}Einträge in dieser Woche.</p>
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
                {WOCHENTAGE.map((t) => <th key={t} className="px-1 py-2 text-right font-mono text-[10px] text-ink3">{t}</th>)}
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">Total</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] text-ink3">öV/km</th>
              </tr></thead>
              <tbody>
                {lohn.map((l) => (
                  <tr key={l.person.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap">{l.person.name}{l.person.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">{l.person.temporaerbuero}</span>}</td>
                    {l.tage.map((t, i) => <td key={i} className="px-1 py-1.5 text-right font-mono tabular-nums">{t ? stunden(t) : ''}</td>)}
                    <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">{stunden(l.tage.reduce((a, b) => a + b, 0))}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-ink3">{l.oevTage ? `öV×${l.oevTage}` : l.km ? `${l.km} km` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <p className="text-[11px] text-ink3">Das Excel enthält drei Blätter: Lohn, Temporärbüro (nach Büro gruppiert), SORBA-Raster.</p>
      </div>
    </Shell>
  );
}
