import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Segment-Umschalter (06.10.2026): weisse Pillen-Schiene, gewählt = dunkle Pille — dieselbe Form wie in
 * Planung und Verwaltung. Ersetzt lose Chips überall dort, wo genau eine von wenigen Optionen gilt.
 */
export function Segment<T extends string | number>({
  optionen,
  wert,
  aendern,
  label,
  gross = false,
}: {
  optionen: { wert: T; text: ReactNode }[];
  wert: T;
  aendern: (w: T) => void;
  label: string;
  gross?: boolean;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgb(17_17_19/0.06)]" role="group" aria-label={label}>
      {optionen.map((o) => {
        const an = wert === o.wert;
        return (
          <button
            key={String(o.wert)}
            type="button"
            aria-pressed={an}
            onClick={() => aendern(o.wert)}
            className={
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition ' +
              (gross ? 'px-4 py-1.5 text-sm ' : 'px-3.5 py-1.5 text-xs ') +
              (an ? 'bg-ink text-white shadow-sm' : 'text-ink2 hover:text-ink')
            }
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** Zahl in einer Segment-Option («Lohnstunden 70») — hell auf dunkel, wenn gewählt. */
export function SegmentZahl({ n, an }: { n: number; an: boolean }) {
  return (
    <span className={'rounded-full px-1.5 text-[11px] font-semibold tabular-nums ' + (an ? 'bg-white/20 text-white' : 'bg-ink/[0.07] text-ink3')}>{n}</span>
  );
}

/** Ein/Aus-Schalter mit Text — statt einer nackten Checkbox. */
export function Schalter({ an, aendern, text }: { an: boolean; aendern: (an: boolean) => void; text: string }) {
  return (
    <button type="button" role="switch" aria-checked={an} onClick={() => aendern(!an)} className="inline-flex items-center gap-2 rounded-full py-1 pr-1 text-xs font-semibold text-ink2 transition hover:text-ink">
      <span className={'relative h-5 w-9 flex-none rounded-full transition-colors ' + (an ? 'bg-good' : 'bg-ink/15')} aria-hidden="true">
        <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(17_17_19/0.3)] transition-[left] ' + (an ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {text}
    </button>
  );
}

/** Zeitraum blättern: zwei Pfeile in einer weissen Pille, der Titel in der Mitte (wie Tagesübersicht und Planung). */
export function Blaettern({
  titel,
  zurueck,
  vor,
  labelZurueck = 'Zurück',
  labelVor = 'Weiter',
  vorGesperrt = false,
}: {
  titel: string;
  zurueck: () => void;
  vor: () => void;
  labelZurueck?: string;
  labelVor?: string;
  vorGesperrt?: boolean;
}) {
  return (
    <div className="flex items-center rounded-full border border-ink/10 bg-white shadow-[0_1px_2px_rgb(17_17_19/0.06)]">
      <button type="button" aria-label={labelZurueck} onClick={zurueck} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep"><ChevronLeft size={17} /></button>
      <span className="min-w-[170px] px-1 text-center text-sm font-semibold tabular-nums text-ink">{titel}</span>
      <button type="button" aria-label={labelVor} onClick={vor} disabled={vorGesperrt} className="grid h-9 w-9 place-items-center rounded-full text-ink2 hover:text-accent-deep disabled:opacity-30"><ChevronRight size={17} /></button>
    </div>
  );
}
