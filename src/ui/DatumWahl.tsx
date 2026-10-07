import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addTage, ausIso, iso, lang, montag } from '../lib/datum';

/**
 * Datumswahl (08.10.2026) statt des Browser-Kalenders — der zeigte je nach Gerät Englisch («mm/dd/yyyy»,
 * Woche ab Sonntag) und passte nicht zur App. Deutsch, Woche ab Montag, heute rot umrandet, gewählt dunkel,
 * Schnellwahl Heute/Morgen/Übermorgen. Wert ist ein ISO-Datum (YYYY-MM-DD) oder '' (ohne Datum).
 * Der Kalender liegt in einem Portal über allem — auch in Fenstern (Dialog) wird er nicht abgeschnitten.
 */

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONATE_KURZ = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const SPALTEN = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const SCHNELL: [string, number][] = [['Heute', 0], ['Morgen', 1], ['Übermorgen', 2]];

/** «Do 8. Okt.» — mit «Heute ·» / «Morgen ·» davor, im anderen Jahr mit Jahreszahl. */
function anzeige(wert: string, heuteIso: string): string {
  const d = ausIso(wert);
  const basis = `${TAG[d.getDay()]} ${d.getDate()}. ${MONATE_KURZ[d.getMonth()]}`;
  const jahr = d.getFullYear() !== ausIso(heuteIso).getFullYear() ? ` ${d.getFullYear()}` : '';
  if (wert === heuteIso) return `Heute · ${basis}`;
  if (wert === iso(addTage(ausIso(heuteIso), 1))) return `Morgen · ${basis}`;
  return basis + jahr;
}

const ersterVon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 12);

export function DatumWahl({
  wert, aendern, label, platzhalter = 'Datum wählen', min, schnell = true, leerErlaubt = true,
}: {
  wert: string;
  aendern: (iso: string) => void;
  label: string;
  platzhalter?: string;
  /** Frühestes wählbares Datum (ISO), z. B. «bis» nicht vor «von». */
  min?: string;
  schnell?: boolean;
  leerErlaubt?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const heuteIso = iso(new Date());
  const [monat, setMonat] = useState(() => ersterVon(wert ? ausIso(wert) : new Date()));
  const knopf = useRef<HTMLButtonElement>(null);
  const tafel = useRef<HTMLDivElement>(null);
  const [lage, setLage] = useState<{ top: number; left: number; breite: number } | null>(null);

  function platzieren() {
    const r = knopf.current?.getBoundingClientRect();
    if (!r) return;
    const breite = Math.min(Math.max(r.width, 304), window.innerWidth - 16);
    const hoehe = tafel.current?.offsetHeight ?? 400;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - breite - 8);
    // Unten zu wenig Platz, oben genug? Dann über dem Feld öffnen.
    const top = window.innerHeight - r.bottom < hoehe + 12 && r.top > hoehe + 12 ? r.top - hoehe - 6 : r.bottom + 6;
    setLage({ top, left, breite });
  }

  useLayoutEffect(() => {
    if (offen) platzieren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen, monat]);

  useEffect(() => {
    if (!offen) return;
    const draussen = (e: Event) => {
      const t = e.target as Node;
      if (!tafel.current?.contains(t) && !knopf.current?.contains(t)) setOffen(false);
    };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffen(false); knopf.current?.focus(); } };
    const neu = () => platzieren();
    document.addEventListener('mousedown', draussen);
    document.addEventListener('touchstart', draussen);
    document.addEventListener('keydown', taste);
    window.addEventListener('resize', neu);
    window.addEventListener('scroll', neu, true);
    return () => {
      document.removeEventListener('mousedown', draussen);
      document.removeEventListener('touchstart', draussen);
      document.removeEventListener('keydown', taste);
      window.removeEventListener('resize', neu);
      window.removeEventListener('scroll', neu, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  function waehlen(d: string) {
    aendern(d);
    setOffen(false);
  }

  // Raster ab dem Montag der ersten Woche; fünf oder sechs Wochen, je nach Monat
  const start = montag(monat);
  const alle = Array.from({ length: 42 }, (_, i) => addTage(start, i));
  const tage = alle[35].getMonth() === monat.getMonth() ? alle : alle.slice(0, 35);

  return (
    <div className="relative">
      <button
        ref={knopf}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={offen}
        onClick={() => {
          if (!offen) setMonat(ersterVon(wert ? ausIso(wert) : new Date()));
          setOffen(!offen);
        }}
        className={'field flex items-center gap-2.5 text-left ' + (wert && leerErlaubt ? 'pr-10 ' : '') + (offen ? 'border-accent shadow-[0_0_0_3px_rgb(224_48_30/0.12)]' : '')}
      >
        <CalendarDays size={16} className={'shrink-0 ' + (wert ? 'text-accent' : 'text-ink3')} aria-hidden="true" />
        <span className={'min-w-0 flex-1 truncate ' + (wert ? 'font-medium text-ink' : 'text-ink3')}>{wert ? anzeige(wert, heuteIso) : platzhalter}</span>
      </button>
      {wert && leerErlaubt && !offen && (
        <button type="button" aria-label="Datum entfernen" onClick={() => aendern('')}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-ink3 hover:bg-surface-2 hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      )}

      {offen && createPortal(
        <div
          ref={tafel}
          role="dialog"
          aria-label={label}
          style={{ position: 'fixed', top: lage?.top ?? -9999, left: lage?.left ?? 0, width: lage?.breite ?? 304 }}
          className="z-[70] rounded-[18px] border border-line bg-white p-3 shadow-[0_24px_60px_-18px_rgb(17_17_19/0.35),0_2px_6px_rgb(17_17_19/0.06)]"
        >
          {schnell && (
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {SCHNELL.map(([text, n]) => {
                const d = addTage(new Date(), n);
                const i = iso(d);
                const an = wert === i;
                return (
                  <button key={text} type="button" disabled={!!min && i < min} onClick={() => waehlen(i)}
                    className={'rounded-[12px] px-2 py-2 text-xs font-semibold transition disabled:opacity-40 ' + (an ? 'bg-ink text-white shadow-sm' : 'bg-surface-2 text-ink2 hover:text-ink')}>
                    {text}
                    <span className={'block text-[10px] font-medium ' + (an ? 'text-white/70' : 'text-ink3')}>{TAG[d.getDay()]} {d.getDate()}.{d.getMonth() + 1}.</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mb-1 flex items-center justify-between px-1">
            <button type="button" aria-label="Vormonat" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1, 12))}
              className="grid h-8 w-8 place-items-center rounded-full text-ink2 hover:bg-surface-2 hover:text-ink">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="font-display text-sm font-semibold">{MONATE[monat.getMonth()]} {monat.getFullYear()}</span>
            <button type="button" aria-label="Nächster Monat" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1, 12))}
              className="grid h-8 w-8 place-items-center rounded-full text-ink2 hover:bg-surface-2 hover:text-ink">
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-ink3">
            {SPALTEN.map((t) => <span key={t} className="py-1.5">{t}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {tage.map((d) => {
              const i = iso(d);
              const imMonat = d.getMonth() === monat.getMonth();
              const an = i === wert;
              const heute = i === heuteIso;
              const wochenende = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button key={i} type="button" disabled={!!min && i < min} onClick={() => waehlen(i)} aria-pressed={an} aria-label={lang(d)}
                  className={
                    'mx-auto grid h-9 w-9 place-items-center rounded-full text-sm tabular-nums transition disabled:cursor-not-allowed disabled:opacity-25 ' +
                    (an
                      ? 'bg-ink font-semibold text-white shadow-[0_4px_10px_-4px_rgb(17_17_19/0.5)]'
                      : heute
                        ? 'font-semibold text-accent ring-1 ring-accent/50 hover:bg-accent-soft'
                        : (imMonat ? (wochenende ? 'text-ink3' : 'text-ink') : 'text-ink3/40') + ' hover:bg-surface-2')
                  }
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line px-1 pt-2">
            {leerErlaubt
              ? <button type="button" onClick={() => waehlen('')} className="text-xs font-semibold text-ink3 hover:text-ink">Ohne Datum</button>
              : <span />}
            <button type="button" onClick={() => setMonat(ersterVon(new Date()))} className="text-xs font-semibold text-steel">Zu heute</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
