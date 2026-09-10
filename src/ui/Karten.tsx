import { Link } from 'react-router-dom';

/** Navigationskarte: Titel, ein Satz, Pfeil. Gleich auf allen Startseiten. */
export function NavKarte({ zu, titel, text }: { zu: string; titel: string; text: string }) {
  return (
    <Link to={zu} className="card flex items-center justify-between gap-3">
      <span>
        <span className="block text-[15px] font-semibold">{titel}</span>
        <span className="block text-sm text-ink3">{text}</span>
      </span>
      <span className="text-ink3" aria-hidden="true">›</span>
    </Link>
  );
}

/** Kennzahl-Kachel. «warn» = ein kleiner Punkt in Bernstein, keine farbige Karte. */
export function Kachel({ zu, wert, label, warn }: { zu: string; wert: string; label: string; warn?: boolean }) {
  return (
    <Link to={zu} className="card block">
      <span className="flex items-baseline gap-2">
        <span className="block text-2xl font-semibold tabular-nums tracking-tight lg:text-[28px]">{wert}</span>
        {warn && <span className="inline-block h-2 w-2 rounded-full bg-amber" aria-label="braucht Aufmerksamkeit" />}
      </span>
      <span className="mt-0.5 block text-xs text-ink3 lg:text-sm">{label}</span>
    </Link>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
