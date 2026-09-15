/**
 * Regierapporte: eine Liste, nach Stand gruppiert — Entwürfe, beim Kunden, bestätigt.
 * Eine Karte pro Gruppe mit Zeilen (nicht eine Karte pro Rapport): weniger Weiss, mehr Überblick.
 * Oben Filter-Chips mit Anzahl, rechts je Zeile Betrag und Stand. Keine Urteile, nur Stände (CLAUDE.md #1).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileText, Send, CheckCircle2, AlertCircle, MessageCircleQuestion, X } from 'lucide-react';
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
            <span className="ml-auto flex items-center gap-1.5">
              <select
                value={baustelleFilter}
                onChange={(e) => baustelleSetzen(e.target.value)}
                aria-label="Nach Baustelle filtern"
                className={'chip max-w-[260px] cursor-pointer appearance-none truncate px-3 py-1.5 pr-7 text-xs ' + (baustelleFilter ? 'chip-on' : '')}
                style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236c7b81' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 9px center' }}
              >
                <option value="">Alle Baustellen</option>
                {baustellen.map((b) => (
                  <option key={b.konto_nr} value={b.konto_nr}>{b.konto_nr} {b.bezeichnung} ({b.n})</option>
                ))}
              </select>
              {baustelleFilter && (
                <button type="button" onClick={() => baustelleSetzen('')} aria-label="Baustellen-Filter aufheben" className="grid h-8 w-8 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={15} /></button>
              )}
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
