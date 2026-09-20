/**
 * Diagramme für die Büro-Startseiten (Bauführer, Sekretariat).
 *
 * Bewusst ohne Diagramm-Bibliothek: Flächen aus den Design-Tokens, kein SVG.
 * Das hält die App klein, funktioniert offline und sieht aus wie der Rest.
 *
 * Warum kein SVG mehr (20.09.): Die Säulen standen in einem SVG mit fester
 * `viewBox`. Am PC wurde die Karte über 900 px breit, das SVG skalierte
 * mitsamt Schrift auf über 400 px Höhe — drei kleine Säulen in einer grossen
 * leeren Fläche, mit Beschriftung dreimal zu gross. Jetzt sind es Flächen mit
 * fester Höhe: die Schrift bleibt Schrift, die Karte bleibt ruhig.
 *
 * Und: Jeder Tag hat eine volle Spur im Hintergrund — sie ist alle Teams.
 * «2 von 20» sieht man dann als zwei Zwanzigstel, statt als kurzen Strich im
 * Nichts. Leere Tage bleiben sichtbar, statt zu verschwinden.
 *
 * Regel aus CLAUDE.md «Nicht bauen»: keine Mitarbeiter-Bewertung. Darum zeigen
 * die Diagramme Arbeit und Abläufe — nie eine Rangliste von Personen.
 * (Regie-Diagramme — Trichter, Regie je Monat, Fristen — liegen seit 20.09. in archiv/regie-und-board/.)
 *
 * Farben: eigene Datenfarben statt der Text-Tokens (die sind zu dunkel und zu
 * grau, um als Flächen unterscheidbar zu sein). Auf Farbfehlsichtigkeit geprüft.
 */
import type { ReactNode } from 'react';

export const DATENFARBE = {
  normal: '#3f3f46',
  ueber: '#111113',
  offen: '#9a9aa3',
  bestaetigt: '#178a4c',
} as const;

/** Rahmen für ein Diagramm: Titel, Untertitel, optionaler Link. */
export function DiagrammKarte({
  titel,
  unter,
  aktion,
  children,
}: {
  titel: string;
  unter?: string;
  aktion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="lbl mb-0">{titel}</p>
        {aktion}
      </div>
      {unter && <p className="mt-1 text-xs text-ink3">{unter}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Legende — ab zwei Reihen Pflicht, damit Farbe nie allein die Bedeutung trägt. */
function Legende({ reihen, hinweis }: { reihen: { farbe: string; text: string }[]; hinweis?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3">
      {reihen.map((r) => (
        <span key={r.text} className="flex items-center gap-1.5 text-[11px] text-ink3">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: r.farbe }} />
          {r.text}
        </span>
      ))}
      {hinweis && <span className="text-[11px] text-ink3 sm:ml-auto">{hinweis}</span>}
    </div>
  );
}

/**
 * Je Tag eine Zeile: Kürzel, Spur, Zahl. Zwei Reihen, ein Wert je Reihe.
 *
 * Liegende Balken statt Säulen, weil die Zahlen klein sind gegenüber dem
 * Massstab (2 von 20 Teams). Als Säule ist das ein Strich am Boden eines hohen
 * leeren Glases; als Zeile ist es ein kurzer Balken in einer Spur — ruhig,
 * lesbar, und am Handy dasselbe Bild wie am PC.
 *
 * Die Spur ist die Obergrenze (`skala`, z. B. alle Teams) und bleibt auch an
 * leeren Tagen stehen — so ist der Massstab immer da und die Karte nie leer.
 */
function Balken({
  punkte,
  reihen,
  ariaLabel,
  wertText,
  skala,
  hinweis,
}: {
  punkte: { label: string; werte: [number, number]; hervor?: boolean; titel: string }[];
  reihen: { farbe: string; text: string }[];
  ariaLabel: string;
  /** Die Zahl am rechten Rand der Zeile. */
  wertText: (summe: number) => string;
  /** Feste Obergrenze (z. B. alle Teams), damit «2 von 20» auch optisch 2 von 20 ist. */
  skala?: number;
  /** Ein Satz zum Massstab, steht in der Legende rechts. */
  hinweis?: string;
}) {
  const summen = punkte.map((p) => p.werte[0] + p.werte[1]);
  const max = Math.max(...summen, skala ?? 0, 1);
  const leer = summen.every((s) => s === 0);

  return (
    <div>
      <ul className="space-y-1.5" role="img" aria-label={ariaLabel}>
        {punkte.map((p, i) => {
          const summe = summen[i];
          return (
            <li key={p.label} className="flex items-center gap-3" title={p.titel}>
              <span
                className={
                  'w-7 shrink-0 text-[12px] ' + (p.hervor ? 'font-semibold text-ink' : 'text-ink3')
                }
              >
                {p.label}
              </span>
              <span className="flex h-3 flex-1 gap-[2px] overflow-hidden rounded-full bg-surface-2">
                {p.werte[0] > 0 && (
                  <span
                    className="block h-full"
                    style={{ width: `${(p.werte[0] / max) * 100}%`, minWidth: 6, background: reihen[0].farbe }}
                  />
                )}
                {p.werte[1] > 0 && (
                  <span
                    className="block h-full"
                    style={{ width: `${(p.werte[1] / max) * 100}%`, minWidth: 6, background: reihen[1].farbe }}
                  />
                )}
              </span>
              <span
                className={
                  'w-[72px] shrink-0 text-right font-mono text-[12px] tabular-nums md:w-20 ' +
                  (summe > 0 ? 'text-ink2' : 'text-ink3/60')
                }
              >
                {summe > 0 ? wertText(summe) : '–'}
              </span>
            </li>
          );
        })}
      </ul>
      {leer && <p className="mt-3 text-center text-sm text-ink3">Noch nichts erfasst in diesem Zeitraum.</p>}
      <Legende reihen={reihen} hinweis={hinweis} />
    </div>
  );
}

/**
 * Woche: Teams je Tag nach Freigabestand. Beantwortet «was liegt noch bei mir»,
 * in der Einheit, in der der Bauführer denkt — Teams, nicht Stunden.
 */
export function WochenTeams({
  tage,
  hervorIndex = -1,
  gesamt = 0,
}: {
  tage: { label: string; offen: number; freigegeben: number; datum: string }[];
  hervorIndex?: number;
  /** Anzahl aller aktiven Teams — die volle Spur ist dann «20 Teams». */
  gesamt?: number;
}) {
  const teamsText = (n: number) => `${n} ${n === 1 ? 'Team' : 'Teams'}`;
  const vonAllen = (n: number) => (gesamt > 0 ? `${n} von ${gesamt} Teams` : teamsText(n));
  return (
    <Balken
      ariaLabel="Teams je Tag, aufgeteilt in freigegeben und wartet auf Freigabe"
      punkte={tage.map((t, i) => ({
        label: t.label,
        werte: [t.freigegeben, t.offen],
        hervor: i === hervorIndex,
        titel:
          `${t.label} ${t.datum} · ` +
          `${vonAllen(t.offen + t.freigegeben)} gemeldet` +
          (t.offen > 0
            ? ` · ${t.offen} warten auf dich${t.freigegeben > 0 ? ` · ${t.freigegeben} freigegeben` : ''}`
            : t.freigegeben > 0
              ? ' · alle freigegeben'
              : ''),
      }))}
      reihen={[
        { farbe: DATENFARBE.bestaetigt, text: 'freigegeben' },
        { farbe: DATENFARBE.offen, text: 'wartet auf Freigabe' },
      ]}
      wertText={(n) => (gesamt > 0 ? `${n} von ${gesamt}` : String(n))}
      skala={gesamt}
      hinweis={gesamt > 0 ? `volle Spur = alle ${gesamt} Teams` : undefined}
    />
  );
}
