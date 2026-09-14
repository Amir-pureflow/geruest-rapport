/**
 * Diagramme für die Büro-Startseiten (Bauführer, Sekretariat).
 *
 * Bewusst ohne Diagramm-Bibliothek: reines SVG/HTML aus den Design-Tokens.
 * Das hält die App klein, funktioniert offline und sieht aus wie der Rest.
 *
 * Regel aus CLAUDE.md «Nicht bauen»: keine Mitarbeiter-Bewertung. Darum zeigen
 * die Diagramme Arbeit, Geld und Abläufe — nie eine Rangliste von Personen.
 *
 * Farben: eigene Datenfarben statt der Text-Tokens (die sind zu dunkel und zu
 * grau, um als Flächen unterscheidbar zu sein). Auf Farbfehlsichtigkeit geprüft.
 */
import { useState, type ReactNode } from 'react';
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
    <section className="card flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="lbl mb-0">{titel}</p>
        {aktion}
      </div>
      {unter && <p className="mt-1 text-xs text-ink3">{unter}</p>}
      <div className="mt-3 flex-1">{children}</div>
    </section>
  );
}

/** Legende — ab zwei Reihen Pflicht, damit Farbe nie allein die Bedeutung trägt. */
function Legende({ reihen }: { reihen: { farbe: string; text: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      {reihen.map((r) => (
        <span key={r.text} className="flex items-center gap-1.5 text-xs text-ink3">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: r.farbe }} />
          {r.text}
        </span>
      ))}
    </div>
  );
}

function LeerHinweis({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-ink3">{text}</p>;
}

/** Pfad mit oben abgerundeten Ecken — das freie Ende des Balkens, nicht die Grundlinie. */
function balkenPfad(x: number, y: number, b: number, h: number, r: number): string {
  const rr = Math.min(r, h, b / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + b - rr},${y} Q${x + b},${y} ${x + b},${y + rr} L${x + b},${y + h} Z`;
}

interface Hinweis {
  x: number;
  y: number;
  inhalt: ReactNode;
}

/** Gestapelte Säulen mit Beschriftung über der Säule. Zwei Reihen, ein Wert je Reihe. */
function Saeulen({
  punkte,
  reihen,
  wertText,
  ariaLabel,
  skala,
}: {
  punkte: { label: string; werte: [number, number]; hervor?: boolean; titel: string }[];
  reihen: { farbe: string; text: string }[];
  wertText: (summe: number) => string;
  ariaLabel: string;
  /** Feste Obergrenze der Säulen (z. B. alle Teams), damit «2 von 20» auch optisch 2 von 20 ist. */
  skala?: number;
}) {
  const [hinweis, setHinweis] = useState<Hinweis | null>(null);
  const summen = punkte.map((p) => p.werte[0] + p.werte[1]);
  const max = Math.max(...summen, skala ?? 0, 1);
  if (summen.every((s) => s === 0)) return <LeerHinweis text="Noch nichts erfasst in diesem Zeitraum." />;

  const B = 360;
  const H = 168;
  const OBEN = 22;
  const UNTEN = 24;
  const hoehe = H - OBEN - UNTEN;
  const band = B / punkte.length;
  const breite = Math.min(30, band * 0.56);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${B} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {/* Grundlinie — zurückhaltend, kein Gitternetz */}
        <line x1="0" y1={OBEN + hoehe + 0.5} x2={B} y2={OBEN + hoehe + 0.5} stroke="#ececec" strokeWidth="1" />
        {punkte.map((p, i) => {
          const summe = summen[i];
          const x = i * band + (band - breite) / 2;
          const gesamtH = (summe / max) * hoehe;
          const untenH = (p.werte[0] / max) * hoehe;
          const obenH = gesamtH - untenH;
          const basis = OBEN + hoehe;
          // 2 px Luft zwischen den Segmenten, damit die Grenze sichtbar bleibt
          const luft = obenH > 0 && untenH > 0 ? 2 : 0;
          return (
            <g
              key={p.label}
              onMouseEnter={(e) => setHinweis({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, inhalt: p.titel })}
              onMouseLeave={() => setHinweis(null)}
            >
              {/* grosszügige Trefferfläche, unabhängig von der Säulenbreite */}
              <rect x={i * band} y={OBEN} width={band} height={hoehe} fill="transparent" />
              {summe > 0 && (
                <text
                  x={x + breite / 2}
                  y={basis - gesamtH - 7}
                  textAnchor="middle"
                  className="fill-ink2 font-mono text-[10px] tabular-nums"
                >
                  {wertText(summe)}
                </text>
              )}
              {/* unteres Segment: die 2 px Luft werden oben abgezogen, die Grundlinie bleibt stehen */}
              {untenH > 0 && (
                <path
                  d={balkenPfad(x, basis - untenH + luft, breite, untenH - luft, obenH > 0 ? 0 : 4)}
                  fill={reihen[0].farbe}
                />
              )}
              {obenH > 0 && <path d={balkenPfad(x, basis - gesamtH, breite, obenH, 4)} fill={reihen[1].farbe} />}
              <text
                x={x + breite / 2}
                y={H - 8}
                textAnchor="middle"
                className={'font-mono text-[10px] ' + (p.hervor ? 'fill-ink font-semibold' : 'fill-ink3')}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hinweis && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-[0_2px_10px_rgb(23_36_42/0.12)]"
          style={{ left: Math.min(hinweis.x + 10, 240), top: Math.max(hinweis.y - 34, 0) }}
        >
          {hinweis.inhalt}
        </div>
      )}
      <Legende reihen={reihen} />
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
  /** Anzahl aller aktiven Teams — die Zahl über der Säule heisst dann «3 von 20». */
  gesamt?: number;
}) {
  const teamsText = (n: number) => `${n} ${n === 1 ? 'Team' : 'Teams'}`;
  const vonAllen = (n: number) => (gesamt > 0 ? `${n} von ${gesamt} Teams` : teamsText(n));
  return (
    <Saeulen
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
    />
  );
}

/** Regie je Monat: verschickter Betrag, davon bereits bestätigt. */
export function RegieMonate({
  monate,
}: {
  monate: { label: string; offenRappen: number; bestaetigtRappen: number; hervor?: boolean }[];
}) {
  return (
    <Saeulen
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
 * `zusatzauftrag_stand` — bestellt → gemeldet → im Regierapport → beim Kunden →
 * bestätigt. Waagrechte Balken, weil die Stufennamen Platz brauchen.
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

/** Fristenliste fürs Sekretariat: was liegt wie lange beim Kunden? */
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
