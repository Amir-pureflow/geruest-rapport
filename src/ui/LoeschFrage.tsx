import { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Entscheid, Rueckfrage } from '../lib/entfernen';

/** Papierkorb wie beim Zusatzauftrag — öffnet nur die Rückfrage, löscht nie direkt. */
export function Papierkorb({ titel, onClick }: { titel: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={titel} title={titel}
      className="grid h-8 w-8 place-items-center rounded-full text-ink3 transition hover:bg-accent-soft hover:text-accent-deep">
      <Trash2 size={15} aria-hidden="true" />
    </button>
  );
}

type Ergebnis = { fehler: string } | { ergebnis: 'geloescht' | 'deaktiviert' };

export interface Frage<T> {
  ding: T;
  text: string;
  /** null = nichts zu tun (prüft noch, Fehler, «bleibt») — dann gibt es nur «Abbrechen» */
  knopf: string | null;
  entscheid: Entscheid | null;
  laeuft: boolean;
}

/**
 * Ablauf der Rückfrage (09.10.2026): Papierkorb → nachschauen, ob Stunden dranhängen → Satz, der sagt, was passiert →
 * bestätigen. Was genau passiert, entscheiden `pruefen`/`entfernen` (src/lib/entfernen.ts), nicht die Seite.
 */
export function useLoeschFrage<T extends { id: string }>(
  pruefen: (x: T) => Promise<Rueckfrage | { fehler: string }>,
  entfernen: (x: T, entscheid: Entscheid) => Promise<Ergebnis>,
  fertig: (x: T, ergebnis: 'geloescht' | 'deaktiviert', entscheid: Entscheid) => void,
) {
  const [frage, setFrage] = useState<Frage<T> | null>(null);

  async function fragen(x: T) {
    setFrage({ ding: x, text: 'Einen Moment …', knopf: null, entscheid: null, laeuft: true });
    const r = await pruefen(x);
    // Inzwischen eine andere Zeile gewählt oder abgebrochen → diese Antwort gilt nicht mehr
    setFrage((f) => (f?.ding.id !== x.id ? f : 'fehler' in r
      ? { ding: x, text: r.fehler, knopf: null, entscheid: null, laeuft: false }
      : { ding: x, text: r.text, knopf: r.knopf, entscheid: r.entscheid, laeuft: false }));
  }

  async function bestaetigen() {
    if (!frage?.entscheid || frage.laeuft) return;
    const { ding, entscheid } = frage;
    setFrage({ ...frage, laeuft: true });
    const r = await entfernen(ding, entscheid);
    if ('fehler' in r) { setFrage({ ding, text: r.fehler, knopf: null, entscheid: null, laeuft: false }); return; }
    setFrage(null);
    fertig(ding, r.ergebnis, entscheid);
  }

  const abbrechen = useCallback(() => setFrage(null), []);

  return { frage, fragen: (x: T) => void fragen(x), bestaetigen: () => void bestaetigen(), abbrechen };
}

const RAND = {
  /** unten in einer Karte, wie beim Zusatzauftrag */
  karte: 'border-t border-accent/30 rounded-b-[18px]',
  /** für sich, z. B. im Fenster */
  fenster: 'rounded-[14px] border border-accent/30',
  /** als eigene Tabellenzeile — die Linie zieht die Tabelle */
  tabelle: '',
} as const;

/** Rückfrage-Leiste wie beim Zusatzauftrag: Satz, «Abbrechen», roter Knopf. */
export function LoeschLeiste<T>({ frage, onAbbrechen, onBestaetigen, art = 'karte' }: {
  frage: Frage<T>;
  onAbbrechen: () => void;
  onBestaetigen: () => void;
  art?: keyof typeof RAND;
}) {
  return (
    <div aria-live="polite" className={'flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-4 py-2.5 text-xs ' + RAND[art]}>
      <span className="font-semibold text-accent-deep">{frage.text}</span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={onAbbrechen} className="font-semibold text-ink3 hover:text-ink">Abbrechen</button>
        {frage.knopf && (
          <button type="button" onClick={onBestaetigen} disabled={frage.laeuft} className="rounded-full bg-accent px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-accent-deep disabled:opacity-50">{frage.knopf}</button>
        )}
      </span>
    </div>
  );
}
