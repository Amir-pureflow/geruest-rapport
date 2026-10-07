import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ANSICHT_LABEL, useAnsicht, type Ansicht } from '../lib/ansicht';
import { ChevronRight, ChevronDown, LayoutDashboard, CalendarDays, CalendarRange, Download, Settings, Smartphone, PhoneCall, FileText, BarChart3, CalendarPlus, ArrowLeftRight, LogOut, type LucideIcon } from 'lucide-react';
import { einstellungen } from '../lib/einstellungen';
import { abmelden } from '../lib/konto';
import { eigeneFirma } from '../lib/einstellungen';

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

/** Kürzel aus dem Firmennamen für den runden Knopf: «Gerüst GmbH» wird «GG», «We-Plan» wird «WP». */
function kuerzel(name: string): string {
  const teile = name.split(/[\s-]+/).filter(Boolean);
  return (teile.slice(0, 2).map((t) => t[0]).join('') || '?').toUpperCase();
}

/**
 * Wer ist angemeldet und bei welcher Firma.
 *
 * Ein Knopf mit Kürzel, Firma und Rolle; dahinter die zwei Dinge, die man damit tut: Ansicht
 * wechseln und abmelden. Am Handy bleibt nur das Kürzel sichtbar, der Rest würde die Kopfzeile
 * sprengen. Vorher standen Firma, Rolle und «Abmelden» als drei lose Teile nebeneinander.
 *
 * `platz` sagt, wohin das Menü aufgeht: in der Kopfzeile nach unten und rechtsbündig, unten in
 * der Seitenleiste nach oben und linksbündig. Sonst läuft es aus dem Bild.
 */
function Konto({ ansicht, platz = 'kopf' }: { ansicht: Ansicht; platz?: 'kopf' | 'leiste' }) {
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement | null>(null);
  const firma = eigeneFirma();

  useEffect(() => {
    if (!offen) return;
    const zu = (ev: MouseEvent) => { if (huelle.current && !huelle.current.contains(ev.target as Node)) setOffen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOffen(false); };
    document.addEventListener('mousedown', zu);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('keydown', esc); };
  }, [offen]);

  const name = firma?.name ?? 'Angemeldet';
  return (
    <div ref={huelle} className="relative">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
        aria-haspopup="menu"
        className={
          'flex max-w-[13rem] items-center gap-2 rounded-[12px] border px-1.5 py-1 transition-colors ' +
          (offen ? 'border-line-strong bg-surface-2' : 'border-line bg-surface hover:bg-surface-2')
        }
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold tracking-tight text-accent-deep">
          {kuerzel(name)}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block truncate text-[12.5px] font-medium leading-tight text-ink">{name}</span>
          <span className="block truncate text-[11px] leading-tight text-ink3">{ANSICHT_LABEL[ansicht]}</span>
        </span>
        <ChevronDown size={14} className={'shrink-0 text-ink3 transition-transform ' + (offen ? 'rotate-180' : '')} aria-hidden="true" />
      </button>

      {offen && (
        <div
          role="menu"
          className={
            'absolute z-30 w-60 rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgb(17_17_19/0.10)] ' +
            (platz === 'leiste' ? 'bottom-full left-0 mb-1.5' : 'right-0 mt-1.5')
          }
        >
          <div className="px-2.5 pb-1.5 pt-1">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            <p className="text-[11px] text-ink3">angemeldet als {ANSICHT_LABEL[ansicht]}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <Link
            to="/ansicht"
            role="menuitem"
            onClick={() => setOffen(false)}
            className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] text-ink2 transition-colors hover:bg-ground hover:text-ink"
          >
            <ArrowLeftRight size={15} strokeWidth={1.8} className="text-ink3" aria-hidden="true" />
            Ansicht wechseln
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void abmelden().then(() => location.replace('/'))}
            className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] text-accent-deep transition-colors hover:bg-accent-soft"
          >
            <LogOut size={15} strokeWidth={1.8} aria-hidden="true" />
            Abmelden
          </button>
        </div>
      )}
    </div>
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

/**
 * Gleiche Ordnung für beide Büro-Ansichten: erst das Tägliche, dann die Daten.
 *
 * Was zu sehen ist, hängt an den Firmen-Schaltern (`src/lib/einstellungen.ts`, Entscheid 02.10.2026):
 * `MODUS_ERFASSUNG = regie` bringt Zusatzauftrag, Regierapporte, Auswertung und Planung zurück,
 * `MODUS_SEKRETARIAT = voll` gibt dem Sekretariat dieselben Bereiche wie dem Bauführer.
 */
export function navFuer(a: 'bauf' | 'sekretariat'): NavGruppe[] {
  const e = einstellungen();
  const regie = e.erfassung === 'regie';
  // Sekretariat im Modus «stunden»: nur Stunden und Stammdaten (Entscheid 17.09.)
  if (a === 'sekretariat' && e.sekretariat !== 'voll') {
    return [
      { eintraege: [{ zu: '/', label: 'Übersicht', icon: LayoutDashboard }] },
      {
        titel: 'Stunden & Daten',
        eintraege: [
          { zu: '/export', label: 'Export', icon: Download },
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
        // Zusatzauftrag: der Kunde bestellt am Telefon — seit 08.10.2026 auch ohne Regie (Rapport dann in SORBA)
        { zu: '/zusatzauftrag', label: 'Zusatzauftrag', icon: PhoneCall },
        { zu: '/heute', label: 'Tagesübersicht', icon: CalendarDays },
        { zu: '/cockpit', label: 'Wochenübersicht', icon: CalendarRange },
      ],
    },
    ...(regie
      ? [{
          titel: 'Regie',
          eintraege: [
            { zu: '/regie', label: 'Regierapporte', icon: FileText },
            { zu: '/auswertung', label: 'Auswertung', icon: BarChart3 },
          ],
        }]
      : []),
    {
      titel: 'Planung & Daten',
      eintraege: [
        // Export gehört dem Sekretariat — beim Bauführer entfernt (04.10.2026, Amir)
        ...(a === 'sekretariat' ? [{ zu: '/export', label: 'Export', icon: Download }] : []),
        ...(regie ? [{ zu: '/planung', label: 'Planung', icon: CalendarPlus }] : []),
        { zu: '/verwaltung', label: 'Verwaltung', icon: Settings },
      ],
    },
    ...(a === 'bauf'
      ? [{
          titel: 'Weitere',
          eintraege: [{ zu: '/erfassung?wahl', label: 'Erfassung (Teamgerät)', icon: Smartphone }],
        }]
      : []),
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
  '/heute': 'Tagesübersicht',
  '/cockpit': 'Wochenübersicht',
  '/export': 'Export',
  '/verwaltung': 'Verwaltung',
  '/erfassung': 'Erfassung',
  '/ansicht': 'Ansicht wählen',
  // nur im Regie-Modus erreichbar, die Brotkrumen brauchen die Namen trotzdem
  '/zusatzauftrag': 'Zusatzauftrag',
  '/regie': 'Regierapporte',
  '/regie/neu': 'Neuer Rapport',
  '/auswertung': 'Auswertung',
  '/planung': 'Planung',
};

/** Brotkrumen: Übersicht › Wochenübersicht. Jede Stufe ist anklickbar, die letzte nicht. */
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
  const nav = ansicht === 'bauf' || ansicht === 'sekretariat' ? navFuer(ansicht) : null;
  const istAktiv = (zu: string) => {
    const pfad = zu.split('?')[0];
    return pfad === '/' ? pathname === '/' : pathname === pfad || pathname.startsWith(pfad + '/');
  };

  const wechsel = ansicht && <Konto ansicht={ansicht} />;
  const wechselLeiste = ansicht && <Konto ansicht={ansicht} platz="leiste" />;

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
          <div className="mt-auto px-2 pt-6">{wechselLeiste}</div>
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
