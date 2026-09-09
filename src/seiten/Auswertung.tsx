/**
 * Regie-Auswertung fürs Büro: Wie viel Regie pro Baustelle und Kunde, pro Monat, in welchem Stand.
 * Liest die Sichten `regie_auswertung` und `zusatzauftrag_ohne_regie_gruende` (Migration 0009).
 * Beträge in Rappen, Ausgabe nur über formatChf. Keine Urteile — Zahlen und Stände (CLAUDE.md #1).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { formatChf } from '../lib/tarif';
import { MONATE } from '../ui/Karten';

interface Zeile {
  monat: string; // JJJJ-MM-TT (Monatsanfang)
  baustelle_id: string;
  konto_nr: string;
  baustelle_bezeichnung: string | null;
  kunde_id: string | null;
  kunde_name: string | null;
  status: string;
  anzahl: number;
  summe_rappen: number;
}
interface Grund { monat: string; erledigt_grund: string; anzahl: number }

const GRUND_TEXT: Record<string, string> = { abgesagt: 'vom Kunden abgesagt', pauschale: 'in der Pauschale', kulanz: 'Kulanz', doppelt: 'doppelt erfasst' };
const BEIM_KUNDEN = new Set(['versendet', 'rueckfrage', 'frist_abgelaufen']);

function monatsAnfang(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monatsName(iso: string): string {
  const [j, m] = iso.split('-').map(Number);
  return `${MONATE[m - 1]} ${j}`;
}

export function Auswertung() {
  const heute = new Date();
  const monate = useMemo(() => Array.from({ length: 6 }, (_, i) => monatsAnfang(new Date(heute.getFullYear(), heute.getMonth() - i, 1))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [monat, setMonat] = useState(monate[0]);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [gruende, setGruende] = useState<Grund[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    setLaedt(true);
    void (async () => {
      const [a, g] = await Promise.all([
        c.from('regie_auswertung').select('*').in('monat', monate),
        c.from('zusatzauftrag_ohne_regie_gruende').select('*').in('monat', monate),
      ]);
      if (a.error) {
        setFehler(/does not exist|schema cache/i.test(a.error.message) ? 'Die Auswertung braucht Migration 0009 — bitte im Supabase-SQL-Editor ausführen.' : a.error.message);
      } else {
        setFehler('');
        setZeilen((a.data ?? []) as Zeile[]);
      }
      setGruende((g.data ?? []) as Grund[]);
      setLaedt(false);
    })();
  }, [monate]);

  // Pro Baustelle: Entwurf / beim Kunden / bestätigt / total
  const proBaustelle = useMemo(() => {
    const m = new Map<string, { konto_nr: string; bezeichnung: string; kunde: string; entwurf: number; kunde_r: number; bestaetigt: number; anzahl: number }>();
    for (const z of zeilen.filter((x) => x.monat === monat)) {
      const e = m.get(z.baustelle_id) ?? { konto_nr: z.konto_nr, bezeichnung: z.baustelle_bezeichnung ?? '', kunde: z.kunde_name ?? '—', entwurf: 0, kunde_r: 0, bestaetigt: 0, anzahl: 0 };
      if (z.status === 'entwurf') e.entwurf += z.summe_rappen;
      else if (BEIM_KUNDEN.has(z.status)) e.kunde_r += z.summe_rappen;
      else if (z.status === 'bestaetigt') e.bestaetigt += z.summe_rappen;
      e.anzahl += z.anzahl;
      m.set(z.baustelle_id, e);
    }
    return [...m.values()].sort((a, b) => b.entwurf + b.kunde_r + b.bestaetigt - (a.entwurf + a.kunde_r + a.bestaetigt));
  }, [zeilen, monat]);

  const summe = (f: (z: (typeof proBaustelle)[number]) => number) => proBaustelle.reduce((s, z) => s + f(z), 0);
  const total = summe((z) => z.entwurf + z.kunde_r + z.bestaetigt);
  const monatVorher = monate[monate.indexOf(monat) + 1];
  const totalVorher = zeilen.filter((z) => z.monat === monatVorher).reduce((s, z) => s + z.summe_rappen, 0);

  // Pro Kunde (für den Geschäftsführer: wer bestellt Regie, wer bestätigt)
  const proKunde = useMemo(() => {
    const m = new Map<string, { kunde: string; total: number; bestaetigt: number; anzahl: number }>();
    for (const z of zeilen.filter((x) => x.monat === monat)) {
      const k = z.kunde_name ?? '— ohne Kunde —';
      const e = m.get(k) ?? { kunde: k, total: 0, bestaetigt: 0, anzahl: 0 };
      e.total += z.summe_rappen;
      if (z.status === 'bestaetigt') e.bestaetigt += z.summe_rappen;
      e.anzahl += z.anzahl;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [zeilen, monat]);

  const gruendeMonat = gruende.filter((g) => g.monat === monat);

  function csv() {
    const kopf = ['Konto-Nr', 'Baustelle', 'Kunde', 'Rapporte', 'Entwurf CHF', 'Beim Kunden CHF', 'Bestätigt CHF', 'Total CHF'];
    const zeilenCsv = proBaustelle.map((z) => [z.konto_nr, z.bezeichnung, z.kunde, z.anzahl, z.entwurf / 100, z.kunde_r / 100, z.bestaetigt / 100, (z.entwurf + z.kunde_r + z.bestaetigt) / 100]);
    const text = [kopf, ...zeilenCsv].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `regie-${monat.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="lbl mb-0.5">Regie</p>
            <h1 className="font-display text-2xl font-bold">Auswertung</h1>
          </div>
          {proBaustelle.length > 0 && <button type="button" className="btn-ghost" onClick={csv}>CSV herunterladen</button>}
        </header>

        <div className="flex flex-wrap gap-1.5">
          {monate.map((m) => (
            <button key={m} type="button" onClick={() => setMonat(m)} className={'px-3 py-1.5 text-xs ' + (m === monat ? 'chip chip-on' : 'chip')}>{monatsName(m)}</button>
          ))}
        </div>

        {fehler && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">{fehler}</p>}
        {laedt && !fehler && <p className="card text-sm text-ink3">Lädt …</p>}

        {!laedt && !fehler && (
          <>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
              <div className="card"><span className="block font-display text-2xl font-extrabold tabular-nums">{formatChf(total)}</span><span className="block text-xs text-ink3">Regie im {monatsName(monat)}{monatVorher ? ` · Vormonat ${formatChf(totalVorher)}` : ''}</span></div>
              <div className="card"><span className="block font-display text-2xl font-extrabold tabular-nums">{formatChf(summe((z) => z.entwurf))}</span><span className="block text-xs text-ink3">noch Entwurf</span></div>
              <div className="card"><span className="block font-display text-2xl font-extrabold tabular-nums">{formatChf(summe((z) => z.kunde_r))}</span><span className="block text-xs text-ink3">beim Kunden</span></div>
              <div className="card"><span className="block font-display text-2xl font-extrabold tabular-nums text-good-deep">{formatChf(summe((z) => z.bestaetigt))}</span><span className="block text-xs text-ink3">bestätigt</span></div>
            </div>

            <section className="card p-0">
              <p className="lbl px-4 pt-4">Pro Baustelle · {proBaustelle.length}</p>
              {proBaustelle.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-ink3">Keine Regierapporte in diesem Monat.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-[10px] font-semibold uppercase tracking-wide text-ink3">
                        <th className="px-4 pb-2 text-left font-semibold">Baustelle</th>
                        <th className="px-2 pb-2 text-left font-semibold">Kunde</th>
                        <th className="px-2 pb-2 text-right font-semibold">Rapporte</th>
                        <th className="px-2 pb-2 text-right font-semibold">Entwurf</th>
                        <th className="px-2 pb-2 text-right font-semibold">Beim Kunden</th>
                        <th className="px-2 pb-2 text-right font-semibold">Bestätigt</th>
                        <th className="px-4 pb-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proBaustelle.map((z) => (
                        <tr key={z.konto_nr} className="border-t border-line">
                          <td className="px-4 py-2"><span className="knr">{z.konto_nr}</span> <span className="ml-1">{z.bezeichnung}</span></td>
                          <td className="px-2 py-2 text-ink2">{z.kunde}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{z.anzahl}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink2">{z.entwurf ? formatChf(z.entwurf) : '–'}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink2">{z.kunde_r ? formatChf(z.kunde_r) : '–'}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-good-deep">{z.bestaetigt ? formatChf(z.bestaetigt) : '–'}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">{formatChf(z.entwurf + z.kunde_r + z.bestaetigt)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line-strong font-semibold">
                        <td className="px-4 py-2" colSpan={2}>Total</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{summe((z) => z.anzahl)}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{formatChf(summe((z) => z.entwurf))}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{formatChf(summe((z) => z.kunde_r))}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-good-deep">{formatChf(summe((z) => z.bestaetigt))}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatChf(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card">
                <p className="lbl">Pro Kunde</p>
                {proKunde.length === 0 ? <p className="text-sm text-ink3">—</p> : (
                  <div className="divide-y divide-line">
                    {proKunde.map((k) => (
                      <div key={k.kunde} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{k.kunde} <span className="text-xs text-ink3">· {k.anzahl}</span></span>
                        <span className="shrink-0 font-mono tabular-nums">{formatChf(k.total)}{k.bestaetigt > 0 && <span className="ml-2 text-xs text-good-deep">{Math.round((k.bestaetigt / k.total) * 100)} % bestätigt</span>}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="card">
                <p className="lbl">Bestellt, aber ohne Regie erledigt</p>
                {gruendeMonat.length === 0 ? <p className="text-sm text-ink3">Keine in diesem Monat.</p> : (
                  <div className="divide-y divide-line">
                    {gruendeMonat.map((g) => (
                      <div key={g.erledigt_grund} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                        <span>{GRUND_TEXT[g.erledigt_grund] ?? g.erledigt_grund}</span>
                        <span className="font-mono tabular-nums">{g.anzahl}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-ink3">Aus der Seite <Link to="/zusatzauftrag" className="font-semibold text-steel">Zusatzauftrag</Link>, Knopf «erledigt ohne Regie».</p>
              </section>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
