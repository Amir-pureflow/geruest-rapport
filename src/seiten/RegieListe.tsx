/**
 * Regierapporte: drei Spalten nebeneinander — der Weg des Geldes von links nach rechts.
 * Entwürfe (Bernstein) · Beim Kunden (Stahlblau) · Bestätigt (Grün). Jede Spalte: farbiger Kopf mit Summe,
 * darunter eine ruhige Zeile pro Rapport. Überfällige Rapporte sind rot hinterlegt. Keine Urteile, nur Stände (#1).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Send, CheckCircle2, X, Check, Search } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { formatChf } from '../lib/tarif';

interface Zeile {
  id: string;
  nummer: string | null;
  status: string;
  betrag_rappen: number | null;
  frist_bis: string | null;
  erstellt_am: string;
  versendet_am: string | null;
  bestaetigt_am: string | null;
  baustelle: { bezeichnung: string | null; konto_nr: string } | null;
}

type Gruppe = 'entwurf' | 'kunde' | 'bestaetigt';

const GRUPPE_VON: Record<string, Gruppe> = {
  entwurf: 'entwurf',
  versendet: 'kunde',
  rueckfrage: 'kunde',
  frist_abgelaufen: 'kunde',
  bestaetigt: 'bestaetigt',
};

const GRUPPEN: { key: Gruppe; titel: string; text: string; icon: typeof FileText; kopf: string; leer: string }[] = [
  { key: 'entwurf', titel: 'Entwürfe', text: 'noch nicht verschickt', icon: FileText, kopf: 'bg-amber', leer: 'Keine Entwürfe — Regierapporte entstehen aus der Wochenübersicht.' },
  { key: 'kunde', titel: 'Beim Kunden', text: 'warten auf die Unterschrift', icon: Send, kopf: 'bg-steel', leer: 'Nichts beim Kunden.' },
  { key: 'bestaetigt', titel: 'Bestätigt', text: 'bereit für SORBA', icon: CheckCircle2, kopf: 'bg-good', leer: 'Noch nichts bestätigt.' },
];

function kurz(ts: string): string {
  const d = new Date(ts.length === 10 ? ts + 'T12:00:00' : ts);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Zweite Zeile je Rapport: Datum des Standes — beim Kunden die Frist, in Worten und in Rot, wenn sie verstrichen ist. */
function zeile2(z: Zeile, gruppe: Gruppe, heuteIso: string): { text: string; warn: 'rot' | 'gelb' | null } {
  if (gruppe === 'entwurf') return { text: kurz(z.erstellt_am), warn: null };
  if (gruppe === 'bestaetigt') return { text: kurz(z.bestaetigt_am ?? z.versendet_am ?? z.erstellt_am), warn: null };
  if (z.status === 'rueckfrage') return { text: 'Rückfrage des Kunden', warn: 'gelb' };
  const tage = z.frist_bis ? Math.round((new Date(z.frist_bis + 'T12:00:00').getTime() - new Date(heuteIso + 'T12:00:00').getTime()) / 86400000) : null;
  if (z.status === 'frist_abgelaufen' || (tage !== null && tage < 0)) return { text: `Frist verstrichen · ${z.frist_bis ? kurz(z.frist_bis) : ''}`.trim(), warn: 'rot' };
  if (tage === null) return { text: z.versendet_am ? `verschickt ${kurz(z.versendet_am)}` : 'verschickt', warn: null };
  return { text: tage === 0 ? 'Frist heute' : tage === 1 ? 'noch 1 Tag' : `noch ${tage} Tage`, warn: tage === 0 ? 'gelb' : null };
}

/** Baustellen-Filter als eigenes Auswahlfenster (kein Browser-Select): Suche, Anzahl je Baustelle, Haken bei der gewählten. */
function BaustellenWahl({ baustellen, wert, setzen }: { baustellen: { konto_nr: string; bezeichnung: string; n: number }[]; wert: string; setzen: (knr: string) => void }) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!offen) return;
    setSuche('');
    setTimeout(() => feld.current?.focus(), 0);
    const zu = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOffen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffen(false); };
    document.addEventListener('mousedown', zu);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('keydown', esc); };
  }, [offen]);
  const gewaehlt = baustellen.find((b) => b.konto_nr === wert);
  const q = suche.trim().toLowerCase();
  const treffer = q ? baustellen.filter((b) => b.konto_nr.includes(q) || b.bezeichnung.toLowerCase().includes(q)) : baustellen;
  return (
    <div ref={box} className="relative">
      <span className="flex items-center gap-1">
        <button type="button" onClick={() => setOffen((o) => !o)} aria-expanded={offen} className={'chip flex max-w-[280px] items-center gap-1.5 px-3 py-1.5 text-xs ' + (wert ? 'chip-on' : '')}>
          <span className="truncate">{gewaehlt ? <><span className="font-mono">{gewaehlt.konto_nr}</span> {gewaehlt.bezeichnung}</> : 'Alle Baustellen'}</span>
          <ChevronDown size={14} className={'shrink-0 transition-transform ' + (offen ? 'rotate-180' : '')} aria-hidden="true" />
        </button>
        {wert && (
          <button type="button" onClick={() => setzen('')} aria-label="Baustellen-Filter aufheben" className="grid h-8 w-8 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={15} /></button>
        )}
      </span>
      {offen && (
        <div className="absolute right-0 z-30 mt-2 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgb(17_17_19/0.05),0_16px_40px_-8px_rgb(17_17_19/0.18)]">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
            <input ref={feld} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Baustelle oder Nummer …" className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            <button type="button" onClick={() => { setzen(''); setOffen(false); }} className={'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ground ' + (!wert ? 'font-medium text-ink' : 'text-ink2')}>
              <span>Alle Baustellen</span>
              {!wert && <Check size={15} className="text-accent" aria-hidden="true" />}
            </button>
            {treffer.map((b) => {
              const aktiv = b.konto_nr === wert;
              return (
                <button key={b.konto_nr} type="button" onClick={() => { setzen(b.konto_nr); setOffen(false); }} className={'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ground ' + (aktiv ? 'bg-accent-soft/60' : '')}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="knr">{b.konto_nr}</span>
                    <span className={'truncate ' + (aktiv ? 'font-medium text-ink' : 'text-ink2')}>{b.bezeichnung || 'Baustelle'}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-ink3">
                    {b.n}
                    {aktiv && <Check size={15} className="text-accent" aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
            {treffer.length === 0 && <p className="px-3 py-3 text-sm text-ink3">Nichts gefunden.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function RegieListe() {
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [laedt, setLaedt] = useState(true);
  // Baustellen-Filter in der URL (?baustelle=903091), damit man einen Link darauf setzen kann
  const [params, setParams] = useSearchParams();
  const baustelleFilter = params.get('baustelle') ?? '';
  const baustelleSetzen = (knr: string) => setParams(knr ? { baustelle: knr } : {}, { replace: true });

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('regierapport')
      .select('id,nummer,status,betrag_rappen,frist_bis,erstellt_am,versendet_am,bestaetigt_am,baustelle:baustelle_id(bezeichnung,konto_nr)')
      .order('erstellt_am', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) setZeilen(data as unknown as Zeile[]);
        setLaedt(false);
      });
  }, []);

  const heuteIso = new Date().toISOString().slice(0, 10);
  // Alle Baustellen mit Rapporten, für den Filter — nach Anzahl, dann Name
  const baustellen = useMemo(() => {
    const m = new Map<string, { konto_nr: string; bezeichnung: string; n: number }>();
    for (const z of zeilen) {
      if (!z.baustelle) continue;
      const e = m.get(z.baustelle.konto_nr) ?? { konto_nr: z.baustelle.konto_nr, bezeichnung: z.baustelle.bezeichnung ?? '', n: 0 };
      e.n += 1;
      m.set(z.baustelle.konto_nr, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
  }, [zeilen]);
  const gefiltert = useMemo(() => (baustelleFilter ? zeilen.filter((z) => z.baustelle?.konto_nr === baustelleFilter) : zeilen), [zeilen, baustelleFilter]);
  const proGruppe = useMemo(() => {
    const m: Record<Gruppe, Zeile[]> = { entwurf: [], kunde: [], bestaetigt: [] };
    for (const z of gefiltert) m[GRUPPE_VON[z.status] ?? 'kunde'].push(z);
    // Beim Kunden: das Dringende zuoberst (Frist abgelaufen, Rückfrage), dann nach Frist
    m.kunde.sort((a, b) => {
      const r = (z: Zeile) => (z.status === 'frist_abgelaufen' ? 0 : z.status === 'rueckfrage' ? 1 : 2);
      return r(a) - r(b) || (a.frist_bis ?? '').localeCompare(b.frist_bis ?? '');
    });
    return m;
  }, [gefiltert]);
  const summe = (l: Zeile[]) => l.reduce((s, z) => s + (z.betrag_rappen ?? 0), 0);
  const dringend = proGruppe.kunde.filter((z) => z.status === 'frist_abgelaufen' || z.status === 'rueckfrage').length;

  const ueberfaellig = proGruppe.kunde.filter((z) => zeile2(z, 'kunde', heuteIso).warn === 'rot').length;
  const rueckfragen = proGruppe.kunde.filter((z) => z.status === 'rueckfrage').length;

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight lg:text-[28px]">Regierapporte</h1>
            <p className="mt-1 text-sm text-ink3">
              {laedt ? 'lädt …' : (
                <>
                  <span className="font-medium text-ink">{formatChf(summe(proGruppe.entwurf) + summe(proGruppe.kunde))}</span> unterwegs
                  {' · '}
                  <span className="font-medium text-ink">{formatChf(summe(proGruppe.bestaetigt))}</span> bestätigt
                  {dringend > 0 && <> · <span className="font-medium text-accent-deep">{dringend} zum Nachfassen</span></>}
                </>
              )}
            </p>
          </div>
          <Link to="/cockpit" className="btn-ghost">Wochenübersicht ›</Link>
        </header>

        {baustellen.length > 1 && (
          <div className="flex justify-end">
            <BaustellenWahl baustellen={baustellen} wert={baustelleFilter} setzen={baustelleSetzen} />
          </div>
        )}
        {baustelleFilter && (
          <p className="-mt-3 text-xs text-ink3">
            Nur <span className="knr">{baustelleFilter}</span> {baustellen.find((b) => b.konto_nr === baustelleFilter)?.bezeichnung} · {gefiltert.length} {gefiltert.length === 1 ? 'Rapport' : 'Rapporte'} · {formatChf(summe(gefiltert))}
          </p>
        )}

        {!laedt && zeilen.length > 0 && gefiltert.length === 0 && (
          <div className="card text-sm text-ink3">Keine Regierapporte für diese Baustelle.</div>
        )}
        {!laedt && zeilen.length === 0 && (
          <div className="card text-sm text-ink3">
            Noch keine Regierapporte. Der Weg: <Link to="/cockpit" className="font-semibold text-steel">Wochenübersicht</Link> → gelbe Karte «Regieverdacht» → «Regierapport vorrechnen ›».
          </div>
        )}

        {!laedt && gefiltert.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            {GRUPPEN.map((g) => {
              const liste = proGruppe[g.key];
              const I = g.icon;
              const unter =
                g.key === 'kunde'
                  ? [`${liste.length} ${liste.length === 1 ? 'Rapport' : 'Rapporte'}`, ueberfaellig > 0 ? `${ueberfaellig} überfällig` : '', rueckfragen > 0 ? `${rueckfragen} Rückfrage${rueckfragen === 1 ? '' : 'n'}` : ''].filter(Boolean).join(' · ')
                  : `${liste.length} ${liste.length === 1 ? 'Rapport' : 'Rapporte'} · ${g.text}`;
              return (
                <section key={g.key} className="overflow-hidden rounded-[16px] bg-surface shadow-[0_1px_2px_rgb(17_17_19/0.04),0_8px_24px_rgb(17_17_19/0.04)]">
                  {/* Farbiger Kopf: Stand, Summe, Anzahl — das ist die Zahl, die zählt */}
                  <div className={'px-4 py-3 text-white ' + g.kopf}>
                    <p className="flex items-center gap-1.5 text-xs font-medium opacity-90"><I size={14} strokeWidth={2} aria-hidden="true" />{g.titel}</p>
                    <p className="mt-0.5 font-mono text-[22px] font-semibold tabular-nums leading-tight">{formatChf(summe(liste))}</p>
                    <p className="mt-0.5 text-[11px] opacity-80">{unter}</p>
                  </div>
                  {liste.length === 0 ? (
                    <p className="px-4 py-4 text-xs text-ink3">{g.leer}</p>
                  ) : (
                    <div className="divide-y divide-line">
                      {liste.map((z) => {
                        const v = zeile2(z, g.key, heuteIso);
                        return (
                          <Link key={z.id} to={`/regie/${z.id}`} className={'block px-4 py-2.5 transition-colors hover:bg-ground ' + (v.warn === 'rot' ? 'bg-accent-soft/60 hover:bg-accent-soft' : v.warn === 'gelb' ? 'bg-amber-soft/50 hover:bg-amber-soft' : '')}>
                            <div className="flex items-start justify-between gap-3">
                              <p className="min-w-0 truncate text-[14px] font-semibold leading-tight">{z.baustelle?.bezeichnung ?? 'Baustelle'}</p>
                              <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums">{z.betrag_rappen != null ? formatChf(z.betrag_rappen) : '—'}</span>
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink3">
                              {z.baustelle && <span className="knr">{z.baustelle.konto_nr}</span>}
                              <span className={v.warn === 'rot' ? 'font-semibold text-accent-deep' : v.warn === 'gelb' ? 'font-semibold text-amber-deep' : ''}>{v.text}</span>
                              {z.nummer && <span className="font-mono">{z.nummer}</span>}
                            </p>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
