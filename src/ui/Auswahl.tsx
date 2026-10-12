import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { namePasst } from '../lib/namen';

/**
 * Auswahl ohne Browser-Liste (12.10.2026, Amir: «mach das cleaner» — überall in der App): ein Feld wie die anderen
 * (`art="feld"`) oder eine kleine Pille für Werkzeugleisten (`art="pille"`); antippen klappt eine Liste auf, bei mehr als
 * zehn Einträgen mit Suche. Einträge mit Bild vorne (Avatar, Symbol), Unterzeile und kleinen Marken («temp», «Beispiel»);
 * `trenner` zieht nach einem Eintrag eine Linie (z. B. nach «Alle Mitarbeitenden»). Schliesst mit Esc, Klick daneben oder
 * nach der Wahl; Enter in der Suche nimmt den ersten Treffer.
 */
export interface Marke { text: string; leise?: boolean }
export interface AuswahlOption { wert: string; text: string; unter?: string; vorne?: ReactNode; marken?: Marke[]; trenner?: boolean }

export function Auswahl({
  id, label, optionen, wert, aendern, platzhalter = 'Wählen …', suche, leer = 'Nichts gefunden.', art = 'feld', icon,
}: {
  id?: string;
  /** Für Vorleser, wenn kein sichtbares Label mit `htmlFor` darauf zeigt */
  label?: string;
  optionen: AuswahlOption[];
  wert: string;
  aendern: (wert: string) => void;
  platzhalter?: string;
  /** Suche zeigen — Standard: ab mehr als zehn Einträgen */
  suche?: boolean;
  leer?: string;
  art?: 'feld' | 'pille';
  /** Symbol vorne in der Pille */
  icon?: ReactNode;
}) {
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  // Pille nahe am rechten Rand (Handy): Liste rechtsbündig, damit sie nicht aus dem Bild ragt
  const [rechtsbuendig, setRechtsbuendig] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listeId = useId();
  const mitSuche = suche ?? optionen.length > 10;

  // Immer nur eine Liste offen — auch wenn die nächste per Tastatur aufgeht (dann gibt es keinen Klick daneben)
  useEffect(() => {
    const andere = (e: Event) => { if ((e as CustomEvent<string>).detail !== listeId) setOffen(false); };
    window.addEventListener('auswahl-offen', andere);
    return () => window.removeEventListener('auswahl-offen', andere);
  }, [listeId]);

  useEffect(() => {
    if (!offen) return;
    window.dispatchEvent(new CustomEvent('auswahl-offen', { detail: listeId }));
    const weg = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOffen(false); };
    document.addEventListener('mousedown', weg);
    document.addEventListener('touchstart', weg);
    // In einem Dialog unten: die Liste ganz ins Bild scrollen, dann die Suche fokussieren
    setTimeout(() => { panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); eingabe.current?.focus({ preventScroll: true }); }, 0);
    return () => { document.removeEventListener('mousedown', weg); document.removeEventListener('touchstart', weg); };
  }, [offen, listeId]);

  const treffer = useMemo(() => optionen.filter((o) => namePasst(o.text + ' ' + (o.unter ?? ''), text)), [optionen, text]);
  const gewaehlt = optionen.find((o) => o.wert === wert);

  function waehlen(neu: string) {
    aendern(neu);
    setOffen(false);
    setText('');
  }

  const knopf = art === 'pille'
    ? 'inline-flex max-w-full items-center gap-2 rounded-full border bg-white py-2 pl-3 pr-2.5 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(17_17_19/0.06)] transition ' + (offen ? 'border-accent' : 'border-ink/10 hover:border-ink/20')
    : 'field flex items-center gap-2.5 text-left ' + (gewaehlt?.vorne ? 'py-[0.55rem] ' : '') + (offen ? 'border-accent' : '');

  return (
    <div ref={box} className={'relative ' + (art === 'pille' ? 'inline-block max-w-full' : '')} onKeyDown={(e) => { if (e.key === 'Escape' && offen) { e.stopPropagation(); setOffen(false); } }}>
      <button id={id} type="button" onClick={() => {
        const r = box.current?.getBoundingClientRect();
        setRechtsbuendig(!!r && r.left + Math.min(300, window.innerWidth * 0.85) > window.innerWidth - 12);
        setOffen((o) => !o);
      }} aria-haspopup="listbox" aria-expanded={offen} aria-controls={listeId} aria-label={label} className={knopf}>
        {art === 'pille' && icon && <span className="shrink-0 text-ink3">{icon}</span>}
        {gewaehlt ? (
          <>
            {art === 'feld' && gewaehlt.vorne}
            <span className={'min-w-0 flex-1 truncate ' + (art === 'feld' ? 'font-medium text-ink' : '')}>{gewaehlt.text}</span>
            {art === 'feld' && <Marken marken={gewaehlt.marken} />}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink3">{platzhalter}</span>
        )}
        <ChevronDown size={art === 'pille' ? 14 : 16} className={'shrink-0 text-ink3 transition ' + (offen ? 'rotate-180' : '')} aria-hidden="true" />
      </button>

      {offen && (
        <div ref={panel} className={'absolute top-full z-30 mt-1.5 overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[0_18px_40px_-18px_rgb(17_17_19/0.35)] ' + (art === 'pille' ? (rechtsbuendig ? 'right-0' : 'left-0') + ' w-[min(300px,85vw)]' : 'inset-x-0')}>
          {mitSuche && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
              <input ref={eingabe} value={text} onChange={(e) => setText(e.target.value)} placeholder="Suchen …" aria-label="Suchen"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (treffer[0]) waehlen(treffer[0].wert); } }}
                className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
            </div>
          )}
          <div id={listeId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {treffer.map((o, i) => (
              <div key={o.wert}>
                <button type="button" role="option" aria-selected={wert === o.wert} onClick={() => waehlen(o.wert)}
                  className={'flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-ground ' + (wert === o.wert ? 'bg-ground' : '')}>
                  {o.vorne}
                  <span className="min-w-0 flex-1">
                    <span className={'block truncate text-sm text-ink ' + (o.unter ? 'font-semibold' : '')}>{o.text}</span>
                    {o.unter && <span className="block truncate text-[11px] text-ink3">{o.unter}</span>}
                  </span>
                  <Marken marken={o.marken} />
                  {wert === o.wert && <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />}
                </button>
                {o.trenner && i < treffer.length - 1 && <div className="mx-3 my-1 border-t border-line" />}
              </div>
            ))}
            {treffer.length === 0 && <p className="px-3 py-3 text-sm text-ink3">{leer}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Marken({ marken }: { marken?: Marke[] }) {
  if (!marken?.length) return null;
  return (
    <>
      {marken.map((m) => (
        <span key={m.text} className={'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ' + (m.leise ? 'bg-surface-2 font-medium text-ink3' : 'bg-amber-soft font-semibold text-amber-deep')}>{m.text}</span>
      ))}
    </>
  );
}

/** Rundes Symbol vorne in einem Eintrag (z. B. «Alle Mitarbeitenden», «Kein Kunde») */
export function SymbolRund({ children }: { children: ReactNode }) {
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-steel-soft text-steel">{children}</span>;
}
