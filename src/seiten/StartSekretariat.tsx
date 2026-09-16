/**
 * Startseite Sekretariat: Stunden und Mitarbeitende — das, was ins Lohn-Excel geht.
 * Keine Regie, keine Kundenanrufe (Entscheid 17.09.): das Sekretariat tippt die Stunden ab, prüft, wer
 * gemeldet hat und was der Bauführer schon freigegeben hat, und holt sich den Export.
 * Zeigt nur Zahlen und Stände, nie Urteile (CLAUDE.md #1).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Kachel, NavKarte } from '../ui/Karten';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz, kw, lang, montag, stunden } from '../lib/datum';

interface Zeile {
  normal_min: number;
  ueber_min: number;
  status: string;
  mitarbeiter: { id: string; name: string; typ: string; temporaerbuero: string | null } | null;
  tagesmeldung: { datum: string; team: { bezeichnung: string } | null } | null;
}

interface Person {
  id: string;
  name: string;
  typ: string;
  buero: string | null;
  tage: Set<string>;
  normal: number;
  ueber: number;
  frei: number;
  offen: number;
  teams: Set<string>;
}

type Zeitraum = 'diese' | 'vorwoche' | 'monat';

export function StartSekretariat() {
  const heute = new Date();
  const [zeitraum, setZeitraum] = useState<Zeitraum>(() => (heute.getDay() === 1 || heute.getDay() === 2 ? 'vorwoche' : 'diese'));
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [aktive, setAktive] = useState(0);
  const [laedt, setLaedt] = useState(true);

  // Zeitraum → von/bis (ISO) und Titel
  const { von, bis, titel, exportLink } = useMemo(() => {
    if (zeitraum === 'monat') {
      const start = new Date(heute.getFullYear(), heute.getMonth(), 1, 12);
      const ende = new Date(heute.getFullYear(), heute.getMonth() + 1, 0, 12);
      return { von: iso(start), bis: iso(ende), titel: `${start.toLocaleDateString('de-CH', { month: 'long' })} ${start.getFullYear()}`, exportLink: `/export?zeitraum=monat&woche=${iso(montag(start))}` };
    }
    const start = zeitraum === 'vorwoche' ? montag(addTage(heute, -7)) : montag(heute);
    return { von: iso(start), bis: iso(addTage(start, 6)), titel: `KW ${kw(start)} · ${kurz(start)} – ${kurz(addTage(start, 6))}`, exportLink: `/export?woche=${iso(start)}` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeitraum]);

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const [z, m] = await Promise.all([
        c.from('zeiteintrag')
          .select('normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(id,name,typ,temporaerbuero),tagesmeldung:tagesmeldung_id!inner(datum,team:team_id(bezeichnung))')
          .gte('tagesmeldung.datum', von)
          .lte('tagesmeldung.datum', bis)
          .limit(5000),
        c.from('mitarbeiter').select('id', { count: 'exact', head: true }).eq('aktiv', true),
      ]);
      setZeilen((z.data ?? []) as unknown as Zeile[]);
      setAktive(m.count ?? 0);
      setLaedt(false);
    })();
  }, [von, bis]);

  // Pro Person: Tage, Normal, Überstunden, freigegeben, offen
  const personen = useMemo(() => {
    const m = new Map<string, Person>();
    for (const z of zeilen) {
      if (!z.mitarbeiter || !z.tagesmeldung) continue;
      const p = m.get(z.mitarbeiter.id) ?? { id: z.mitarbeiter.id, name: z.mitarbeiter.name, typ: z.mitarbeiter.typ, buero: z.mitarbeiter.temporaerbuero, tage: new Set<string>(), normal: 0, ueber: 0, frei: 0, offen: 0, teams: new Set<string>() };
      const min = z.normal_min + z.ueber_min;
      p.tage.add(z.tagesmeldung.datum);
      p.normal += z.normal_min;
      p.ueber += z.ueber_min;
      if (z.status === 'freigegeben') p.frei += min; else p.offen += min;
      if (z.tagesmeldung.team) p.teams.add(z.tagesmeldung.team.bezeichnung);
      m.set(p.id, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [zeilen]);

  const summe = (f: (p: Person) => number) => personen.reduce((s, p) => s + f(p), 0);
  const total = summe((p) => p.normal + p.ueber);
  const ueber = summe((p) => p.ueber);
  const frei = summe((p) => p.frei);
  const offen = summe((p) => p.offen);
  const temporaer = personen.filter((p) => p.typ === 'temporaer');
  const bueros = useMemo(() => {
    const m = new Map<string, { min: number; leute: number }>();
    for (const p of temporaer) {
      const b = p.buero ?? 'ohne Büro';
      const e = m.get(b) ?? { min: 0, leute: 0 };
      e.min += p.normal + p.ueber;
      e.leute += 1;
      m.set(b, e);
    }
    return [...m.entries()].sort((a, b) => b[1].min - a[1].min);
  }, [temporaer]);

  const zeitraeume: { key: Zeitraum; label: string }[] = [
    { key: 'vorwoche', label: 'Vorwoche' },
    { key: 'diese', label: 'Diese Woche' },
    { key: 'monat', label: 'Monat' },
  ];

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="lbl mb-0.5">Sekretariat · {lang(heute)}</p>
            <h1 className="font-display text-2xl font-semibold lg:text-3xl">Stunden {titel}</h1>
          </div>
          <div className="flex gap-1.5">
            {zeitraeume.map((z) => (
              <button key={z.key} type="button" onClick={() => setZeitraum(z.key)} className={'chip px-3 py-1.5 text-xs ' + (zeitraum === z.key ? 'chip-on' : '')}>{z.label}</button>
            ))}
          </div>
        </header>

        {laedt ? (
          <div className="card text-sm text-ink3">Lädt …</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
              <Kachel zu={exportLink} wert={`${stunden(total)} h`} label={`Stunden ${zeitraum === 'monat' ? 'im Monat' : 'in der Woche'} · ${personen.length} von ${aktive} Mitarbeitenden`} />
              <Kachel zu={exportLink} wert={`${stunden(ueber)} h`} label="Überstunden" farbe={ueber > 0 ? 'gelb' : 'neutral'} />
              <Kachel zu={exportLink} wert={`${stunden(frei)} h`} label="vom Bauführer freigegeben — bereit für den Lohn" farbe="gruen" />
              <Kachel zu={exportLink} wert={`${stunden(offen)} h`} label={offen > 0 ? 'noch nicht freigegeben — der Bauführer prüft' : 'alles freigegeben'} farbe={offen > 0 ? 'gelb' : 'gruen'} />
            </div>

            {offen > 0 && (
              <p className="rounded-[12px] border border-amber/40 bg-amber-soft px-4 py-2.5 text-sm text-amber-deep">
                {stunden(offen)} h sind noch nicht freigegeben. Sie stehen im Lohn-Excel als «offen» — erst nach der Freigabe des Bauführers sind sie definitiv.
              </p>
            )}

            <section className="card p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2">
                <h2 className="lbl mb-0">Stunden je Mitarbeiter · {personen.length}</h2>
                <Link to={exportLink} className="text-xs font-semibold text-steel">Lohn-Excel herunterladen ›</Link>
              </div>
              {personen.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-ink3">Noch keine Stunden in diesem Zeitraum.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-[10px] font-semibold uppercase tracking-wide text-ink3">
                        <th className="px-4 pb-2 text-left font-semibold">Mitarbeiter</th>
                        <th className="px-2 pb-2 text-left font-semibold">Team</th>
                        <th className="px-2 pb-2 text-right font-semibold">Tage</th>
                        <th className="px-2 pb-2 text-right font-semibold">Normal</th>
                        <th className="px-2 pb-2 text-right font-semibold">Überstunden</th>
                        <th className="px-2 pb-2 text-right font-semibold">Total</th>
                        <th className="px-4 pb-2 text-right font-semibold">Stand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personen.map((p) => (
                        <tr key={p.id} className="border-t border-line">
                          <td className="px-4 py-2">
                            <span className="font-medium">{p.name}</span>
                            {p.typ === 'temporaer' && <span className="ml-1.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink3">temp{p.buero ? ` · ${p.buero}` : ''}</span>}
                          </td>
                          <td className="px-2 py-2 text-ink3">{[...p.teams].join(', ')}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{p.tage.size}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{stunden(p.normal)}</td>
                          <td className={'px-2 py-2 text-right font-mono tabular-nums ' + (p.ueber > 0 ? 'font-semibold text-amber-deep' : 'text-ink3')}>{p.ueber > 0 ? stunden(p.ueber) : '–'}</td>
                          <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{stunden(p.normal + p.ueber)}</td>
                          <td className="px-4 py-2 text-right text-xs">
                            {p.offen === 0
                              ? <span className="font-semibold text-good-deep">✓ freigegeben</span>
                              : p.frei === 0
                                ? <span className="text-ink3">offen</span>
                                : <span className="text-amber-deep">{stunden(p.offen)} h offen</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line-strong font-semibold">
                        <td className="px-4 py-2" colSpan={3}>Total</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{stunden(summe((p) => p.normal))}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-amber-deep">{stunden(ueber)}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{stunden(total)}</td>
                        <td className="px-4 py-2 text-right text-xs text-ink3">{stunden(frei)} h frei · {stunden(offen)} h offen</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            {bueros.length > 0 && (
              <section className="card">
                <h2 className="lbl">Temporärbüros · für deren Rechnung</h2>
                <div className="divide-y divide-line">
                  {bueros.map(([b, e]) => (
                    <div key={b} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                      <span>{b} <span className="text-xs text-ink3">· {e.leute} {e.leute === 1 ? 'Person' : 'Personen'}</span></span>
                      <span className="font-mono tabular-nums">{stunden(e.min)} h</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-ink3">Im Lohn-Excel hat jedes Temporärbüro ein eigenes Blatt: Person × Tag × Konto-Nr.</p>
              </section>
            )}
          </>
        )}

        <nav className="grid gap-3 lg:hidden">
          <NavKarte zu="/export" titel="Export" text="Lohn-Excel, Überstunden, Temporärbüro, SORBA-Raster" />
          <NavKarte zu="/board" titel="Board" text="Jahresplan — welches Team wann wo" />
          <NavKarte zu="/verwaltung" titel="Verwaltung" text="Mitarbeitende, Teams, Kunden, Baustellen" />
        </nav>
      </div>
    </Shell>
  );
}
