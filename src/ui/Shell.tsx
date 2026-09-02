import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** App-Rahmen: Kopfzeile mit Wortmarke + Absperrband-Streifen, darunter der Inhalt. */
export function Shell({
  children,
  zurueck = false,
}: {
  children: ReactNode;
  zurueck?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <header className="appbar">
        <div className="mx-auto flex h-12 max-w-md items-center justify-between px-5">
          <span className="font-display text-[13px] font-extrabold uppercase tracking-[0.16em]">
            Gerüst <span className="text-accent">Rapport</span>
          </span>
          {zurueck && (
            <Link
              to="/"
              className="text-sm font-semibold text-ink3 hover:text-ink"
            >
              ← Übersicht
            </Link>
          )}
        </div>
      </header>
      <div className="stripe" aria-hidden="true" />
      <main className="mx-auto max-w-md px-5 py-6">{children}</main>
    </div>
  );
}
