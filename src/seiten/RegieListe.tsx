/**
 * Regierapporte: eine Liste, nach Stand gruppiert — Entwürfe, beim Kunden, bestätigt.
 * Eine Karte pro Gruppe mit Zeilen (nicht eine Karte pro Rapport): weniger Weiss, mehr Überblick.
 * Oben Filter-Chips mit Anzahl, rechts je Zeile Betrag und Stand. Keine Urteile, nur Stände (CLAUDE.md #1).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, ChevronDown, FileText, Send, CheckCircle2, AlertCircle, MessageCircleQuestion, X, Check, Search } from 'lucide-react';
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
type Filter = 'alle' | Gruppe;

const GRUPPE_VON: Record<string, Gruppe> = {
  entwurf: 'entwurf',
  versendet: 'kunde',
  rueckfrage: 'kunde',
  frist_abgelaufen: 'kunde',
  bestaetigt: 'bestaetigt',
};

const GRUPPEN: { key: Gruppe; titel: string; text: string; icon: typeof FileText; farbe: string }[] = [
  { key: 'entwurf', titel: 'Entwürfe', text: 'noch nicht verschickt — prüfen und senden', icon: FileText, farbe: 'text-amber-deep' },
  { key: 'kunde', titel: 'Beim Kunden', text: 'warten auf die Unterschrift der Bauleitung', icon: Send, farbe: 'text-steel' },
  { key: 'bestaetigt', titel: 'Bestätigt', text: 'vom Kunden gegengezeichnet — bereit für die Rechnung in SORBA', icon: CheckCircle2, farbe: 'text-good-deep' },
];

const STATUS: Record<string, { label: string; stil: string; streifen: string }> = {
  entwurf: { label: 'Entwurf', stil: 'bg-amber-soft text-amber-deep', streifen: 'bg-amber' },
  versendet: { label: 'beim Kunden', stil: 'bg-steel-soft text-steel', streifen: 'bg-steel' },
  rueckfrage: { label: 'Rückfrage', stil: 'bg-amber-soft text-amber-deep', streifen: 'bg-amber' },
  frist_abgelaufen: { label: 'Frist abgelaufen', stil: 'bg-accent-soft text-accent-deep', streifen: 'bg-accent' },
  bestaetigt: { label: 'bestätigt', stil: 'bg-good-soft text-good-deep', streifen: 'bg-good' },
};

function kurz(ts: string): string {
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Zweite Zeile in Worten: was ist wann passiert, und wie viel Zeit bleibt. */
function verlauf(z: Zeile, heuteIso: string): { text: string; warn: boolean } {
  if (z.status === 'entwurf') return { text: `angelegt ${kurz(z.erstellt_am)}`, warn: false };
  const teile: string[] = [];
  if (z.versendet_am) teile.push(`verschickt ${kurz(z.versendet_am)}`);
  if (z.status === 'bestaetigt' && z.bestaetigt_am) teile.push(`bestätigt ${kurz(z.bestaetigt_am)}`);
  else if (z.status === 'rueckfrage') teile.push('Kunde hat eine Rückfrage');
  else if (z.status === 'frist_abgelaufen') teile.push('Frist verstrichen — nachfassen');
  else if (z.status === 'versendet' && z.frist_bis) {
    const tage = Math.round((new Date(z.frist_bis + 'T12:00:00').getTime() - new Date(heuteIso + 'T12:00:00').getTime()) / 86400000);
    teile.push(tage > 1 ? `noch ${tage} Tage` : tage === 1 ? 'noch 1 Tag' : tage === 0 ? 'Frist heute' : 'Frist verstrichen');
    return { text: teile.join(' · '), warn: tage <= 0 };
  }
  return { text: teile.join(' · '), warn: z.status === 'frist_abgelaufen' || z.status === 'rueckfrage' };
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
  const [filter, setFilter] = useState<Filter>('alle');
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

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'alle', label: 'Alle', n: gefiltert.length },
    ...GRUPPEN.map((g) => ({ key: g.key as Filter, label: g.titel, n: proGruppe[g.key].length })),
  ];
  const sichtbar = GRUPPEN.filter((g) => (filter === 'alle' || filter === g.key) && proGruppe[g.key].length > 0);

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

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key)} className={'chip px-3 py-1.5 text-xs ' + (filter === c.key ? 'chip-on' : '')}>
              {c.label} <span className={filter === c.key ? 'text-accent-deep/70' : 'text-ink3'}>{c.n}</span>
            </button>
          ))}
          {baustellen.length > 1 && (
            <span className="ml-auto">
              <BaustellenWahl baustellen={baustellen} wert={baustelleFilter} setzen={baustelleSetzen} />
            </span>
          )}
        </div>
        {baustelleFilter && (
          <p className="-mt-2 text-xs text-ink3">
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

        {sichtbar.map((g) => {
          const liste = proGruppe[g.key];
          const I = g.icon;
          return (
            <section key={g.key} className="card p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <I size={17} strokeWidth={1.9} className={g.farbe} aria-hidden="true" />
                  <h2 className="text-[15px] font-semibold">{g.titel} <span className="font-normal text-ink3">· {liste.length}</span></h2>
                  <span className="hidden text-xs text-ink3 sm:inline">— {g.text}</span>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums">{formatChf(summe(liste))}</span>
              </div>
              <div className="divide-y divide-line border-t border-line">
                {liste.map((z) => {
                  const st = STATUS[z.status] ?? { label: z.status, stil: 'bg-ground text-ink3', streifen: 'bg-line-strong' };
                  const v = verlauf(z, heuteIso);
                  return (
                    <Link key={z.id} to={`/regie/${z.id}`} className="group relative flex items-center gap-3 py-3 pl-5 pr-3 transition-colors hover:bg-ground">
                      <span className={'absolute inset-y-2 left-0 w-[3px] rounded-r ' + st.streifen} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold leading-tight">
                          <span className="truncate">{z.baustelle?.bezeichnung ?? 'Baustelle'}</span>
                          {z.nummer && <span className="font-mono text-xs font-medium text-ink3">{z.nummer}</span>}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink3">
                          {z.baustelle && <span className="knr">{z.baustelle.konto_nr}</span>}
                          <span className={v.warn ? 'font-medium text-accent-deep' : ''}>
                            {z.status === 'rueckfrage' && <MessageCircleQuestion size={13} className="mr-1 inline -mt-0.5" aria-hidden="true" />}
                            {z.status === 'frist_abgelaufen' && <AlertCircle size={13} className="mr-1 inline -mt-0.5" aria-hidden="true" />}
                            {v.text}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-[15px] font-semibold tabular-nums">{z.betrag_rappen != null ? formatChf(z.betrag_rappen) : '—'}</span>
                        <span className={'hidden rounded-md px-2 py-0.5 text-[11px] font-semibold sm:inline ' + st.stil}>{st.label}</span>
                        <ChevronRight size={16} className="text-ink3/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}
