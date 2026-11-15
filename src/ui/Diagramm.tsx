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
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { addTage, ausIso, iso, stunden } from '../lib/datum';
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
    <section className="card min-w-0">
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

type TagStand = 'frei' | 'offen' | 'hinweis';
const FARBE = { frei: 'var(--color-good)', hinweis: 'var(--color-amber)', offen: '#9cc0e8', leer: 'rgb(17 17 19 / 0.08)' };

/** Ring aus Anteilen (grün frei · orange Hinweis · blau offen), der Rest grau. */
function ringVerlauf(frei: number, hinweis: number, offen: number, gesamt: number): string {
  if (gesamt <= 0) return `conic-gradient(${FARBE.leer} 0 360deg)`;
  const a = (frei / gesamt) * 360;
  const b = a + (hinweis / gesamt) * 360;
  const c = b + (offen / gesamt) * 360;
  return `conic-gradient(${FARBE.frei} 0 ${a}deg, ${FARBE.hinweis} ${a}deg ${b}deg, ${FARBE.offen} ${b}deg ${c}deg, ${FARBE.leer} ${c}deg 360deg)`;
}

/**
 * Freigabe der Woche als Ring (Konzept A, Amir 15.11.2026 — vorher fünf grosse grüne Kästen):
 * grosser Ring «11/20 freigegeben», daneben der Satz, die Tage als kleine Ringe. Mit nur einem Team zählt er Tage,
 * sonst Meldungen (eine Meldung = ein Team an einem Tag). Ist bei mehreren Teams etwas offen, steht darunter je Team
 * eine Reihe Punkte — man sieht, wo es fehlt. Der Knopf öffnet die Wochenübersicht (dort «ohne Hinweis freigeben»).
 */
export function WochenTeams({
  tage,
  woche,
  teamNamen,
}: {
  tage: { label: string; offen: number; freigegeben: number; datum: string; offeneTeams?: string[]; hinweis?: number; minuten?: number; ueberMinuten?: number; teams?: { id: string; stand: TagStand }[] }[];
  /**
   * Montag der Woche (ISO). Jeder Tag öffnet die Wochenübersicht mit diesem Tag markiert (`?woche&tag`, 08.10.2026).
   * Ist an dem Tag etwas offen, nur dorthin (25.10.2026): ein offenes Team → dessen Tag aufgeklappt (`&team`),
   * mehrere → nur diese Zellen markiert (`&teams`).
   */
  woche: string;
  /** Team-ID → Name (für die Zeilen je Team) */
  teamNamen?: Map<string, string>;
}) {
  const mo = ausIso(woche);
  const ziel = (t: { offeneTeams?: string[] }, tag: string) => {
    const offen = t.offeneTeams ?? [];
    if (offen.length === 1) return `/cockpit?woche=${woche}&tag=${tag}&team=${offen[0]}`;
    if (offen.length > 1) return `/cockpit?woche=${woche}&tag=${tag}&teams=${offen.join(',')}`;
    return `/cockpit?woche=${woche}&tag=${tag}`;
  };
  const sichtbar = tage
    .map((t, i) => ({ ...t, zu: ziel(t, iso(addTage(mo, i))) }))
    .filter((t, i) => i < 5 || t.offen + t.freigegeben > 0);
  const offen = tage.reduce((s, t) => s + t.offen, 0);
  const hinweis = tage.reduce((s, t) => s + (t.hinweis ?? 0), 0);
  const frei = tage.reduce((s, t) => s + t.freigegeben, 0);
  const gesamt = offen + frei;
  const minuten = tage.reduce((s, t) => s + (t.minuten ?? 0), 0);
  const ueberMinuten = tage.reduce((s, t) => s + (t.ueberMinuten ?? 0), 0);
  if (gesamt === 0) return <LeerHinweis text="In dieser Woche hat noch kein Team gemeldet." />;

  const teamIds = [...new Set(tage.flatMap((t) => (t.teams ?? []).map((x) => x.id)))].filter((id) => id !== 'ohne-team');
  const einTeam = teamIds.length <= 1;
  const einheit = (n: number) => (einTeam ? (n === 1 ? 'Tag' : 'Tage') : n === 1 ? 'Meldung' : 'Meldungen');
  const ohneHinweis = offen - hinweis;
  // Stunden stehen rechts in der Wochenbilanz — hier nur, was zu tun ist (Amir 15.11.2026: «rechts ist es leer»)
  const unter = offen === 0
    ? 'nichts mehr zu tun'
    : hinweis > 0 ? `${hinweis} mit Überstunden — Notiz lesen` : `${ohneHinweis} ohne Hinweis — direkt freigeben`;
  const namen = (id: string) => teamNamen?.get(id) ?? 'Team';
  const teamsSortiert = [...teamIds].sort((a, b) => namen(a).localeCompare(namen(b), 'de', { numeric: true }));
  const spalten = `minmax(0,140px) repeat(${sichtbar.length}, 24px) minmax(0,1fr)`;

  return (
    <div className="@container">
      <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        {/* Grosser Ring */}
        <div className="grid h-[112px] w-[112px] shrink-0 place-items-center rounded-full" style={{ background: ringVerlauf(frei, hinweis, offen - hinweis, gesamt) }}>
          <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-white text-center">
            <div>
              <p className="font-display text-[24px] font-bold leading-none tabular-nums text-ink">{frei}/{gesamt}</p>
              <p className="mt-1 text-[10.5px] text-ink3">freigegeben</p>
            </div>
          </div>
        </div>

        <div className="w-full min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
          {offen > 0 ? (
            <p className="font-display text-[20px] font-semibold leading-tight text-ink">
              <span className="tabular-nums">{offen}</span> {einheit(offen)} {offen === 1 ? 'wartet' : 'warten'}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-display text-[20px] font-semibold leading-tight text-good-deep">
              <Check size={20} strokeWidth={3} aria-hidden="true" /> Alles freigegeben
            </p>
          )}
          <p className="mt-1 text-[13px] text-ink3">{unter}</p>
          </div>
          {offen > 0 && (
            <Link to={`/cockpit?woche=${woche}`} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-b from-[#2bb566] to-[#1a8a49] px-3.5 py-1.5 text-[13px] font-bold text-white shadow-[0_8px_18px_-8px_rgb(31_157_85/0.7)] transition hover:brightness-105">
              <Check size={14} strokeWidth={3} aria-hidden="true" /> {ohneHinweis > 0 ? `${ohneHinweis} freigeben` : 'Prüfen'} ›
            </Link>
          )}
          </div>

          {/* Tage als kleine Ringe */}
          <ul className="mt-3 flex gap-1.5 sm:gap-2.5">
            {sichtbar.map((t) => {
              const leer = t.offen + t.freigegeben === 0;
              const fertig = !leer && t.offen === 0;
              const h = t.hinweis ?? 0;
              const n = t.offen + t.freigegeben;
              const titel = `${t.label} ${t.datum} · ` + (leer ? 'keine Meldung' : fertig ? `alle ${t.freigegeben} freigegeben` : `${t.offen} offen${h > 0 ? ` (${h} mit Überstunden)` : ''}${t.freigegeben > 0 ? ` · ${t.freigegeben} freigegeben` : ''}`);
              return (
                <li key={t.label}>
                  <Link to={t.zu} title={titel} aria-label={titel} className="flex w-[40px] flex-col items-center gap-1 transition hover:-translate-y-px">
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-full" style={{ background: leer ? FARBE.leer : ringVerlauf(t.freigegeben, h, t.offen - h, n) }}>
                      <span className={'grid h-[27px] w-[27px] place-items-center rounded-full text-[10.5px] font-bold tabular-nums ' + (fertig ? 'bg-good text-white' : 'bg-white ' + (leer ? 'text-ink3/60' : h > 0 ? 'text-amber-deep' : 'text-steel'))}>
                        {leer ? '–' : fertig ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : einTeam ? (h > 0 ? '!' : '·') : `${t.freigegeben}/${n}`}
                      </span>
                    </span>
                    <span className="text-[11px] font-semibold text-ink3">{t.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Wochenbilanz rechts (ab Tablet) — füllt die Karte und zeigt die Woche in Zahlen */}
        <dl className="hidden min-w-[170px] shrink-0 grid-cols-1 gap-3 self-stretch border-l border-line pl-6 @2xl:grid">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Stunden</dt>
            <dd className="font-display text-[22px] font-bold leading-tight tabular-nums text-ink">{stunden(minuten)} h</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Überstunden</dt>
            <dd className={'font-display text-[22px] font-bold leading-tight tabular-nums ' + (ueberMinuten > 0 ? 'text-amber-deep' : 'text-ink3')}>{stunden(ueberMinuten)} h</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink3">{einTeam ? 'Tage' : 'Meldungen'}</dt>
            <dd className="font-display text-[22px] font-bold leading-tight tabular-nums text-ink">{gesamt}</dd>
          </div>
        </dl>
      </div>

      {/* Mehrere Teams und noch etwas offen: je Team eine Reihe Punkte */}
      {!einTeam && offen > 0 && (
        <div className="mt-5 min-w-0 border-t border-line pt-3">
          <div className="grid items-center gap-x-2.5 text-center text-[10.5px] font-bold uppercase tracking-wide text-ink3" style={{ gridTemplateColumns: spalten }}>
            <span />
            {sichtbar.map((t) => <span key={t.label}>{t.label}</span>)}
            <span />
          </div>
          <ul className="mt-1 divide-y divide-line">
            {teamsSortiert.map((id) => {
              const staende = sichtbar.map((t) => (t.teams ?? []).find((x) => x.id === id)?.stand ?? null);
              const nOffen = staende.filter((x) => x === 'offen').length;
              const nHinweis = staende.filter((x) => x === 'hinweis').length;
              return (
                <li key={id} className="grid items-center gap-x-2.5 py-1.5 text-[13px]" style={{ gridTemplateColumns: spalten }}>
                  <span className="truncate font-semibold text-ink">{namen(id)}</span>
                  {staende.map((x, i) => (
                    <span key={i} className={'mx-auto grid h-[22px] w-[22px] place-items-center rounded-full text-[10px] font-bold ' + (x === 'frei' ? 'bg-good text-white' : x === 'hinweis' ? 'bg-amber-soft text-amber-deep ring-1 ring-inset ring-amber/40' : x === 'offen' ? 'bg-steel-soft text-steel ring-1 ring-inset ring-steel/30' : 'bg-surface-2 text-ink3/60')}>
                      {x === 'frei' ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : x === 'hinweis' ? '!' : x === 'offen' ? '·' : '–'}
                    </span>
                  ))}
                  <span className="hidden truncate text-right text-[12px] text-ink3 sm:block">
                    {nHinweis > 0 ? `${nHinweis} Hinweis${nHinweis === 1 ? '' : 'e'}` : nOffen > 0 ? `${nOffen} offen` : 'alles frei'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
