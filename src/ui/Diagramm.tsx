/**
 * Diagramme für die Büro-Startseiten (Bauführer, Sekretariat).
 *
 * Bewusst ohne Diagramm-Bibliothek: reines SVG/HTML aus den Design-Tokens.
 * Das hält die App klein, funktioniert offline und sieht aus wie der Rest.
 *
 * Regel aus CLAUDE.md «Nicht bauen»: keine Mitarbeiter-Bewertung. Darum zeigen
 * die Diagramme Arbeit und Abläufe — nie eine Rangliste von Personen.
 * (Regie-Diagramme — Trichter, Regie je Monat, Fristen — liegen seit 20.09. in archiv/regie-und-board/.)
 *
 * Farben: eigene Datenfarben statt der Text-Tokens (die sind zu dunkel und zu
 * grau, um als Flächen unterscheidbar zu sein). Auf Farbfehlsichtigkeit geprüft.
 */
import { useState, type ReactNode } from 'react';

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

