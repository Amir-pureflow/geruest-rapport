import { artText } from '../lib/abwesenheit';

/** Farbe je Abwesenheitsart — überall gleich (Verwaltung, Teamgerät, Meine Woche, Export). */
const FARBE: Record<string, string> = {
  ferien: 'bg-steel-soft text-steel',
  krank: 'bg-amber-soft text-amber-deep',
  unfall: 'bg-accent-soft text-accent-deep',
  militaer: 'bg-surface-2 text-ink2',
  feiertag: 'bg-good-soft text-good-deep',
  todesfall: 'bg-ink/[0.08] text-ink',
  freitag: 'bg-good-soft text-good-deep',
  unbezahlt: 'bg-surface-2 text-ink3',
};

/** Kleine Pille «Ferien», «Krank» … */
export function ArtPille({ art, gross = false }: { art: string; gross?: boolean }) {
  return (
    <span className={'inline-block whitespace-nowrap rounded-md font-semibold ' + (gross ? 'px-2 py-0.5 text-xs ' : 'px-1.5 py-0.5 text-[10px] ') + (FARBE[art] ?? 'bg-surface-2 text-ink2')}>
      {artText(art)}
    </span>
  );
}
