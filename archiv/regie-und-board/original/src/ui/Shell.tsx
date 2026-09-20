import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ANSICHT_LABEL, useAnsicht, type Ansicht } from '../lib/ansicht';
import { supabase } from '../lib/supabase';
import { ChevronRight, LayoutDashboard, PhoneCall, CalendarDays, CalendarRange, FileText, BarChart3, LayoutGrid, Download, Settings, Smartphone, ExternalLink, type LucideIcon } from 'lucide-react';

/**
 * Bildmarke: Gerüst als Netz — zwei Stiele, zwei Lagen, eine Strebe, und an den Knoten leuchtende Punkte
 * (die Daten, die die App verbindet). Roter Verlauf mit Lichtstreif (index.css `.marke`).
 */
export function Marke({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span className={'marke ' + className} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="relative h-[64%] w-[64%]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3.5v17M18 3.5v17" strokeWidth="2" opacity="0.95" />
        <path d="M6 9h12M6 15h12" strokeWidth="2" opacity="0.95" />
        <path d="M6 15l12-6" strokeWidth="1.6" opacity="0.7" />
        <circle cx="6" cy="9" r="1.9" fill="#fff" stroke="none" />
        <circle cx="18" cy="15" r="1.9" fill="#fff" stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill="#ffd9d2" stroke="none" className="marke-knoten" />
      </svg>
    </span>
  );
}

/** Wortmarke «Rapporto» (Name seit 15.09.) — überall gleich, damit die App wiedererkennbar bleibt. Das «o» im roten Verlauf. */
export function Wortmarke({ gross = false }: { gross?: boolean }) {
  return (
    <span className={'font-semibold tracking-[-0.02em] ' + (gross ? 'text-2xl' : 'text-[15px]')}>
      Rapport<span className="wortmarke-akzent">o</span>
    </span>
  );
}

/**
 * Büro-Ansichten (Bauführer, Sekretariat) laufen am PC: ab «lg» eine Seitenleiste mit allen
 * Bereichen, der Inhalt wird breit. Baustellen-Ansichten (Chefmonteur, Monteur) bleiben
 * die Handy-Spalte — dort ist das Gerät das Telefon (Entscheid 09.09.).
 *
 * iPad (Bauführer 20.09.): zwischen Handy und PC («md», iPad hochkant) bekommen die Büro-Ansichten
 * eine quer scrollbare Bereichsleiste unter der Kopfzeile und eine breitere Spalte; iPad quer ist «lg».
 */
const BUERO: Ansicht[] = ['bauf', 'sekretariat'];

interface NavEintrag { zu: string; label: string; icon?: LucideIcon }
interface NavGruppe { titel?: string; eintraege: NavEintrag[] }

/** Gleiche Ordnung für beide Büro-Ansichten: erst das Tägliche, dann Geld, dann Planung. */
export function navFuer(a: 'bauf' | 'sekretariat', kundenToken: string | null = null): NavGruppe[] {
  // Sekretariat: vier Bereiche, alles rund um Stunden und Stammdaten (Entscheid 17.09.)
  if (a === 'sekretariat') {
    return [
      { eintraege: [{ zu: '/', label: 'Übersicht', icon: LayoutDashboard }] },
      {
        titel: 'Stunden & Daten',
        eintraege: [
          { zu: '/export', label: 'Export', icon: Download },
          { zu: '/board', label: 'Board', icon: LayoutGrid },
          { zu: '/verwaltung', label: 'Verwaltung', icon: Settings },
        ],
      },
    ];
  }
  return [
    { eintraege: [{ zu: '/', label: 'Übersicht', icon: LayoutDashboard }] },
    {
      titel: 'Tagesgeschäft',
      eintraege: [
        { zu: '/zusatzauftrag', label: 'Zusatzauftrag', icon: PhoneCall },
        { zu: '/heute', label: 'Tagesübersicht', icon: CalendarDays },
        { zu: '/cockpit', label: 'Wochenübersicht', icon: CalendarRange },
      ],
    },
    {
      titel: 'Regie',
      eintraege: [
        { zu: '/regie', label: 'Regierapporte', icon: FileText },
        { zu: '/auswertung', label: 'Auswertung', icon: BarChart3 },
      ],
    },
    {
      titel: 'Planung & Daten',
      eintraege: [
        { zu: '/board', label: 'Board', icon: LayoutGrid },
        // Bauführer sieht nur das Raster — Lohn-Export gehört dem Sekretariat (20.09.)
        { zu: '/export', label: 'SORBA-Raster', icon: Download },
        { zu: '/verwaltung', label: 'Verwaltung', icon: Settings },
      ],
    },
    {
      titel: 'Weitere',
      eintraege: [
        ...(a === 'bauf' ? [{ zu: '/erfassung?wahl', label: 'Erfassung (Teamgerät)', icon: Smartphone }] : []),
        // Der neueste verschickte Regierapport, so wie ihn die Bauleitung sieht — ohne Rapport zeigt der Link nichts.
        ...(kundenToken ? [{ zu: `/b/${kundenToken}`, label: 'Kundenlink ansehen', icon: ExternalLink }] : []),
      ],
    },
  ];
}

function NavLink({ e, aktiv }: { e: NavEintrag; aktiv: boolean }) {
  return (
    <Link
      to={e.zu}
      aria-current={aktiv ? 'page' : undefined}
      className={
        'nav-link flex items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-[14px] ' +
        (aktiv ? 'nav-link-on font-medium text-accent-deep' : 'font-normal text-ink2 hover:bg-surface-2 hover:text-ink')
      }
    >
      {e.icon && <e.icon size={17} strokeWidth={1.8} className={aktiv ? 'text-accent' : 'text-ink3'} aria-hidden="true" />}
      {e.label}
    </Link>
  );
}

/** Seitentitel je Pfad — für die Brotkrumen oben. Unbekannte Segmente (IDs) bekommen `krume` aus der Seite. */
const TITEL: Record<string, string> = {
  '/': 'Übersicht',
  '/zusatzauftrag': 'Zusatzauftrag',
  '/heute': 'Tagesübersicht',
  '/cockpit': 'Wochenübersicht',
  '/regie': 'Regierapporte',
  '/regie/neu': 'Neuer Regierapport',
  '/auswertung': 'Auswertung',
  '/export': 'Export',
  '/board': 'Board',
  '/verwaltung': 'Verwaltung',
  '/erfassung': 'Erfassung',
  '/ansicht': 'Ansicht wählen',
};

/** Brotkrumen: Übersicht › Regierapporte › RR-2026-0008. Jede Stufe ist anklickbar, die letzte nicht. */
function Brotkrumen({ pathname, krume }: { pathname: string; krume?: string }) {
  const teile = pathname.split('/').filter(Boolean);
  if (teile.length === 0) return null;
  const stufen: { zu: string; label: string }[] = [{ zu: '/', label: TITEL['/'] }];
  let pfad = '';
  for (const t of teile) {
    pfad += '/' + t;
    stufen.push({ zu: pfad, label: TITEL[pfad] ?? (pfad === pathname && krume ? krume : t.length > 12 ? 'Detail' : t) });
  }
  return (
    <nav aria-label="Pfad" className="mb-4 flex flex-wrap items-center gap-1 text-[13px] text-ink3">
      {stufen.map((s, i) => {
        const letzte = i === stufen.length - 1;
        return (
          <span key={s.zu} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-ink3/60" aria-hidden="true" />}
            {letzte
              ? <span className="font-medium text-ink" aria-current="page">{s.label}</span>
              : <Link to={s.zu} className="rounded-md px-1 py-0.5 transition-colors hover:bg-surface-2 hover:text-ink">{s.label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

/** App-Rahmen. `schmal`: Formulare und Detailseiten bleiben auch am PC eine Lesespalte. `krume`: Name der Detailseite im Pfad oben. */
export function Shell({
  children,
  zurueck = false,
  krume,
  schmal = false,
}: {
  children: ReactNode;
  /** Früher der Knopf «‹ Übersicht» — heute zeigen alle Seiten ausser der Startseite die Brotkrumen. Bleibt für die Aufrufer. */
  zurueck?: boolean;
  schmal?: boolean;
  krume?: string;
}) {
  const ansicht = useAnsicht();
  const { pathname } = useLocation();
  const buero = ansicht !== null && BUERO.includes(ansicht);
  const [kundenToken, setKundenToken] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from('regierapport').select('link_token').neq('status', 'entwurf').not('link_token', 'is', null)
      .order('versendet_am', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setKundenToken((data as { link_token?: string } | null)?.link_token ?? null));
  }, []);
  const nav = ansicht === 'bauf' || ansicht === 'sekretariat' ? navFuer(ansicht, kundenToken) : null;
  const istAktiv = (zu: string) => {
    const pfad = zu.split('?')[0];
    return pfad === '/' ? pathname === '/' : pathname === pfad || pathname.startsWith(pfad + '/');
  };

  const wechsel = ansicht && (
    <Link to="/ansicht" className="btn-ghost text-xs" title="Ansicht wechseln">
      {ANSICHT_LABEL[ansicht]} <span aria-hidden="true">⇄</span>
    </Link>
  );

  return (
    <div className={'min-h-screen ' + (buero ? 'lg:grid lg:grid-cols-[236px_minmax(0,1fr)]' : '')}>
      {buero && nav && (
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-line lg:bg-ground lg:px-4 lg:py-6">
          <Link to="/" className="flex items-center gap-2.5 px-2" aria-label="Zur Übersicht">
            <Marke />
            <Wortmarke />
          </Link>
          <nav className="mt-8 flex flex-col gap-6" aria-label="Bereiche">
            {nav.map((g, i) => (
              <div key={g.titel ?? i}>
                {g.titel && <p className="mb-1 px-3 text-xs font-medium text-ink3">{g.titel}</p>}
                <div className="flex flex-col gap-0.5">
                  {g.eintraege.map((e) => <NavLink key={e.zu} e={e} aktiv={istAktiv(e.zu)} />)}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto px-2 pt-6">{wechsel}</div>
        </aside>
      )}

      <div className="min-w-0">
        <header className={'appbar sticky top-0 z-20 ' + (buero ? 'lg:hidden' : '')}>
          <div className={'mx-auto flex h-14 max-w-md items-center justify-between px-5 ' + (buero ? 'md:max-w-3xl md:px-6' : '')}>
            <Link to="/" className="flex items-center gap-2.5" aria-label="Zur Übersicht">
              <Marke />
              <Wortmarke />
            </Link>
            <span className="flex items-center gap-1.5">
              {wechsel}
            </span>
          </div>
          {buero && nav && (
            /* iPad hochkant: alle Bereiche in einer Leiste, quer scrollbar — am Handy reichen die Karten der Startseite, am PC die Seitenleiste */
            <nav className="hidden border-t border-line/70 md:block lg:hidden" aria-label="Bereiche">
              <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-6 py-1.5 [scrollbar-width:none]">
                {nav.flatMap((g) => g.eintraege).map((e) => {
                  const aktiv = istAktiv(e.zu);
                  return (
                    <Link key={e.zu} to={e.zu} aria-current={aktiv ? 'page' : undefined} className={'nav-link flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] ' + (aktiv ? 'nav-link-on font-medium text-accent-deep' : 'text-ink2 hover:bg-surface-2 hover:text-ink')}>
                      {e.icon && <e.icon size={15} strokeWidth={1.8} className={aktiv ? 'text-accent' : 'text-ink3'} aria-hidden="true" />}
                      {e.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          )}
        </header>
        <main
          className={
            'mx-auto w-full max-w-md px-5 py-6 ' +
            (buero
              ? (schmal ? 'md:max-w-2xl md:px-8 md:py-8 lg:px-12 lg:py-12' : 'md:max-w-3xl md:px-8 md:py-8 lg:max-w-5xl lg:px-12 lg:py-12')
              : '')
          }
        >
          {(zurueck || pathname !== '/') && <Brotkrumen pathname={pathname} krume={krume} />}
          {children}
        </main>
      </div>
    </div>
  );
}
