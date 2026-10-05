import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

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

export type KachelFarbe = 'neutral' | 'gruen' | 'gelb' | 'blau' | 'rot';

/**
 * Sanfter Verlauf + Icon-Chip in Vollfarbe (Vorbild 05.10.2026: Kennzahl-Karten moderner SaaS-Dashboards).
 * Die Farbe sagt, was die Zahl bedeutet (grün gut, gelb wartet, blau unterwegs, rot dringend);
 * die Zahl selbst bleibt dunkel — der Chip und die Fläche tragen die Bedeutung.
 */
const KACHEL_STIL: Record<KachelFarbe, { karte: string; chip: string }> = {
  neutral: { karte: 'bg-gradient-to-br from-white to-[#f3f0ea]', chip: 'bg-ink2' },
  gruen: { karte: 'bg-gradient-to-br from-[#eef9f3] to-[#d5efe0]', chip: 'bg-good' },
  gelb: { karte: 'bg-gradient-to-br from-[#fff7df] to-[#fbeac0]', chip: 'bg-amber' },
  blau: { karte: 'bg-gradient-to-br from-[#edf4fd] to-[#d7e6f7]', chip: 'bg-steel' },
  rot: { karte: 'bg-gradient-to-br from-[#fdedea] to-[#f9d8d1]', chip: 'bg-accent' },
};

/** Farbe des Fortschrittsbalkens — dieselbe Familie wie Zahl und Text der Kachel. */
const BALKEN: Record<KachelFarbe, string> = {
  neutral: 'bg-ink2',
  gruen: 'bg-good',
  gelb: 'bg-amber',
  blau: 'bg-steel',
  rot: 'bg-accent',
};

/**
 * Kennzahl-Kachel. `farbe` tönt die Fläche; «warn» schaltet auf Bernstein, wenn keine Farbe gesetzt ist.
 * `fortschritt` legt einen feinen Balken unter die Zahl — «1 von 20» sieht man dann, statt es zu lesen.
 * Alle Kacheln einer Reihe sind gleich hoch, der Text sitzt unten an.
 */
export function Kachel({
  zu,
  wert,
  label,
  warn,
  farbe,
  fortschritt,
  icon: Icon,
}: {
  zu: string;
  wert: string;
  label: string;
  warn?: boolean;
  farbe?: KachelFarbe;
  fortschritt?: { von: number; bis: number };
  icon?: LucideIcon;
}) {
  const gewaehlt = farbe ?? (warn ? 'gelb' : 'neutral');
  const f = KACHEL_STIL[gewaehlt];
  const anteil = fortschritt && fortschritt.bis > 0 ? fortschritt.von / fortschritt.bis : 0;
  return (
    <Link to={zu} className={'card group flex flex-col justify-between gap-3 rounded-[20px] border-2 border-white/70 shadow-[0_1px_2px_rgb(17_17_19/0.04),0_16px_36px_-18px_rgb(17_17_19/0.22)] ' + f.karte}>
      {Icon && (
        <span className="flex items-center justify-between">
          <span className={'grid h-9 w-9 place-items-center rounded-[12px] text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.35)] ' + f.chip} aria-hidden="true">
            <Icon size={18} strokeWidth={2.2} />
          </span>
          <span className="text-ink3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true">→</span>
        </span>
      )}
      <span className="block">
        <span className="block text-[26px] font-semibold leading-none tabular-nums tracking-tight text-ink lg:text-[30px]">
          {wert}
        </span>
        {fortschritt && (
          <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
            <span
              className={'block h-full rounded-full transition-[width] duration-500 ' + BALKEN[gewaehlt]}
              style={{ width: `${Math.max(anteil * 100, fortschritt.von > 0 ? 3 : 0)}%` }}
            />
          </span>
        )}
        <span className="mt-1.5 block text-xs leading-snug text-ink2 lg:text-[13px]">{label}</span>
      </span>
    </Link>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
