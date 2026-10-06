import { useEffect, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

/**
 * Fenster über der Seite (06.10.2026): Bearbeiten in einem Fenster statt in einer Karte, die sich in
 * die Liste schiebt. Am Handy von unten, am PC in der Mitte. Escape oder Klick daneben schliesst.
 */
export function Dialog({ titel, untertitel, icon: Icon, onSchliessen, children, fuss, breit = false }: {
  titel: string;
  untertitel?: string;
  icon?: LucideIcon;
  onSchliessen: () => void;
  children: ReactNode;
  /** Knöpfe unten, durch eine Linie getrennt */
  fuss?: ReactNode;
  breit?: boolean;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSchliessen(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onSchliessen]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onSchliessen(); }}>
      <div role="dialog" aria-modal="true" aria-label={titel} className={'max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-[0_30px_80px_-20px_rgb(17_17_19/0.45)] sm:rounded-[24px] sm:p-6 ' + (breit ? 'max-w-[640px]' : 'max-w-[540px]')}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]">
                <Icon size={19} strokeWidth={2.2} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-display text-lg font-semibold text-ink">{titel}</span>
              {untertitel && <span className="block truncate text-xs text-ink3">{untertitel}</span>}
            </span>
          </span>
          <button type="button" onClick={onSchliessen} aria-label="Schliessen" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
        </div>
        {children}
        {fuss && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">{fuss}</div>}
      </div>
    </div>
  );
}

/** Initialen im farbigen Kreis — dieselbe Person hat überall dieselbe Farbe. */
const AVATAR_FARBEN = ['bg-[#fde3df] text-accent-deep', 'bg-[#dcf2e5] text-good-deep', 'bg-[#d6e6f8] text-[#1d4f86]', 'bg-[#fbe6ae] text-amber-deep', 'bg-[#e8e1fb] text-[#4c33a8]', 'bg-[#d3efef] text-[#136a6a]'];

export function Avatar({ name, gross = false, ring = false }: { name: string; gross?: boolean; ring?: boolean }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const teile = name.trim().split(/\s+/);
  const kuerzel = ((teile[0]?.[0] ?? '') + (teile.length > 1 ? teile[teile.length - 1][0] : '')).toUpperCase();
  return (
    <span className={'grid shrink-0 place-items-center rounded-full font-semibold ' + AVATAR_FARBEN[h % AVATAR_FARBEN.length] + (gross ? ' h-9 w-9 text-xs' : ' h-7 w-7 text-[10px]') + (ring ? ' ring-2 ring-white' : '')} aria-hidden="true">
      {kuerzel}
    </span>
  );
}
