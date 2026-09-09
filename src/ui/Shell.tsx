import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ANSICHT_LABEL, useAnsicht, type Ansicht } from '../lib/ansicht';

/** Kleine Bildmarke: drei Gerüstlagen. Steht allein für die App, ohne Text. */
export function Marke({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span className={'grid shrink-0 place-items-center rounded-[8px] bg-ink text-white ' + className} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M5 4v16M19 4v16" />
        <path d="M5 8h14M5 13h14M5 18h14" />
        <path d="M9 8l6 5M9 13l6 5" className="text-accent" stroke="#d82816" />
      </svg>
    </span>
  );
}

/** Wortmarke — überall gleich, damit die App wiedererkennbar bleibt. */
export function Wortmarke({ gross = false }: { gross?: boolean }) {
  return (
    <span className={'font-display font-extrabold tracking-tight ' + (gross ? 'text-2xl' : 'text-[15px]')}>
      Gerüst<span className="text-accent">Rapport</span>
    </span>
  );
}

/**
 * Büro-Ansichten (Bauführer, Sekretariat) laufen am PC: ab «lg» eine Seitenleiste mit allen
 * Bereichen, der Inhalt wird breit. Baustellen-Ansichten (Chefmonteur, Monteur) bleiben
 * die Handy-Spalte — dort ist das Gerät das Telefon (Entscheid 09.09.).
 */
const BUERO: Ansicht[] = ['bauf', 'sekretariat'];

interface NavEintrag { zu: string; label: string }
const NAV: Record<'bauf' | 'sekretariat', { haupt: NavEintrag[]; weitere: NavEintrag[] }> = {
  bauf: {
    haupt: [
      { zu: '/', label: 'Übersicht' },
      { zu: '/zusatzauftrag', label: 'Zusatzarbeit' },
      { zu: '/heute', label: 'Tagesübersicht' },
      { zu: '/cockpit', label: 'Wochenübersicht' },
      { zu: '/regie', label: 'Regierapporte' },
      { zu: '/board', label: 'Board' },
      { zu: '/export', label: 'Export' },
      { zu: '/verwaltung', label: 'Verwaltung' },
    ],
    weitere: [
      { zu: '/erfassung?wahl', label: 'Erfassung (Teamgerät)' },
      { zu: '/b/demo-token', label: 'Kundenlink ansehen' },
    ],
  },
  sekretariat: {
    haupt: [
      { zu: '/', label: 'Übersicht' },
      { zu: '/zusatzauftrag', label: 'Zusatzarbeit' },
      { zu: '/regie', label: 'Regierapporte' },
      { zu: '/export', label: 'Export' },
      { zu: '/heute', label: 'Tagesübersicht' },
      { zu: '/cockpit', label: 'Wochenübersicht' },
      { zu: '/board', label: 'Board' },
      { zu: '/verwaltung', label: 'Verwaltung' },
    ],
    weitere: [{ zu: '/b/demo-token', label: 'Kundenlink ansehen' }],
  },
};

function NavLink({ e, aktiv }: { e: NavEintrag; aktiv: boolean }) {
  return (
    <Link
      to={e.zu}
      aria-current={aktiv ? 'page' : undefined}
      className={
        'block rounded-[9px] px-3 py-[7px] text-[14px] transition ' +
        (aktiv ? 'bg-ground font-semibold text-ink' : 'font-medium text-ink2 hover:bg-ground/70 hover:text-ink')
      }
    >
      {e.label}
    </Link>
  );
}

/** App-Rahmen. `schmal`: Formulare und Detailseiten bleiben auch am PC eine Lesespalte. */
export function Shell({
  children,
  zurueck = false,
  schmal = false,
}: {
  children: ReactNode;
  zurueck?: boolean;
  schmal?: boolean;
}) {
  const ansicht = useAnsicht();
  const { pathname } = useLocation();
  const buero = ansicht !== null && BUERO.includes(ansicht);
  const nav = ansicht === 'bauf' || ansicht === 'sekretariat' ? NAV[ansicht] : null;
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
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-line lg:bg-surface lg:px-4 lg:py-5">
          <Link to="/" className="flex items-center gap-2.5 px-2" aria-label="Zur Übersicht">
            <Marke />
            <Wortmarke />
          </Link>
          <nav className="mt-7 flex flex-col gap-0.5" aria-label="Bereiche">
            {nav.haupt.map((e) => <NavLink key={e.zu} e={e} aktiv={istAktiv(e.zu)} />)}
          </nav>
          <p className="lbl mb-1 mt-6 px-3">Weitere</p>
          <nav className="flex flex-col gap-0.5">
            {nav.weitere.map((e) => <NavLink key={e.zu} e={e} aktiv={istAktiv(e.zu)} />)}
          </nav>
          <div className="mt-auto px-2 pt-6">{wechsel}</div>
        </aside>
      )}

      <div className="min-w-0">
        <header className={'appbar sticky top-0 z-20 ' + (buero ? 'lg:hidden' : '')}>
          <div className="mx-auto flex h-14 max-w-md items-center justify-between px-5">
            <Link to="/" className="flex items-center gap-2.5" aria-label="Zur Übersicht">
              <Marke />
              <Wortmarke />
            </Link>
            <span className="flex items-center gap-1.5">
              {zurueck && (
                <Link to="/" className="btn-ghost text-xs">
                  ‹ Übersicht
                </Link>
              )}
              {wechsel}
            </span>
          </div>
        </header>
        <main
          className={
            'mx-auto w-full max-w-md px-5 py-6 ' +
            (buero ? (schmal ? 'lg:max-w-2xl lg:px-10 lg:py-9' : 'lg:max-w-5xl lg:px-10 lg:py-9') : '')
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
