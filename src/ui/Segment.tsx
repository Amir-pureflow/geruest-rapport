import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

/**
 * Segment-Umschalter (06.10.2026; seit 15.11.2026 «weisser Schieber», Klasse `schiene` in index.css): helles Band,
 * gewählt = weisses Feld mit Schatten — dieselbe Form wie in
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
    <div className="inline-flex max-w-full overflow-x-auto schiene" role="group" aria-label={label}>
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
              (an ? 'schiene-an' : '')
            }
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** Zahl in einer Segment-Option («Lohnstunden 70») — rot, wenn gewählt. */
export function SegmentZahl({ n, an }: { n: number; an: boolean }) {
  return (
    <span className={'rounded-full px-1.5 text-[11px] font-semibold tabular-nums ' + (an ? 'bg-accent-soft text-accent-deep' : 'bg-ink/[0.07] text-ink3')}>{n}</span>
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

/**
 * Zeitraum blättern (Konzept C «eine Leiste», Amir 15.11.2026): eine weisse Leiste ‹ Titel › | Heute.
 * «KW 46 · 9.11. – 15.11.» — der Teil nach « · » steht grau. Mit `heute`: «Heute» am Ende der Leiste; ist man nicht
 * beim heutigen Zeitraum, bekommt es einen roten Punkt («hier zurück»).
 */
export function Blaettern({
  titel,
  zurueck,
  vor,
  labelZurueck = 'Zurück',
  labelVor = 'Weiter',
  vorGesperrt = false,
  heute,
  breite = 'min-w-[150px]',
}: {
  titel: string;
  zurueck: () => void;
  vor: () => void;
  labelZurueck?: string;
  labelVor?: string;
  vorGesperrt?: boolean;
  /** «Heute»-Knopf: `da` = man ist schon beim heutigen Zeitraum */
  heute?: { da: boolean; los: () => void };
  breite?: string;
}) {
  const [haupt, ...rest] = titel.split(' · ');
  return (
    <div className="leiste inline-flex max-w-full items-center">
      <button type="button" aria-label={labelZurueck} onClick={zurueck} className="leiste-pfeil"><ChevronLeft size={17} /></button>
      <span className={'flex items-center justify-center gap-2 whitespace-nowrap px-2 text-sm font-bold tabular-nums text-ink ' + breite}>
        {haupt}
        {/* Unter 400 px nur «KW 48» — sonst ragte die Leiste mit Datum und «Heute» über den Rand (Prüfung 28.11.2026) */}
        {rest.length > 0 && <span className="hidden font-medium text-ink3 min-[400px]:inline">{rest.join(' · ')}</span>}
      </span>
      <button type="button" aria-label={labelVor} onClick={vor} disabled={vorGesperrt} className="leiste-pfeil disabled:opacity-30"><ChevronRight size={17} /></button>
      {heute && (
        <>
          <span className="mx-1 h-[22px] w-px bg-line" aria-hidden="true" />
          <button type="button" onClick={heute.los} disabled={heute.da}
            className={'leiste-heute ' + (heute.da ? 'text-ink2' : 'text-accent-deep')}>
            {!heute.da && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgb(224_48_30/0.15)]" aria-hidden="true" />}
            Heute
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Kleine Aktions-Pille (11.10.2026): «+ Team 2», «+ Einsatz planen», Schnellwahl «Bis Freitag». `plus` setzt das Plus
 * im roten Hauch-Kreis davor, `an` markiert die gewählte (dunkel). Für Auswahl aus wenigen Werten lieber `Segment`.
 */
export function Pille({ children, onClick, plus = false, an, disabled = false, title }: {
  children: ReactNode;
  onClick: () => void;
  plus?: boolean;
  an?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={an}
      className={'pille' + (plus ? ' pille-plus' : '') + (an ? ' pille-an' : '')}>
      {plus && <span className="pille-icon" aria-hidden="true"><Plus size={12} strokeWidth={2.8} /></span>}
      {children}
    </button>
  );
}
