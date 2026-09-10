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

export type KachelFarbe = 'neutral' | 'gruen' | 'gelb' | 'blau' | 'rot';

/** Getönte Fläche + Zahl in der Farbe — die Farbe sagt, was die Zahl bedeutet (grün gut, gelb wartet, blau unterwegs, rot dringend). */
const KACHEL_STIL: Record<KachelFarbe, { karte: string; zahl: string; text: string }> = {
  neutral: { karte: 'bg-surface', zahl: 'text-ink', text: 'text-ink3' },
  gruen: { karte: 'bg-good-soft', zahl: 'text-good-deep', text: 'text-good-deep/70' },
  gelb: { karte: 'bg-amber-soft', zahl: 'text-amber-deep', text: 'text-amber-deep/70' },
  blau: { karte: 'bg-steel-soft', zahl: 'text-steel', text: 'text-steel/70' },
  rot: { karte: 'bg-accent-soft', zahl: 'text-accent-deep', text: 'text-accent-deep/70' },
};

/** Kennzahl-Kachel. `farbe` tönt die Fläche; «warn» schaltet auf Bernstein, wenn keine Farbe gesetzt ist. */
export function Kachel({ zu, wert, label, warn, farbe }: { zu: string; wert: string; label: string; warn?: boolean; farbe?: KachelFarbe }) {
  const f = KACHEL_STIL[farbe ?? (warn ? 'gelb' : 'neutral')];
  return (
    <Link to={zu} className={'card block ' + f.karte}>
      <span className={'block text-2xl font-semibold tabular-nums tracking-tight lg:text-[28px] ' + f.zahl}>{wert}</span>
      <span className={'mt-0.5 block text-xs lg:text-sm ' + f.text}>{label}</span>
    </Link>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
