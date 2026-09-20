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
}: {
  zu: string;
  wert: string;
  label: string;
  warn?: boolean;
  farbe?: KachelFarbe;
  fortschritt?: { von: number; bis: number };
}) {
  const gewaehlt = farbe ?? (warn ? 'gelb' : 'neutral');
  const f = KACHEL_STIL[gewaehlt];
  const anteil = fortschritt && fortschritt.bis > 0 ? fortschritt.von / fortschritt.bis : 0;
  return (
    <Link to={zu} className={'card flex flex-col justify-between gap-2 ' + f.karte}>
      <span className={'block text-[26px] font-semibold leading-none tabular-nums tracking-tight lg:text-[30px] ' + f.zahl}>
        {wert}
      </span>
      <span className="block">
        {fortschritt && (
          <span className="mb-2 block h-1 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
            <span
              className={'block h-full rounded-full transition-[width] duration-500 ' + BALKEN[gewaehlt]}
              style={{ width: `${Math.max(anteil * 100, fortschritt.von > 0 ? 3 : 0)}%` }}
            />
          </span>
        )}
        <span className={'block text-xs leading-snug lg:text-[13px] ' + f.text}>{label}</span>
      </span>
    </Link>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
