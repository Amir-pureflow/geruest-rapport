/**
 * Wochenzeile eines Teams: sieben Tagesbalken statt Punkten.
 *
 * Vorher zeigten nur Tage MIT Hinweis ihre Stunden, alle anderen einen Punkt.
 * Damit erzählte das Raster von Problemen, aber nicht von Arbeit — 100 h und 36 h
 * sahen gleich aus. Jetzt trägt jeder Tag seine Höhe, und alle Teams teilen sich
 * dieselbe Skala, damit sich Zeilen untereinander vergleichen lassen.
 *
 * Harte Regel #1 bleibt: Die Farbe benennt eine Quelle («Regieverdacht», «über 10 h»),
 * sie sagt nie «falsch». Das Wort steht in der Zeile daneben.
 */
export type ZellStatus = 'leer' | 'gruen' | 'gelb' | 'rot' | 'frei';

export interface TagWert {
  datum: string;
  min: number;
  status: ZellStatus;
}

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Balkenfarben. Amber bleibt hell: ein dunkleres Amber besteht zwar den Kontrast,
 * ist bei Rot-Grün-Blindheit aber nicht mehr vom Rot zu trennen (ΔE 4.9) — und die
 * beiden bedeuten Verschiedenes. Die schwächere Fläche wird durch die Zahl über dem
 * Balken und das Statuswort in der Zeile aufgefangen.
 */
const BALKEN: Record<ZellStatus, string> = {
  leer: 'transparent',
  gruen: '#2f7fb0',
  frei: '#1e8a57',
  gelb: '#f59e0b',
  rot: '#d82816',
};

export const BALKEN_FARBE = BALKEN;

/** Stunden knapp: 36 statt 36.0, aber 3.5 bleibt 3.5. */
function knapp(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export function WochenBalken({
  tage,
  maxMin,
  totalMin,
  tageMitEintrag,
  markierterTag,
}: {
  tage: TagWert[];
  /** Gemeinsame Skala über alle sichtbaren Teams — sonst wäre nichts vergleichbar. */
  maxMin: number;
  totalMin: number;
  tageMitEintrag: number;
  markierterTag?: string | null;
}) {
  const skala = Math.max(maxMin, 60);

  return (
    <div className="mt-2 flex items-end gap-4">
      <div className="min-w-0 flex-1">
        {/* Zahlenzeile fest reservieren, damit alle Balken auf derselben Grundlinie enden */}
        <div className="flex h-[62px] items-end gap-[3px]">
          {tage.map((t) => {
            const anteil = t.min > 0 ? Math.max((t.min / skala) * 100, 9) : 0;
            const markiert = markierterTag === t.datum;
            return (
              <div key={t.datum} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <span className="block h-[12px] text-center font-mono text-[10px] leading-none tabular-nums text-ink2">
                  {t.min > 0 ? knapp(t.min) : ''}
                </span>
                <div
                  className={'w-full rounded-t-[3px] ' + (markiert ? 'ring-2 ring-steel' : '')}
                  style={{
                    // Restfläche nach der Zahlenzeile: 50 px
                    height: t.min > 0 ? `${(anteil / 100) * 50}px` : '2px',
                    backgroundColor: t.min > 0 ? BALKEN[t.status] : '#dce3e1',
                  }}
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[3px]">
          {tage.map((t, i) => (
            <span
              key={t.datum}
              className={'block min-w-0 flex-1 text-center font-mono text-[10px] leading-none ' + (t.min > 0 ? 'text-ink3' : 'text-ink3/45')}
            >
              {TAGE[i]}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="font-display text-xl font-extrabold leading-none tabular-nums text-ink">
          {knapp(totalMin)}
          <span className="ml-0.5 text-[13px] font-bold text-ink3">h</span>
        </p>
        <p className="mt-1 font-mono text-[10px] leading-none text-ink3">
          {tageMitEintrag} {tageMitEintrag === 1 ? 'Tag' : 'Tage'}
        </p>
      </div>
    </div>
  );
}

/** Teams ohne jede Meldung: ein Block statt vieler gleicher Zeilen. */
export function OhneMeldung({
  teams,
  aufTeam,
}: {
  teams: { id: string; bezeichnung: string; chef?: string | null }[];
  aufTeam: (id: string) => void;
}) {
  if (teams.length === 0) return null;
  return (
    <div className="px-3 py-3">
      <p className="text-xs font-semibold text-ink2">
        Keine Meldung diese Woche · {teams.length}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => aufTeam(t.id)}
            title={t.chef ?? undefined}
            className="rounded-[8px] border border-line bg-surface px-2.5 py-1 text-[12px] text-ink2 transition hover:border-line-strong hover:text-ink"
          >
            {t.bezeichnung}
          </button>
        ))}
      </div>
    </div>
  );
}
