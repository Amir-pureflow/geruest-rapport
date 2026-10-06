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
 *
 * Farbe umgedreht (20.09.): Vorher war jede gemeldete Kachel grün getönt — bei
 * 17 von 20 eine grüne Wand, in der ausgerechnet das Fehlende still blieb. Jetzt
 * ist der Normalfall weiss und ruhig; bernstein sind die Tage mit Überstunden.
 * Was Arbeit macht, sticht heraus — der Rest ist nur Bestätigung.
 *
 * 06.10.2026: Kacheln wie die Dashboard-Kacheln — weiss, Farbe nur in der Ecke.
 * Offene Teams sind schlicht weiss statt grau gestrichelt: tagsüber ist fast jedes
 * Team offen, und eine graue Wand wirkte wie ein leeres Formular.
 *
 * Die Zahl «x von 20 gemeldet» steht als Kachel schon zuoberst auf der Seite.
 * Hier oben steht darum, was offen ist, nicht dieselbe Zahl zweimal.
 */
import { Link } from 'react-router-dom';
import { Check, CircleDashed } from 'lucide-react';
import type { TeamStand } from '../lib/kennzahlen';

type Zustand = 'gemeldet' | 'ueber' | 'fehlt';

/** Abzeichen rechts trägt Wort oder Uhrzeit (05.10.2026: der Mini-Punkt war auf einen Blick nicht lesbar). */
const STIL: Record<Zustand, { kachel: string; abzeichen: string }> = {
  gemeldet: { kachel: 'border-white/80 bg-gradient-to-br from-white via-white to-[#dcf2e5]', abzeichen: 'bg-good-soft text-good-deep ring-1 ring-good/20' },
  ueber: { kachel: 'border-amber/30 bg-gradient-to-br from-white via-white to-[#fbe3a6]', abzeichen: 'bg-amber text-white shadow-[0_3px_8px_-3px_rgb(217_147_15/0.6)]' },
  fehlt: { kachel: 'border-line bg-white', abzeichen: 'bg-white text-ink3 ring-1 ring-line-strong' },
};

function Kachel({ t }: { t: TeamStand }) {
  const zustand: Zustand = t.abweichung ? 'ueber' : t.gemeldetUm !== null ? 'gemeldet' : 'fehlt';
  const s = STIL[zustand];
  const ort = t.anzahlBaustellen > 1 ? `${t.anzahlBaustellen} Baustellen` : t.baustelle;

  return (
    <li
      className={'rounded-[14px] border px-3.5 py-3 shadow-[0_1px_2px_rgb(17_17_19/0.04),0_10px_24px_-18px_rgb(17_17_19/0.28)] ' + s.kachel}
      /* Zustand auch für Vorlesegeräte — nicht nur über die Farbe */
      aria-label={
        `${t.bezeichnung}, ${t.chefmonteur ?? 'kein Chefmonteur'}: ` +
        (t.gemeldetUm
          ? `gemeldet um ${t.gemeldetUm}${t.abweichung ? ', mit Überstunden' : ''}`
          : 'noch keine Meldung')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-display text-[15px] font-semibold text-ink">{t.bezeichnung}</span>
        <span className={'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ' + s.abzeichen} aria-hidden="true">
          {zustand === 'fehlt' ? <CircleDashed size={11} strokeWidth={2.5} /> : <Check size={11} strokeWidth={3} />}
          {t.gemeldetUm ?? 'offen'}
        </span>
      </div>
      <p className="mt-1 truncate text-[12px] text-ink2">{t.chefmonteur ?? 'kein Chefmonteur hinterlegt'}</p>
      {/* Dritte Zeile bleibt auch leer stehen, damit alle Kacheln gleich hoch sind */}
      <p className="truncate text-[11px] text-ink3">
        {zustand === 'fehlt' ? (
          'noch keine Meldung'
        ) : t.abweichung ? (
          <>
            <span className="font-semibold text-amber-deep">Überstunden</span>
            {ort ? ` · ${ort}` : ''}
          </>
        ) : (
          (ort ?? ' ')
        )}
      </p>
    </li>
  );
}

export function TeamBoard({ teams }: { teams: TeamStand[] }) {
  const fehlen = teams.filter((t) => t.gemeldetUm === null).length;
  const ueber = teams.filter((t) => t.abweichung).length;

  /** Ein Satz, der sagt, was noch zu tun ist — nicht, was schon gut ist. */
  const teile: string[] = [];
  if (fehlen > 0) teile.push(`${fehlen} ${fehlen === 1 ? 'Team hat' : 'Teams haben'} noch nicht gemeldet`);
  if (ueber > 0) teile.push(`${ueber} mit Überstunden`);

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="lbl mb-1">Teams heute</p>
          <p className="font-display text-[17px] font-semibold text-ink">
            {teile.length > 0 ? teile.join(' · ') : `Alle ${teams.length} Teams haben gemeldet`}
          </p>
        </div>
        <Link to="/heute" className="shrink-0 text-xs font-semibold text-steel">
          Tagesübersicht ›
        </Link>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {teams.map((t) => (
          <Kachel key={t.id} t={t} />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-ink3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-good" />gemeldet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber" />Überstunden — Notiz lesen
        </span>
        <span className="flex items-center gap-1.5">
          <CircleDashed size={11} strokeWidth={2.5} aria-hidden="true" />
          noch keine Meldung
        </span>
        <span className="sm:ml-auto">Das Teamgerät meldet am Abend — vorher sind viele Teams noch offen.</span>
      </div>
    </section>
  );
}
