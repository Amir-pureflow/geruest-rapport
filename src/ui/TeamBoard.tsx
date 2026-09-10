/**
 * Team-Board: der Tagesstand aller Teams auf einen Blick.
 *
 * Ersetzt die zwei Chip-Listen («gemeldet» / «noch nicht»). Feste Reihenfolge nach
 * Teamnummer wie das Whiteboard im Büro — Team 7 steht immer am selben Platz, die
 * Minderheit sticht von selbst heraus.
 *
 * Wichtig: kein Ranking, keine Bewertung von Personen (CLAUDE.md «Nicht bauen»).
 * Der Chefmonteur steht dabei, damit der Bauführer weiss, wen er anruft — nicht,
 * um jemanden zu messen. Der Zustand hängt nie an der Farbe allein: jede Kachel
 * trägt Uhrzeit oder Wort.
 */
import { Link } from 'react-router-dom';
import type { TeamStand } from '../lib/kennzahlen';

function Fortschritt({ von, bis }: { von: number; bis: number }) {
  const anteil = bis > 0 ? von / bis : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ground" role="img" aria-label={`${von} von ${bis} Teams haben gemeldet`}>
      <div
        className="h-full rounded-full bg-good transition-[width] duration-500"
        style={{ width: `${Math.max(anteil * 100, von > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function Kachel({ t }: { t: TeamStand }) {
  const gemeldet = t.gemeldetUm !== null;
  const rand = t.abweichung ? 'bg-amber' : gemeldet ? 'bg-good' : 'bg-line-strong';
  const flaeche = t.abweichung ? 'bg-amber-soft' : gemeldet ? 'bg-good-soft/50' : 'bg-surface';
  const zeitFarbe = t.abweichung ? 'text-amber-deep' : gemeldet ? 'text-good-deep' : 'text-ink3';
  const ort = t.anzahlMeldungen > 1 ? `${t.anzahlMeldungen} Baustellen` : t.baustelle;

  return (
    <li
      className={'relative overflow-hidden rounded-[11px] border border-line ' + flaeche}
      /* Zustand auch für Vorlesegeräte — nicht nur über die Farbkante */
      aria-label={
        `${t.bezeichnung}, ${t.chefmonteur ?? 'kein Chefmonteur'}: ` +
        (gemeldet ? `gemeldet um ${t.gemeldetUm}${t.abweichung ? ', mit Abweichung' : ''}` : 'noch keine Meldung')
      }
    >
      <span className={'absolute inset-y-0 left-0 w-[3px] ' + rand} aria-hidden="true" />
      <div className="py-2 pl-3.5 pr-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[15px] font-semibold text-ink">{t.bezeichnung}</span>
          <span className={'font-mono text-[11px] tabular-nums ' + zeitFarbe}>{t.gemeldetUm ?? '—'}</span>
        </div>
        <p className="truncate text-[12px] text-ink2">{t.chefmonteur ?? 'kein Chefmonteur hinterlegt'}</p>
        {/* Dritte Zeile bleibt auch leer stehen, damit alle Kacheln gleich hoch sind */}
        <p className="truncate text-[11px] text-ink3">
          {t.abweichung ? (
            <>
              <span className="font-semibold text-amber-deep">Abweichung</span>
              {ort ? ` · ${ort}` : ''}
            </>
          ) : (
            ort ?? ' '
          )}
        </p>
      </div>
    </li>
  );
}

export function TeamBoard({ teams }: { teams: TeamStand[] }) {
  const gemeldet = teams.filter((t) => t.gemeldetUm !== null).length;
  const abweichungen = teams.filter((t) => t.abweichung).length;

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="lbl mb-1">Heute</p>
          <p className="font-display text-[17px] font-semibold text-ink">
            {gemeldet} von {teams.length} Teams haben gemeldet
          </p>
        </div>
        <Link to="/heute" className="shrink-0 text-xs font-semibold text-steel">
          Tagesübersicht ›
        </Link>
      </div>

      <div className="mt-2.5">
        <Fortschritt von={gemeldet} bis={teams.length} />
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {teams.map((t) => (
          <Kachel key={t.id} t={t} />
        ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[11px] text-ink3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-good" />gemeldet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-amber" />
          Abweichung{abweichungen > 0 ? ` · ${abweichungen}` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-line-strong" />noch keine Meldung
        </span>
        <span className="ml-auto">Am Abend meldet das Teamgerät — vorher sind viele Kacheln normal grau.</span>
      </div>
    </section>
  );
}
