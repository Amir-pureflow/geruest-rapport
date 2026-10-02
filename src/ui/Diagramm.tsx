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
 * die Diagramme Arbeit, Geld und Abläufe — nie eine Rangliste von Personen.
 *
 * Die Regie-Diagramme (Trichter, Regie je Monat, Fristen) stehen unten. Sie werden nur
 * gezeichnet, wenn die Firma den Schalter `MODUS_ERFASSUNG = regie` hat (02.10.2026) —
 * und sind seit 20.09. im gleichen Flächen-Stil wie die Wochenbalken, nicht mehr als SVG.
 *
 * Farben: eigene Datenfarben statt der Text-Tokens (die sind zu dunkel und zu
 * grau, um als Flächen unterscheidbar zu sein). Auf Farbfehlsichtigkeit geprüft.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatChf } from '../lib/tarif';

export const DATENFARBE = {
  normal: '#3f3f46',
  ueber: '#111113',
  offen: '#9a9aa3',
  bestaetigt: '#178a4c',
  /** Trichterstufen hell → dunkel: je weiter fortgeschritten, desto kräftiger. */
  stufe: ['#e4e4e7', '#c4c4cb', '#9a9aa3', '#5e5e66', '#111113'],
} as const;

/** Fr. 1'711 — ohne Rappen, für knappe Beschriftungen im Diagramm. */
export function chfKnapp(rappen: number): string {
  const franken = Math.round(rappen / 100);
  return "Fr. " + franken.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

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

/* ───────────────────────────── Regie (nur mit MODUS_ERFASSUNG = regie) ───────────────────────────── */

function LeerHinweis({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-ink3">{text}</p>;
}

/** Verschickte Regie je Monat, aufgeteilt in bestätigt und noch beim Kunden. */
export function RegieMonate({
  monate,
}: {
  monate: { label: string; offenRappen: number; bestaetigtRappen: number; hervor?: boolean }[];
}) {
  return (
    <Balken
      ariaLabel="Verschickte Regie je Monat, aufgeteilt in bestätigt und noch offen"
      punkte={monate.map((m) => ({
        label: m.label,
        werte: [m.bestaetigtRappen, m.offenRappen],
        hervor: m.hervor,
        titel: `${m.label} · ${chfKnapp(m.bestaetigtRappen + m.offenRappen)} verschickt${m.offenRappen > 0 ? ` · ${chfKnapp(m.offenRappen)} noch offen` : ''}`,
      }))}
      reihen={[
        { farbe: DATENFARBE.bestaetigt, text: 'bestätigt' },
        { farbe: DATENFARBE.offen, text: 'noch beim Kunden' },
      ]}
      wertText={(rappen) => chfKnapp(rappen).replace('Fr. ', '')}
    />
  );
}

export interface Stufe {
  key: string;
  titel: string;
  anzahl: number;
  zu: string;
}

/**
 * Trichter: wo stehen die Zusatzaufträge gerade? Die Stufen kommen aus der Sicht
 * `zusatzauftrag_stand` — bestellt → gemeldet → im Regierapport → beim Kunden → bestätigt.
 * Waagrechte Balken, weil die Stufennamen Platz brauchen.
 */
export function Trichter({ stufen, ohneMeldung }: { stufen: Stufe[]; ohneMeldung: number }) {
  const max = Math.max(...stufen.map((s) => s.anzahl), 1);
  const gesamt = stufen.reduce((s, x) => s + x.anzahl, 0);
  if (gesamt === 0) return <LeerHinweis text="Keine Zusatzaufträge in diesem Zeitraum." />;

  return (
    <div>
      <ul className="space-y-1.5">
        {stufen.map((s, i) => (
          <li key={s.key}>
            <Link to={s.zu} className="group flex items-center gap-3 rounded-[8px] px-1 py-1 transition hover:bg-ground/70">
              <span className="w-[8.5rem] shrink-0 text-[13px] text-ink2">{s.titel}</span>
              <span className="flex h-4 flex-1 items-center">
                <span
                  className="h-full rounded-[4px] transition-[width]"
                  style={{ width: `${Math.max((s.anzahl / max) * 100, s.anzahl > 0 ? 3 : 0)}%`, background: DATENFARBE.stufe[i] }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-[13px] tabular-nums text-ink">{s.anzahl}</span>
            </Link>
          </li>
        ))}
      </ul>
      {ohneMeldung > 0 && (
        <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink3">
          <strong className="font-semibold text-accent-deep">{ohneMeldung}</strong> davon: geplanter Tag vorbei, noch keine
          Meldung — nachfragen.
        </p>
      )}
    </div>
  );
}

/** Fristenliste: was liegt wie lange beim Kunden? Ältestes zuerst, das ist die Arbeitsliste. */
export function Fristen({
  eintraege,
}: {
  eintraege: { id: string; bezeichnung: string; kontoNr: string; betragRappen: number; tage: number; ueberfaellig: boolean }[];
}) {
  if (eintraege.length === 0) return <LeerHinweis text="Nichts offen beim Kunden." />;
  return (
    <ul className="divide-y divide-line">
      {eintraege.map((e) => (
        <li key={e.id}>
          <Link to={`/regie/${e.id}`} className="flex items-center justify-between gap-3 py-2 transition hover:bg-ground/70">
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-ink">{e.bezeichnung}</span>
              <span className="font-mono text-[11px] text-ink3">{e.kontoNr}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[13px] tabular-nums text-ink">{formatChf(e.betragRappen)}</span>
              <span className={'block text-[11px] ' + (e.ueberfaellig ? 'font-semibold text-accent-deep' : 'text-ink3')}>
                seit {e.tage} Tag{e.tage === 1 ? '' : 'en'}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
