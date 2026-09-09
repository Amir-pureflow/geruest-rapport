import { Link } from 'react-router-dom';

/** Navigationskarte: Titel, ein Satz, Pfeil. Gleich auf allen Startseiten. */
export function NavKarte({ zu, titel, text }: { zu: string; titel: string; text: string }) {
  return (
    <Link to={zu} className="card flex items-center justify-between gap-3 hover:border-line-strong">
      <span>
        <span className="block font-display text-[16px] font-bold">{titel}</span>
        <span className="block text-sm text-ink3">{text}</span>
      </span>
      <span className="text-ink3" aria-hidden="true">›</span>
    </Link>
  );
}

/** Kennzahl-Kachel. «warn» färbt rot, wenn etwas Aufmerksamkeit braucht. */
export function Kachel({ zu, wert, label, warn }: { zu: string; wert: string; label: string; warn?: boolean }) {
  return (
    <Link to={zu} className={'card block hover:border-line-strong ' + (warn ? 'border-accent/40' : '')}>
      <span className={'block font-display text-2xl font-extrabold tabular-nums lg:text-3xl ' + (warn ? 'text-accent-deep' : '')}>{wert}</span>
      <span className="block text-xs text-ink3 lg:mt-1 lg:text-sm">{label}</span>
    </Link>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
