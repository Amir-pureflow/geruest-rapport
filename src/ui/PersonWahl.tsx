import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Avatar } from './Dialog';
import { anzeigeName, namePasst } from '../lib/namen';

/**
 * Person wählen ohne Browser-Auswahlliste (12.10.2026, Amir: «mach das cleaner»): ein Feld wie die anderen; antippen
 * klappt eine Liste mit Suche auf — Avatar, Name, kleiner Zusatz (z. B. «temp», «Beispiel» statt «(Bsp.)» im Namen).
 * `oben` = ein besonderer Eintrag über den Personen (z. B. «Alle Mitarbeitenden»). Schliesst mit Esc, Klick daneben
 * oder nach der Wahl; Enter in der Suche nimmt den ersten Treffer.
 */
export interface PersonOption { id: string; name: string; zusatz?: string }
export interface ObenOption { id: string; text: string; hinweis?: string; icon?: ReactNode }

export function PersonWahl({
  id, leute, wert, aendern, platzhalter = 'Person wählen …', oben, leer = 'Niemand gefunden.',
}: {
  id?: string;
  leute: PersonOption[];
  wert: string;
  aendern: (id: string) => void;
  platzhalter?: string;
  oben?: ObenOption;
  leer?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listeId = useId();

  useEffect(() => {
    if (!offen) return;
    const weg = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOffen(false); };
    document.addEventListener('mousedown', weg);
    document.addEventListener('touchstart', weg);
    // In einem Dialog unten: die Liste ganz ins Bild scrollen, dann die Suche fokussieren
    setTimeout(() => { panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); eingabe.current?.focus({ preventScroll: true }); }, 0);
    return () => { document.removeEventListener('mousedown', weg); document.removeEventListener('touchstart', weg); };
  }, [offen]);

  const treffer = useMemo(() => leute.filter((p) => namePasst(p.name, suche)), [leute, suche]);
  const obenPasst = oben && namePasst(oben.text, suche);
  const gewaehlt = wert === oben?.id ? null : leute.find((p) => p.id === wert);

  function waehlen(neu: string) {
    aendern(neu);
    setOffen(false);
    setSuche('');
  }

  return (
    <div ref={box} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && offen) { e.stopPropagation(); setOffen(false); } }}>
      <button id={id} type="button" onClick={() => setOffen((o) => !o)} aria-haspopup="listbox" aria-expanded={offen} aria-controls={listeId}
        className={'field flex items-center gap-2.5 text-left ' + (wert ? 'py-[0.55rem] ' : '') + (offen ? 'border-accent' : '')}>
        {wert && wert === oben?.id ? (
          <>
            {oben.icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-steel-soft text-steel">{oben.icon}</span>}
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{oben.text}</span>
          </>
        ) : gewaehlt ? (
          <>
            <Avatar name={anzeigeName(gewaehlt.name).name} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{anzeigeName(gewaehlt.name).name}</span>
            <Zusaetze p={gewaehlt} />
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink3">{platzhalter}</span>
        )}
        <ChevronDown size={16} className={'shrink-0 text-ink3 transition ' + (offen ? 'rotate-180' : '')} aria-hidden="true" />
      </button>

      {offen && (
        <div ref={panel} className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[0_18px_40px_-18px_rgb(17_17_19/0.35)]">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
            <input ref={eingabe} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name suchen …" aria-label="Name suchen"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (treffer[0]) waehlen(treffer[0].id);
                else if (obenPasst && oben) waehlen(oben.id);
              }}
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink3" />
          </div>
          <div id={listeId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {obenPasst && oben && (
              <>
                <button type="button" role="option" aria-selected={wert === oben.id} onClick={() => waehlen(oben.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-ground">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-steel-soft text-steel">{oben.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{oben.text}</span>
                    {oben.hinweis && <span className="block truncate text-[11px] text-ink3">{oben.hinweis}</span>}
                  </span>
                  {wert === oben.id && <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />}
                </button>
                {treffer.length > 0 && <div className="mx-3 my-1 border-t border-line" />}
              </>
            )}
            {treffer.map((p) => {
              const a = anzeigeName(p.name);
              return (
                <button key={p.id} type="button" role="option" aria-selected={wert === p.id} onClick={() => waehlen(p.id)}
                  className={'flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-ground ' + (wert === p.id ? 'bg-ground' : '')}>
                  <Avatar name={a.name} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
                  <Zusaetze p={p} />
                  {wert === p.id && <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />}
                </button>
              );
            })}
            {treffer.length === 0 && !obenPasst && <p className="px-3 py-3 text-sm text-ink3">{leer}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Zusaetze({ p }: { p: PersonOption }) {
  const beispiel = anzeigeName(p.name).beispiel;
  return (
    <>
      {p.zusatz && <span className="shrink-0 rounded-full bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-amber-deep">{p.zusatz}</span>}
      {beispiel && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink3">Beispiel</span>}
    </>
  );
}
