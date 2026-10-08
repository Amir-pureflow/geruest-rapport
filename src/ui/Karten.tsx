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
 * Die grosse Zahl einer Kachel — in Übersicht und Export gleich (06.10.2026): 24/28 px, einzeilig.
 * Beträge «Fr. 3'904.81» bekommen das «Fr.» klein davor, damit sie nicht auf zwei Zeilen umbrechen.
 */
function KachelWert({ wert }: { wert: string }) {
  const fr = wert.startsWith('Fr. ');
  return (
    <span className="block whitespace-nowrap text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink lg:text-[28px]">
      {fr && <span className="mr-1 text-[15px] font-semibold text-ink3 lg:text-base">Fr.</span>}
      {fr ? wert.slice(4) : wert}
    </span>
  );
}

/**
 * Sanfter Verlauf + Icon-Chip in Vollfarbe (Vorbild 05.10.2026: Kennzahl-Karten moderner SaaS-Dashboards).
 * Die Farbe sagt, was die Zahl bedeutet (grün gut, gelb wartet, blau unterwegs, rot dringend);
 * die Zahl selbst bleibt dunkel — der Chip und die Fläche tragen die Bedeutung.
 */
// Überwiegend weiss, die Farbe läuft nur sanft in die untere Ecke (Vorbild-Detail, 05.10.2026)
const KACHEL_STIL: Record<KachelFarbe, { karte: string; chip: string }> = {
  neutral: { karte: 'bg-gradient-to-br from-white via-white to-[#f1ede5]', chip: 'bg-ink2' },
  gruen: { karte: 'bg-gradient-to-br from-white via-white to-[#d4f0e0]', chip: 'bg-good' },
  gelb: { karte: 'bg-gradient-to-br from-white via-white to-[#fbe6ae]', chip: 'bg-amber' },
  blau: { karte: 'bg-gradient-to-br from-white via-white to-[#d6e6f8]', chip: 'bg-steel' },
  rot: { karte: 'bg-gradient-to-br from-white via-white to-[#f9d8d1]', chip: 'bg-accent' },
};

/** Farbe des Fortschrittsbalkens — dieselbe Familie wie Zahl und Text der Kachel. */
const BALKEN: Record<KachelFarbe, string> = {
  neutral: 'bg-ink2',
  gruen: 'bg-good',
  gelb: 'bg-amber',
  blau: 'bg-steel',
  rot: 'bg-accent',
};

/** Weiche Trennstellen (U+00AD) in langen Kacheltiteln: unsichtbar, bis das Wort nicht passt — dann «Zusatz-|aufträge». */
const TRENNSTELLEN: [RegExp, string][] = [
  [/Zusatzaufträge/g, 'Zusatz­aufträge'],
  [/Überstunden/g, 'Über­stunden'],
  [/Verschickt/g, 'Ver­schickt'],
  [/Bestätigt/g, 'Be­stätigt'],
];
function mitTrennstellen(titel: string): string {
  return TRENNSTELLEN.reduce((t, [muster, ersatz]) => t.replace(muster, ersatz), titel);
}

/**
 * Kennzahl-Kachel. `farbe` tönt die Fläche; «warn» schaltet auf Bernstein, wenn keine Farbe gesetzt ist.
 * `fortschritt` legt einen feinen Balken unter die Zahl — «1 von 20» sieht man dann, statt es zu lesen.
 * Alle Kacheln einer Reihe sind gleich hoch, der Text sitzt unten an.
 */
export function Kachel({
  zu,
  titel,
  wert,
  label,
  warn,
  farbe,
  fortschritt,
  icon: Icon,
}: {
  zu: string;
  /** Kurzer Name der Kennzahl, steht neben dem Icon-Chip (Vorbild-Anatomie, 05.10.2026) */
  titel?: string;
  wert: string;
  label?: string;
  warn?: boolean;
  farbe?: KachelFarbe;
  fortschritt?: { von: number; bis: number };
  icon?: LucideIcon;
}) {
  const gewaehlt = farbe ?? (warn ? 'gelb' : 'neutral');
  const f = KACHEL_STIL[gewaehlt];
  const anteil = fortschritt && fortschritt.bis > 0 ? fortschritt.von / fortschritt.bis : 0;
  return (
    <Link to={zu} className={'card group flex flex-col justify-between gap-3.5 rounded-[20px] border-2 border-white/70 shadow-[0_1px_2px_rgb(17_17_19/0.04),0_16px_36px_-18px_rgb(17_17_19/0.22)] ' + f.karte}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className={'grid h-9 w-9 flex-none place-items-center rounded-[12px] text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.35)] ' + f.chip} aria-hidden="true">
              <Icon size={18} strokeWidth={2.2} />
            </span>
          )}
          {/* Umbrechen statt abschneiden («Beim K…», 08.10.2026): an Leerzeichen und an festen Trennstellen (TRENNSTELLEN) —
              nie mitten im Wort ohne Strich. Browser ohne deutsche Silbentrennung zerrissen sonst «Freigab|e». */}
          {titel && <span className="min-w-0 overflow-hidden text-sm font-semibold leading-tight text-ink [hyphens:manual]">{mitTrennstellen(titel)}</span>}
        </span>
        {/* Am Handy ohne Pfeil — dort ist die ganze Kachel der Knopf, und der Titel braucht den Platz */}
        <span className="hidden shrink-0 text-ink3 transition-transform duration-150 group-hover:translate-x-0.5 sm:inline" aria-hidden="true">→</span>
      </span>
      <span className="block">
        <KachelWert wert={wert} />
        {fortschritt && (
          <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
            <span
              className={'block h-full rounded-full transition-[width] duration-500 ' + BALKEN[gewaehlt]}
              style={{ width: `${Math.max(anteil * 100, fortschritt.von > 0 ? 3 : 0)}%` }}
            />
          </span>
        )}
        {label && <span className="mt-1.5 block text-xs leading-snug text-ink2 lg:text-[13px]">{label}</span>}
      </span>
    </Link>
  );
}

/** Kennzahl ohne Link — gleiche Anatomie wie `Kachel`: Icon-Chip + Titel, dunkle Zahl, Farbe nur in der Ecke. */
export function ZahlKarte({
  titel,
  wert,
  label,
  farbe = 'neutral',
  icon: Icon,
}: {
  titel: string;
  wert: string;
  label?: string;
  farbe?: KachelFarbe;
  icon?: LucideIcon;
}) {
  const f = KACHEL_STIL[farbe];
  return (
    <div className={'card flex flex-col justify-between gap-3.5 rounded-[20px] border-2 border-white/70 shadow-[0_1px_2px_rgb(17_17_19/0.04),0_16px_36px_-18px_rgb(17_17_19/0.22)] ' + f.karte}>
      <span className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className={'grid h-9 w-9 flex-none place-items-center rounded-[12px] text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.35)] ' + f.chip} aria-hidden="true">
            <Icon size={18} strokeWidth={2.2} />
          </span>
        )}
        <span className="truncate text-sm font-semibold text-ink">{titel}</span>
      </span>
      <span className="block">
        <KachelWert wert={wert} />
        {label && <span className="mt-1.5 block text-xs leading-snug text-ink2 lg:text-[13px]">{label}</span>}
      </span>
    </div>
  );
}

/**
 * Kennzahl im Seitenkopf (06.10.2026, ersetzt die flachen weissen Pillen): kleine Karte mit farbigem
 * Icon-Chip, Zahl über dem Text — dieselbe Sprache wie die Kacheln der Übersicht, nur kompakt.
 */
export function KennzahlPille({
  wert,
  text,
  farbe = 'neutral',
  icon: Icon,
}: {
  wert?: string;
  text: string;
  farbe?: KachelFarbe;
  icon?: LucideIcon;
}) {
  const f = KACHEL_STIL[farbe];
  return (
    <span className={'inline-flex items-center gap-2.5 rounded-[16px] border border-white/80 py-1.5 pl-1.5 pr-4 shadow-[0_1px_2px_rgb(17_17_19/0.05),0_10px_24px_-16px_rgb(17_17_19/0.3)] ' + f.karte}>
      {Icon && (
        <span className={'grid h-8 w-8 flex-none place-items-center rounded-[11px] text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.35)] ' + f.chip} aria-hidden="true">
          <Icon size={16} strokeWidth={2.3} />
        </span>
      )}
      <span className="flex flex-col leading-tight">
        {wert && <span className="text-[15px] font-semibold tabular-nums tracking-tight text-ink">{wert}</span>}
        <span className={wert ? 'text-[11.5px] text-ink3' : 'text-[13px] font-semibold text-ink2'}>{text}</span>
      </span>
    </span>
  );
}

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
