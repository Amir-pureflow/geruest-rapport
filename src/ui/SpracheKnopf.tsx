import { Languages } from 'lucide-react';
import { albanischSetzen, useAlbanisch } from '../lib/albanisch';

/**
 * Sprache der Oberfläche auf der Baustelle: ein Knopf oben rechts, zeigt immer die *andere* Sprache in ihrer eigenen
 * Schreibweise — «Shqip» auf Deutsch, «Deutsch» auf Albanisch. So findet ihn auch, wer die aktuelle Sprache nicht liest.
 */
export function SpracheKnopf() {
  const sq = useAlbanisch();
  return (
    <button
      type="button"
      data-bleibt-deutsch
      onClick={() => albanischSetzen(!sq)}
      aria-pressed={sq}
      aria-label={sq ? 'Sprache: Deutsch' : 'Sprache: Albanisch (Shqip)'}
      className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Languages size={15} strokeWidth={1.9} className="text-ink3" aria-hidden="true" />
      <span lang={sq ? 'de' : 'sq'}>{sq ? 'Deutsch' : 'Shqip'}</span>
    </button>
  );
}
