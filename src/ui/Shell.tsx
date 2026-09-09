import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ANSICHT_LABEL, useAnsicht } from '../lib/ansicht';

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

/** App-Rahmen: ruhige, haftende Kopfzeile mit Marke, darunter der Inhalt. */
export function Shell({
  children,
  zurueck = false,
}: {
  children: ReactNode;
  zurueck?: boolean;
}) {
  const ansicht = useAnsicht();
  return (
    <div className="min-h-screen">
      <header className="appbar sticky top-0 z-20">
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
            {ansicht && (
              <Link to="/ansicht" className="btn-ghost text-xs" title="Ansicht wechseln">
                {ANSICHT_LABEL[ansicht]} <span aria-hidden="true">⇄</span>
              </Link>
            )}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-6">{children}</main>
    </div>
  );
}
