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
            <h1 className="font-display text-2xl font-semibold">Auswertung</h1>
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
              <div className="card"><span className="block text-2xl font-semibold tracking-tight tabular-nums">{formatChf(total)}</span><span className="mt-0.5 block text-xs text-ink3">Regie im {monatsName(monat)}{monatVorher ? ` · Vormonat ${formatChf(totalVorher)}` : ''}</span></div>
              <div className="card bg-amber-soft"><span className="block text-2xl font-semibold tracking-tight tabular-nums text-amber-deep">{formatChf(summe((z) => z.entwurf))}</span><span className="mt-0.5 block text-xs text-amber-deep/70">noch Entwurf</span></div>
              <div className="card bg-steel-soft"><span className="block text-2xl font-semibold tracking-tight tabular-nums text-steel">{formatChf(summe((z) => z.kunde_r))}</span><span className="mt-0.5 block text-xs text-steel/70">beim Kunden</span></div>
              <div className="card bg-good-soft"><span className="block text-2xl font-semibold tracking-tight tabular-nums text-good-deep">{formatChf(summe((z) => z.bestaetigt))}</span><span className="mt-0.5 block text-xs text-good-deep/70">bestätigt</span></div>
            </div>

            <section className="card p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
                <p className="lbl mb-0">Pro Baustelle · {proBaustelle.length}</p>
                <p className="flex flex-wrap gap-x-3 text-[11px] text-ink3">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber" />Entwurf</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-steel" />beim Kunden</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-good" />bestätigt</span>
                </p>
              </div>
              {proBaustelle.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-ink3">Keine Regierapporte in diesem Monat.</p>
              ) : (
                <div className="mt-3 divide-y divide-line">
                  {proBaustelle.map((z) => {
                    const t = z.entwurf + z.kunde_r + z.bestaetigt;
                    const teile = [
                      { wert: z.bestaetigt, farbe: 'bg-good', text: 'text-good-deep', label: 'bestätigt' },
                      { wert: z.kunde_r, farbe: 'bg-steel', text: 'text-steel', label: 'beim Kunden' },
                      { wert: z.entwurf, farbe: 'bg-amber', text: 'text-amber-deep', label: 'Entwurf' },
                    ].filter((x) => x.wert > 0);
                    return (
                      <div key={z.konto_nr} className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium"><span className="knr">{z.konto_nr}</span> <span className="ml-1">{z.bezeichnung}</span></p>
                          <p className="truncate text-xs text-ink3">{z.kunde} · {z.anzahl} {z.anzahl === 1 ? 'Rapport' : 'Rapporte'}</p>
                        </div>
                        <div className="min-w-0">
                          {/* Ein Balken je Baustelle: wie viel davon schon bestätigt, beim Kunden oder noch Entwurf ist */}
                          <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-ground">
                            {teile.map((x) => <span key={x.label} className={x.farbe} style={{ width: `${(x.wert / t) * 100}%` }} />)}
                          </div>
                          <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                            {teile.length === 1
                              ? <span className={teile[0].text}>alles {teile[0].label}</span>
                              : teile.map((x) => <span key={x.label} className={x.text + ' whitespace-nowrap'}><span className="font-mono tabular-nums">{formatChf(x.wert)}</span> {x.label}</span>)}
                          </p>
                        </div>
                        <p className="text-right font-mono text-sm font-semibold tabular-nums">{formatChf(t)}</p>
                      </div>
                    );
                  })}
                  <div className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm font-semibold">
                    <span>Total · {summe((z) => z.anzahl)} Rapporte</span>
                    <span className="font-mono tabular-nums">{formatChf(total)}</span>
                  </div>
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
                        <span className="min-w-0 truncate">{k.kunde} <span className="text-xs text-ink3">· {k.anzahl} {k.anzahl === 1 ? 'Rapport' : 'Rapporte'}</span></span>
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
