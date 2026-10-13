import { Check, CheckCircle2, ChevronLeft, ChevronRight, Flag, Minus, Plus, Car, Truck, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Pegel, TranskriptLive } from '../ui/Sprachnotiz';
import { supabase } from '../lib/supabase';
import { enqueueMeldung, aktualisiereMeldung, belegFehlerVon, flushNachSupabase, offeneMeldungen, offeneAnzahl, warteschlangeBeobachten, type FlushErgebnis, type MeldungPayload } from '../lib/db';
import { ersetzen, ersetzenPruefen, type AlteMeldung, type Uebernahme } from '../lib/ersetzen';
import { aufteilenNachBisher, bisherNormal, restNormal, teileNachBisher, type BisherZeile } from '../lib/tagesrest';
import { fruehesterNachtrag, tagAusAdresse } from '../lib/nachtrag';
import { erfassungOffen, formularVerlassen } from '../lib/aktualisierung';
import { istDemoFirma } from '../lib/demo';
import { Warteschlange, verlaufFilter } from './StartChef';
import { addTage, iso, lang, stunden } from '../lib/datum';
import { fotoVerkleinern } from '../lib/foto';
import { kennzeichen } from '../lib/fahrzeug';
import { einstellungen, lieferwagenTagRp, normaltagMin, notizPflichtAbMin, znueni } from '../lib/einstellungen';
import { MAX_SPANNEN, MITTAG_VON_MIN, NACHMITTAG_MIN, ausUhrzeit, aufteilen, kannPauseAbziehen, mittagMinuten, pauseAbziehen, pauseZaehlen, spanneVollstaendig, spannenMinuten, spannenOffen, spannenTeilen, spannenUeberlappen, standardSpannen, umfasstPause, uhrzeit, uhrzeitFeld, zuSpalten, type Spanne } from '../lib/zeiten';
import { baustellenSuchen } from '../lib/suche';
import { FUNKTION_BUERO } from '../lib/benutzername';
import { vorratLesen, vorratSchreiben } from '../lib/vorrat';
import { ArtPille } from '../ui/ArtPille';
import { planHinweise, type VerlaufZeile } from '../lib/planung';

/**
 * Phase 2 — das Teamgerät. Ein Chefmonteur meldet für sein Team.
 *
 * Immer: Baustelle, wer war dabei, Normalstunden, Überstunden — ein Knopf. Überstunden brauchen eine
 * Sprachnotiz (warum); der Bauführer liest sie in der Wochenübersicht und gibt frei. Pflicht erst ab der Grenze der
 * Firma (Verwaltung → Einstellungen, 0045: Standard 30 Min. Überstunden einer Person, darunter freiwillig). Pflicht auch bei Regie
 * (13.10.2026, Amir: «ich will, dass man erkennt, dass man eine Sprachnotiz machen muss»): Schild «Pflicht» an der
 * Karte, Zeile im Knopf, und «Tag melden» springt zuerst zum Mikrofon — noch vor der Frage «War das Regie?».
 *
 * Firmen-Schalter `MODUS_ERFASSUNG` (Verwaltung → Einstellungen, Entscheid 02.10.2026):
 *   wochenblatt — nur das. Der Bauführer entscheidet in SORBA, ob etwas verrechnet wird (17.09./20.09.).
 *                 So arbeitet die Gerüst GmbH.
 *   regie       — zusätzlich bei Überstunden die Frage «War das Regie?» (11.10.2026): «Ja» führt in den Regie-Ablauf
 *                 «Wer wollte das?» → Stunden je Person (Überstunden vorbelegt) → Notiz; daraus entsteht beim Bauführer
 *                 ein Regierapport für den Kunden. «Nein» speichert wie im Wochenblatt. Sonst rutscht Regie als
 *                 gewöhnliche Überstunden durch.
 *                 Die drei Kacheln «War etwas anders?» (Regie ausgeführt / warten müssen / etwas kaputt) sind seit
 *                 13.10.2026 weg (Amir): Regie wird nur noch über die Überstunden gemeldet, ein Weg statt zwei.
 *
 * Feedback Bauführer 20.09.: Stunden wahlweise als Zahl oder als Zeiten von–bis (ohne Pausenrechnung),
 * Sprachnotiz immer als Bemerkung zum Tag, Personen von ausserhalb des Teams hinzufügen, nur Auto (kein öV).
 */

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; /** Chefmonteur — in seiner Sprache hört die Sprachnotiz zu, er kann sie am Mikrofon umstellen */ chefmonteur?: { id: string; sprache?: string | null } | null }
interface Person { id: string; name: string; typ: string; funktion: string; oev_standard: boolean; km_standard: number; /** heute dabei, aber nicht fest im Team */ gast?: boolean; /** in der Planung für diesen Tag hierher eingeteilt (0036) */ eingeteilt?: boolean }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null }
/** Stundenzahl (wie auf dem Wochenblatt) oder Zeiten von–bis — je Person umschaltbar. */
type ZeitModus = 'stunden' | 'zeit';
/** Wie auf dem Wochenblatt: Normalstunden (Standard 8.4 h) und Überstunden getrennt — beides Lohn, keine Fragen. Bei `modus: 'zeit'` zählen die `zeiten`. */
interface Anwesenheit { dabei: boolean; min: number; ueber: number; oev: boolean; km: number; modus: ZeitModus; zeiten: Spanne[] }

/** Die drei Schritte des Wochenblatts, dazu Wer/Notiz — die gibt es nur im Regie-Modus. */
type Schritt = 'team' | 'tag' | 'wer' | 'notiz' | 'fertig';
/** Im Wochenblatt-Modus nur für alte Meldungen (vor 17.09.); im Regie-Modus die gemeldete Abweichung. */
type Abweichung = 'zusaetzlich' | 'warten' | 'kaputt' | 'laenger';
/** Wer die Zusatzarbeit wollte — das ist die Frage, die der Monteur beantworten kann. «Ist das Regie?» kann er nicht. */
type Wer = 'kunde' | 'chef' | 'niemand';

const TEAM_KEY = 'teamgeraet-team-id';
/** Zuletzt gewählte Teams auf diesem Gerät (max. 5, neuestes vorne) — damit die Teamwahl nie mehr als 5 Kacheln braucht (Regel 3). */
const ZULETZT_KEY = 'teamgeraet-zuletzt';
/** Normaler Arbeitstag der Firma (Verwaltung → Einstellungen), Standard 8.4 h — jedes Mal frisch gelesen. */
const standardMin = (): number => normaltagMin();
/** Nur Auto (Bauführer 20.09.: «Nur auto») — öV bleibt im Datenmodell, ist in der Erfassung aber ausgeblendet, bis geklärt ist, ob es ganz weg soll. */
const OEV_AKTIV = false;
/** Zuletzt hinzugefügte Personen je Team (max. 5) — wer letzte Woche mitgeholfen hat, ist mit einem Tipp wieder da. */
const GAESTE_KEY = 'teamgeraet-gaeste-';

/**
 * Name der Abweichung als Überschrift im Regie-Ablauf. Neue Meldungen sind immer «Regie ausgeführt» — die drei Kacheln
 * «War etwas anders?» (Regie ausgeführt / warten müssen / etwas kaputt) sind seit 13.10.2026 weg (Amir: «es gibt ja
 * Tag melden — man kann ja sagen, ob es Regie war, wenn man Überstunden macht»). Die anderen Namen nur für alte Meldungen.
 */
const ABWEICHUNG_NAME: Record<Abweichung, string> = { zusaetzlich: 'Regie ausgeführt', warten: 'warten müssen', kaputt: 'etwas kaputt / repariert', laenger: 'länger gearbeitet' };

function Helm({ farbe }: { farbe: string }) {
  return (
    <svg viewBox="0 0 48 40" className="h-10 w-12" aria-hidden="true">
      <path d="M11 28a13 13 0 0 1 26 0z" fill={farbe} />
      <rect x="5" y="28" width="38" height="5" rx="2.5" fill={farbe} />
    </svg>
  );
}

function gaesteLesen(teamId: string): string[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(GAESTE_KEY + teamId) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function gaesteMerken(teamId: string, id: string): void {
  localStorage.setItem(GAESTE_KEY + teamId, JSON.stringify([id, ...gaesteLesen(teamId).filter((x) => x !== id)].slice(0, 5)));
}

function neueAnwesenheit(p: Person, modus: ZeitModus, spannen: Spanne[]): Anwesenheit {
  return { dabei: true, min: standardMin(), ueber: 0, oev: OEV_AKTIV && p.oev_standard, km: p.km_standard, modus, zeiten: spannen.map((s) => ({ ...s })) };
}

/**
 * Was für die Person zählt: bei Stundenzahl die Regler, bei von–bis die Summe der Zeiten (ohne Pausenrechnung), aufgeteilt
 * in Normal und Über. `bisher` = Normalminuten, die die Person an dem Tag schon hat (andere Meldungen, auch anderer Teams):
 * vom normalen Tag bleibt nur der Rest (13.10.2026, lib/tagesrest.ts) — sonst gab eine zweite Meldung nie Überstunden.
 */
function wirksam(a: Anwesenheit, bisher = 0): { min: number; ueber: number } {
  if (a.modus !== 'zeit') return { min: a.min, ueber: a.ueber };
  const t = aufteilenNachBisher(spannenMinuten(a.zeiten), normaltagMin(), bisher);
  return { min: t.normal_min, ueber: t.ueber_min };
}

/**
 * Überstunden zum Anzeigen und Nachfragen — erst, wenn die Zeiten fertig sind. Fehlt noch ein «bis», ist der Tag nicht
 * fertig: vorher stand auf einem schon gemeldeten Tag sofort «4.6 h über» (vorgefüllter Morgen), samt «Pflicht» für die
 * Sprachnotiz, bevor jemand etwas eingetragen hatte (Amir 13.10.2026: «obwohl ich noch nichts angeklickt habe»).
 * Speichern geht mit offenem «bis» ohnehin nicht.
 */
function ueberFertig(a: Anwesenheit | undefined, bisher = 0): number {
  if (!a) return 0;
  if (a.modus === 'zeit' && spannenOffen(a.zeiten) === 'fehlt') return 0;
  return wirksam(a, bisher).ueber;
}

/** Rote Strichlinie, die ums Mikrofon-Feld läuft, solange die Pflicht-Sprachnotiz fehlt (index.css). `r` = Eckenradius des Felds. */
function LaufStrich({ r }: { r: number }) {
  return (
    <svg className="notiz-strich" aria-hidden="true">
      <rect width="100%" height="100%" rx={r - 1} />
    </svg>
  );
}

/** Objekt-URL für eine Aufnahme — einmal je Blob, beim Wechsel und am Ende wieder freigegeben (vorher bei jedem Neuzeichnen neu). */
function useObjektUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function zuletztLesen(): string[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function zuletztMerken(id: string): string[] {
  const liste = [id, ...zuletztLesen().filter((x) => x !== id)].slice(0, 5);
  localStorage.setItem(ZULETZT_KEY, JSON.stringify(liste));
  return liste;
}
function teamsSortiert<T extends { bezeichnung: string }>(liste: T[]): T[] {
  return [...liste].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
}

/** Was für den gewählten Tag schon gemeldet ist — lokal (wartet auf Netz) oder auf dem Server. */
interface Gemeldet {
  bezeichnung: string; konto_nr: string; baustelle_id: string; normalfall: boolean; abweichung_typ: Abweichung | null;
  lokal: boolean; schluessel: string; freigegeben: boolean; min: number;
  /** Anzahl Personen — «8.0 h je 4 Pers.» statt einer erschreckenden Teamsumme */
  personen: number;
  /** Normalminuten je Person — damit eine weitere Meldung am selben Tag richtig in Normal und Über teilt */
  zeilen: { mitarbeiter_id: string; normal_min: number }[];
  /** Kommt nicht von allein durch (lokal) — Grund steht in der Warteschlange oben */
  haengt?: boolean;
}
type SpeicherModus = 'normal' | 'ersetzen' | 'zusaetzlich';
const AB_KURZ: Record<Abweichung, string> = { zusaetzlich: 'Regie', warten: 'gewartet', kaputt: 'repariert', laenger: 'länger' };

function Stepper({ wert, setWert, schritt, min, max, format }: { wert: number; setWert: (v: number) => void; schritt: number; min: number; max?: number; format: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_1px_2px_rgb(17_17_19/0.04)]">
      <button type="button" onClick={() => setWert(Math.max(min, wert - schritt))} aria-label="weniger" className="grid h-12 w-11 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink active:scale-95"><Minus size={22} strokeWidth={2.2} /></button>
      <span className="whitespace-nowrap font-mono text-xl font-semibold tabular-nums">{format(wert)}</span>
      <button type="button" onClick={() => setWert(max !== undefined ? Math.min(max, wert + schritt) : wert + schritt)} disabled={max !== undefined && wert >= max} aria-label="mehr" className="grid h-12 w-11 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink active:scale-95 disabled:opacity-40"><Plus size={22} strokeWidth={2.2} /></button>
    </div>
  );
}

// Die Stundenzahl-Eingabe (Wochenblatt-Stil) ist raus (04.10.2026, Amir): erfasst wird nur noch von–bis.

/** Hinweis, wenn der unbezahlte Mittag 12–13 in den Zeiten mitgezählt ist — die App zieht nichts ab, sie sagt es nur. */
function MittagHinweis({ spannen }: { spannen: Spanne[] }) {
  const min = mittagMinuten(spannen);
  if (min === 0) return null;
  return (
    <p className="mt-1.5 rounded-[8px] bg-amber-soft px-2.5 py-1.5 text-[11px] text-amber-deep">
      {min === 60 ? 'Der Mittag 12–13 ist mitgezählt' : `${min} Min. vom Mittag (12–13) sind mitgezählt`} — er ist unbezahlt. Durchgearbeitet? Dann stimmt es so. Sonst Vormittag bis 12:00 und Nachmittag ab 13:00 eintragen.
    </p>
  );
}

/**
 * Uhrzeit-Feld: tippen öffnet weiterhin die native Uhrzeit-Wahl (Regel 2, keine Tastatur),
 * aber die Anzeige malt die App selbst — native Felder zeigen je nach Handysprache
 * «7:00 AM», im schmalen Feld abgeschnitten als «Al»/«Pl» (Amir, 04.10.2026).
 */
function ZeitFeld({ wert, aendern, label, klasse }: { wert: string; aendern: (text: string) => void; label: string; klasse: string }) {
  // Eigenes Feld statt <input type="time">: immer 24 h, nie AM/PM — auch beim Tippen
  // (Entscheid Amir, 05.10.2026; native Felder richten sich nach der Gerätesprache).
  // Ziffern reichen: «730» wird 07:30, «17» wird 17:00, leer löscht die Zeit.
  const [tippt, setTippt] = useState(false);
  const [text, setText] = useState(wert);
  useEffect(() => { if (!tippt) setText(wert); }, [wert, tippt]);
  const formatieren = (roh: string) => {
    const z = roh.replace(/\D/g, '').slice(0, 4);
    return z.length <= 2 ? z : z.slice(0, 2) + ':' + z.slice(2);
  };
  const abschliessen = () => {
    setTippt(false);
    const z = text.replace(/\D/g, '');
    if (z.length === 0) { setText(''); aendern(''); return; }
    const h = Math.min(23, Number(z.length === 3 ? z[0] : z.slice(0, 2)));
    const m = Math.min(59, z.length <= 2 ? 0 : Number(z.length === 3 ? z.slice(1) : z.slice(2)));
    const fertig = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setText(fertig);
    aendern(fertig);
  };
  return (
    <input
      type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done"
      value={tippt ? text : wert}
      placeholder="--:--"
      onFocus={(e) => { setTippt(true); setText(wert); e.target.select(); }}
      onChange={(e) => setText(formatieren(e.target.value))}
      onBlur={abschliessen}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label={label}
      className={klasse + ' placeholder:font-sans placeholder:text-ink3'}
    />
  );
}

/** Beschriftung einer Zeile: ab 12:00 «Nachmittag», die erste sonst «Vormittag», eine weitere vor 12:00 «nach Pause» (Znüni-Abzug). */
function spannenName(s: Spanne, i: number): string {
  return s.von >= MITTAG_VON_MIN ? 'Nachmittag' : i === 0 ? 'Vormittag' : 'nach Pause';
}

/**
 * Zeiten von–bis: Vormittag und Nachmittag, nach einem Znüni-Abzug dazwischen «nach Pause». Native Uhrzeit-Wahl statt Tastatur (Regel 2).
 * Kein stiller Pausenabzug — die App zählt, was dasteht; der Mittag 12–13 (unbezahlt) ist als Lücke vorgegeben.
 * Zahlt der Bauherr den Znüni nicht, schneidet «− Pause» 9:00–9:30 heraus (09.10.2026, Amir); das × der Zeile «nach Pause» nimmt es zurück.
 * Zieht die Firma den Znüni immer ab (0036, Gerüst GmbH 9:00–9:15), steht der Vormittag schon geteilt da — ohne Knopf und ohne ×.
 */
function SpannenEditor({ spannen, setSpannen, klein = false }: { spannen: Spanne[]; setSpannen: (s: Spanne[]) => void; klein?: boolean }) {
  const z = znueni();
  const znueniText = `${uhrzeit(z.von)}–${uhrzeit(z.bis)}`;
  // Auf dem Handy etwas schmaler: mit «Nachmittag» und dem Knopf «− Pause» muss die Zeile in die Karte passen (360–390 px)
  const feld = 'rounded-[10px] border bg-surface text-center font-mono font-semibold tabular-nums focus:border-accent focus:outline-none ' + (klein ? 'h-10 w-[5rem] text-[14px] min-[380px]:w-[5.4rem]' : 'h-12 w-[5rem] text-lg min-[380px]:w-[5.6rem] sm:w-28');
  const aendern = (i: number, teil: 'von' | 'bis', text: string) => {
    const v = ausUhrzeit(text);
    setSpannen(spannen.map((s, j): Spanne => (j !== i ? s : teil === 'von' ? { ...s, von: v ?? s.von } : { ...s, bis: v })));
  };
  // Raster statt fester Breite: Die Beschriftung bekommt genau so viel Platz, wie «Nachmittag» braucht — vorher (w-9)
  // lag das Zeitfeld über dem Wort (Amir, 09.10.2026: «sieht nicht clean aus»). Die Felder stehen trotzdem bündig untereinander.
  const mitLabel = spannen.length > 1;
  // Der Pausen-Knopf steht in der Zelle, in der spätere Zeilen ihr × haben — gleich breit, damit das Raster nicht wächst
  const pauseMoeglich = !z.immer && kannPauseAbziehen(spannen, z);
  // «+ Nachmittag» wie bisher bis zwei Zeilen — eine Zeile «nach Pause» zählt nicht mit, für sie gibt es die dritte
  const nachmittagMoeglich = spannen.length < MAX_SPANNEN && spannen.filter((s, i) => spannenName(s, i) !== 'nach Pause').length < 2;
  return (
    <div className="space-y-1.5">
      <div className={'grid items-center justify-start gap-x-1.5 gap-y-1.5 ' + (mitLabel ? 'grid-cols-[auto_auto_auto_auto_auto]' : 'grid-cols-[auto_auto_auto_auto]')}>
        {spannen.map((s, i) => {
          // genau der Schnitt von «− Pause»: × fügt die beiden Zeilen wieder zusammen, statt die Zeit zu löschen
          const nachPause = i > 0 && spannen[i - 1].bis === z.von && s.von === z.bis;
          return (
            <div key={i} className="contents">
              {mitLabel && <span className="whitespace-nowrap pr-1 text-[11px] font-medium leading-none text-ink3">{spannenName(s, i)}</span>}
              <ZeitFeld wert={uhrzeitFeld(s.von)} aendern={(t) => aendern(i, 'von', t)} label="von" klasse={feld + ' border-line'} />
              <span className="text-ink3">–</span>
              <ZeitFeld wert={uhrzeitFeld(s.bis)} aendern={(t) => aendern(i, 'bis', t)} label="bis" klasse={feld + (s.bis === null ? ' border-amber/70' : ' border-line')} />
              {i > 0 ? (
                nachPause
                  ? (z.immer
                    ? <span aria-hidden="true" />
                    : <button type="button" onClick={() => setSpannen(pauseZaehlen(spannen, z))} aria-label={`Pause ${znueniText} wieder zählen`} title={`Pause ${znueniText} wieder zählen`} className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>)
                  : <button type="button" onClick={() => setSpannen(spannen.filter((_, j) => j !== i))} aria-label="Zeit entfernen" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>
              ) : pauseMoeglich && umfasstPause(s, z) ? (
                <button
                  type="button"
                  onClick={() => setSpannen(pauseAbziehen(spannen, z))}
                  aria-label={`Pause ${znueniText} abziehen`}
                  title={`Pause ${znueniText} abziehen`}
                  className="chip flex h-10 w-9 shrink-0 flex-col items-center justify-center gap-0.5 p-0 font-semibold leading-none text-steel"
                >
                  <span className="text-[14px]" aria-hidden="true">−</span>
                  <span className="text-[9.5px] tracking-tight">Pause</span>
                </button>
              ) : <span aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {nachmittagMoeglich && (
        <button type="button" onClick={() => setSpannen([...spannen, { von: Math.max(NACHMITTAG_MIN, spannen[spannen.length - 1]?.bis ?? 0), bis: null }])} className="text-xs font-semibold text-steel">
          + Nachmittag
        </button>
      )}
    </div>
  );
}

/** Kleiner −/+ Knopf in Zeilen: 40 px Tippfläche, damit man mit Handschuhen trifft. */
/**
 * Kamera-Knopf und Vorschau der angehängten Bilder.
 *
 * Steht bewusst ausserhalb von `Erfassung`: als verschachtelte Funktion war es bei jedem
 * Tastendruck eine neue Komponente, React baute das `<input type="file">` jedes Mal neu auf —
 * und auf dem iPhone kam die gewählte Datei dann nie an (Fehler vom 03.10.2026).
 *
 * Ohne `capture`: so lässt iOS die Wahl zwischen Kamera und Fotomediathek. Mit `capture` öffnet
 * sich sofort die Kamera, und ein vorhandenes Bild liess sich gar nicht hochladen.
 */
function FotoLeiste({
  text, fotos, laedt, hinzufuegen, entfernen,
}: {
  text: string;
  fotos: { id: string; url: string }[];
  laedt: boolean;
  hinzufuegen: (l: FileList | null) => void;
  entfernen: (id: string) => void;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {fotos.map((f) => (
          <span key={f.id} className="relative h-16 w-16 overflow-hidden rounded-[8px] border border-line">
            <img src={f.url} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => entfernen(f.id)} aria-label="Foto entfernen" className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-ink/80 text-[11px] font-semibold leading-5 text-white">×</button>
          </span>
        ))}
        <label className={'flex h-16 min-w-16 cursor-pointer items-center justify-center gap-2 rounded-[8px] border-2 border-dashed px-3 text-sm font-semibold ' + (fotos.length === 0 ? 'border-steel bg-steel-soft text-steel' : 'border-line-strong text-ink2')}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          {laedt ? '…' : fotos.length === 0 ? 'Foto' : '+'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { hinzufuegen(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-ink3">{text}</p>
    </div>
  );
}

/**
 * Stand der Sprachnotiz-Vorschau:
 *   laeuft     — die Erkennung hört zu
 *   pruefen    — Text in der SPRACHE DES SPRECHERS, er prüft und bestätigt ihn (04.10.2026):
 *                Deutsch kann er nicht beurteilen, sein Albanisch/Polnisch/… schon
 *   uebersetze — der bestätigte Text wird ins Deutsche übertragen
 *   fertig     — deutscher Text, korrigierbar; das bestätigte Original bleibt daneben
 */
type Vorschau = { status: 'laeuft' | 'pruefen' | 'uebersetze' | 'fertig' | 'fehler'; text: string; quelle: string | null; sprache: string; grund?: string; bestaetigt?: boolean };

/** SORBA-Namen kommen teils mit Unterstrichen («Aarstrasse_Hängegerüst») — fürs Auge mit Leerzeichen. */
const anzeigeName = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ');

/** Frage und Bestätigungsknopf in der Sprache des Sprechers, dazu der deutsche Name der Sprache. */
const PRUEF_TEXTE: Record<string, { frage: string; knopf: string; name: string }> = {
  de: { frage: 'Stimmt das so? Sonst hier korrigieren.', knopf: 'Stimmt so ✓', name: 'Deutsch' },
  sq: { frage: 'A është shkruar saktë? Përndryshe korrigjoje këtu.', knopf: 'Po, në rregull ✓', name: 'Albanisch' },
  pt: { frage: 'Está correto? Se não, corrija aqui.', knopf: 'Está certo ✓', name: 'Portugiesisch' },
  it: { frage: 'È scritto correttamente? Altrimenti correggilo qui.', knopf: 'Va bene ✓', name: 'Italienisch' },
  fr: { frage: 'Est-ce correct? Sinon, corrigez ici.', knopf: 'C’est juste ✓', name: 'Französisch' },
  es: { frage: '¿Está bien escrito? Si no, corrígelo aquí.', knopf: 'Sí, está bien ✓', name: 'Spanisch' },
  ar:{ frage: 'هل النص صحيح؟ إن لم يكن، صحِّحه هنا.', knopf: 'صحيح ✓', name: 'Arabisch' },
  pl: { frage: 'Czy tekst się zgadza? Jeśli nie, popraw go tutaj.', knopf: 'Zgadza się ✓', name: 'Polnisch' },
  en: { frage: 'Is this correct? If not, fix it here.', knopf: 'Looks right ✓', name: 'Englisch' },
};

/**
 * Sprache der Sprachnotiz direkt am Mikrofon umstellen (Entscheid Amir, 05.10.2026).
 * Die Wahl wird im Profil des Chefmonteurs gespeichert — so hört auch der Server
 * (Offline-Nachweg) richtig, und die Verwaltung zeigt denselben Stand.
 */
function SprachWahl({ sprache, setzen }: { sprache: string; setzen: (code: string) => void }) {
  const [offen, setOffen] = useState(false);
  if (!offen) {
    return (
      <button type="button" onClick={() => setOffen(true)} className="mt-2 text-xs font-semibold text-steel">
        Sprache ändern — {(PRUEF_TEXTE[sprache] ?? PRUEF_TEXTE.de).name} ▾
      </button>
    );
  }
  return (
    <span className="mt-2 flex flex-wrap justify-center gap-1.5">
      {Object.entries(PRUEF_TEXTE).map(([code, t]) => (
        <button key={code} type="button" onClick={() => { setzen(code); setOffen(false); }} className={'chip px-2.5 py-1.5 text-xs ' + (code === sprache ? 'chip-on' : '')}>
          {t.name}
        </button>
      ))}
    </span>
  );
}

/**
 * Vorschau und Prüfung der Sprachnotiz — ein Element für den Tag-Schritt und die Abweichung.
 *
 * Der Weg (Entscheid Amir, 04.10.2026): erst sieht der Sprecher den Text in seiner eigenen
 * Sprache und bestätigt ihn. Dann überträgt die App den BESTÄTIGTEN Text ins Deutsche für den
 * Bauführer — nicht das, was die Erkennung zufällig verstanden hat. `dir="auto"` wegen Arabisch.
 */
function TranskriptPruefung({
  vorschau, aendern, bestaetigen,
}: {
  vorschau: Vorschau | null;
  aendern: (text: string) => void;
  bestaetigen: () => void;
}) {
  if (!vorschau) return null;
  if (vorschau.status === 'laeuft' || vorschau.status === 'uebersetze') {
    return (
      <div className="space-y-1.5 rounded-[10px] bg-surface p-3 text-left" aria-live="polite">
        <p className="text-xs font-medium text-ink2">{vorschau.status === 'laeuft' ? 'Die App schreibt mit …' : 'Wird für den Bauführer ins Deutsche übertragen …'}</p>
        <div className="ki-schimmer h-3 w-11/12 rounded" /><div className="ki-schimmer h-3 w-3/4 rounded" />
      </div>
    );
  }
  if (vorschau.status === 'fehler') return <p className="text-xs text-ink3">{vorschau.grund}</p>;
  if (vorschau.status === 'pruefen') {
    const t = PRUEF_TEXTE[vorschau.sprache] ?? PRUEF_TEXTE.de;
    return (
      <div className="space-y-2 rounded-[12px] bg-surface p-3 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink3">{t.name}</p>
        <p className="text-sm font-semibold text-ink" dir="auto">{t.frage}</p>
        <textarea value={vorschau.text} onChange={(e) => aendern(e.target.value)} rows={3} dir="auto" className="field text-base" />
        {vorschau.grund && <p className="text-xs font-semibold text-amber-deep">{vorschau.grund}</p>}
        <button type="button" onClick={bestaetigen} className="cta cta-good py-2.5 text-[15px]" dir="auto">{t.knopf}</button>
        <p className="text-[11px] text-ink3">Nach der Bestätigung übersetzt die App den Text für den Bauführer auf Deutsch. Die Aufnahme bleibt als Beleg.</p>
      </div>
    );
  }
  // fertig: Übersetzungskarte — oben das Original mit Sprachlabel, darunter das Deutsche, korrigierbar.
  // Bei Deutsch gibt es keine Übersetzung, dann steht nur der bereinigte Text.
  const vonSprache = vorschau.quelle && vorschau.sprache !== 'de' ? (PRUEF_TEXTE[vorschau.sprache]?.name ?? 'Eigene Sprache') : null;
  return (
    <div className="space-y-2 rounded-[12px] bg-surface p-3 text-left">
      {vonSprache ? (
        <>
          <div className="rounded-[10px] bg-ground px-3 py-2.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink3">
              {vonSprache}
              {vorschau.bestaetigt && <span className="ml-1.5 normal-case tracking-normal text-good-deep">bestätigt ✓</span>}
            </p>
            <p className="text-sm leading-snug text-ink2" dir="auto">{vorschau.quelle}</p>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink3"><span aria-hidden="true">↓ </span>Deutsch · liest der Bauführer</p>
        </>
      ) : (
        <p className="text-xs font-medium text-ink2">So liest es der Bauführer — hier korrigierbar.</p>
      )}
      <textarea value={vorschau.text} onChange={(e) => aendern(e.target.value)} rows={3} className="field text-sm" />
      {vonSprache && <p className="text-[11px] text-ink3">Hier korrigierbar — gespeichert wird der deutsche Text, die Aufnahme bleibt als Beleg.</p>}
    </div>
  );
}

function MiniKnopf({ art, onClick, klein = false }: { art: 'minus' | 'plus'; onClick: () => void; klein?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={art === 'minus' ? 'weniger' : 'mehr'} className={'grid h-10 place-items-center rounded-[10px] border border-line bg-surface text-ink2 active:scale-95 active:bg-surface-2 ' + (klein ? 'w-9' : 'w-10')}>
      {art === 'minus' ? <Minus size={18} strokeWidth={2.2} /> : <Plus size={18} strokeWidth={2.2} />}
    </button>
  );
}

export function Erfassung() {
  // Firmen-Schalter: mit oder ohne Abweichungs-Ablauf. Einmal gelesen, danach aus dem Zwischenspeicher — die Erfassung läuft offline.
  const modus = einstellungen().erfassung;
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [leute, setLeute] = useState<Person[]>([]);
  /** Subunternehmer hatten heute den Lieferwagen der Firma (0036, Arbnor 10.10.2026: Fr. 100 pro Tag). */
  const [lieferwagen, setLieferwagen] = useState(false);
  const [kacheln, setKacheln] = useState<Baustelle[]>([]);
  const [alleGeplanten, setAlleGeplanten] = useState<Baustelle[]>([]);
  // /erfassung?baustelle=wahl öffnet direkt «andere Baustelle …» (Sprung von der Chefmonteur-Startseite)
  const [zeigeAndere, setZeigeAndere] = useState(() => new URLSearchParams(window.location.search).get('baustelle') === 'wahl');
  // Baustellensuche: Konto-Nr. über den Ziffernblock (Regel 2, Handschuhe) oder Name über die Tastatur
  const [ziffern, setZiffern] = useState('');
  const [suchTreffer, setSuchTreffer] = useState<Baustelle[]>([]);
  // Alle aktiven Baustellen zum Durchblättern — ersetzt den Papierzettel, wenn Nummer UND Name entfallen sind
  const [alleBaustellen, setAlleBaustellen] = useState<Baustelle[] | null>(null);
  const [zeigeListe, setZeigeListe] = useState(false);
  const [laedtTeam, setLaedtTeam] = useState(false);
  const [zuletzt, setZuletzt] = useState<string[]>(zuletztLesen);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(null);
  /** Heute laut Planung — diese Baustelle steht zuerst; «neu geplant», wenn sie in den letzten Tagen umgeplant wurde */
  const [geplantHeute, setGeplantHeute] = useState<{ ids: string[]; neu: boolean }>({ ids: [], neu: false });
  /**
   * Zweite Baustelle am selben Tag (Arbnor 10.10.2026: «mehrere Baustellen bequemer, auf einmal»): ab der Wechselzeit
   * zählt die Zeit auf die zweite. Gespeichert in einem Durchgang als zwei Meldungen, Überstunden über den ganzen Tag.
   */
  const [zweite, setZweite] = useState<Baustelle | null>(null);
  const [wechsel, setWechsel] = useState<number>(NACHMITTAG_MIN);
  const [wahlZweite, setWahlZweite] = useState(false);
  const [anw, setAnw] = useState<Record<string, Anwesenheit>>({});
  const [anreiseOffen, setAnreiseOffen] = useState<string | null>(null);
  // Zeiten von–bis, fürs Team gemeinsam — je Person unten anpassbar (Stundenzahl-Modus entfernt 04.10.2026)
  const [teamSpannen, setTeamSpannen] = useState<Spanne[]>(standardSpannen(znueni()));
  // Personen, die heute mithelfen, aber nicht fest zum Team gehören (Bauführer 20.09.: «Mitarbeiter hinzufüge»)
  const [gaeste, setGaeste] = useState<Person[]>([]);
  const [zeigeGast, setZeigeGast] = useState(false);
  const [gastFilter, setGastFilter] = useState('');
  const [alleLeute, setAlleLeute] = useState<Person[] | null>(null);
  const [zuletztGaeste, setZuletztGaeste] = useState<Person[]>([]);
  // Über die Startseite (/erfassung?wahl) immer zuerst das Team zeigen — zum Testen mehrerer Teams im selben Browser.
  // Das Teamgerät selbst öffnet /erfassung ohne Parameter und landet direkt beim Tag.
  const [schritt, setSchritt] = useState<Schritt>(teamId && !new URLSearchParams(window.location.search).has('wahl') ? 'tag' : 'team');

  // ── Abweichung (nur Regie-Modus) ──
  const [abweichung, setAbweichung] = useState<Abweichung | null>(null);
  const [wer, setWer] = useState<Wer | null>(null);
  /** Stunden der Zusatzarbeit — für alle gleich, je Person überschreibbar */
  const [abMin, setAbMin] = useState(60);
  const [abMinPerson, setAbMinPerson] = useState<Record<string, number>>({});
  const abMinVon = (id: string) => abMinPerson[id] ?? abMin;
  const [abLeute, setAbLeute] = useState<Set<string>>(new Set());
  /** «Überstunden — war das Regie?» steht offen (nur Regie-Modus, beim Tippen auf «Tag melden») */
  const [regieFrage, setRegieFrage] = useState(false);
  const regieFrageRef = useRef<HTMLElement | null>(null);
  /**
   * Die Antwort auf «war das Regie?» — einmal gegeben, gilt sie (Amir 11.10.2026: vorher kam die Frage nach dem
   * Sprechen ein zweites Mal). Gefragt wird direkt bei den Überstunden, neben dem Mikrofon, oder beim Melden.
   */
  const [regieAntwort, setRegieAntwort] = useState<'ja' | 'nein' | null>(null);
  /** Überstunden ohne Sprachnotiz gemeldet: die Notiz-Karte wird markiert und angesprungen */
  const [notizFehlt, setNotizFehlt] = useState(false);
  /** Zählt jedes «fehlt noch» hoch — das Mikrofon-Feld stupst dann jedes Mal neu an */
  const [stupser, setStupser] = useState(0);
  const notizRef = useRef<HTMLElement | null>(null);
  // Überstunden: Sprachnotiz als Warum (Pflicht, ausser das Mikrofon fehlt) — hängt an der Tagesmeldung
  const [mikroFehlt, setMikroFehlt] = useState(false);
  const [ueberAufnahme, setUeberAufnahme] = useState<{ blob: Blob; sekunden: number } | null>(null);
  const aufnahmeUrl = useObjektUrl(ueberAufnahme?.blob);
  // Text der Sprachnotiz — entsteht sofort nach der Aufnahme; der Sprecher prüft ihn VOR dem Speichern
  const [ueberVorschau, setUeberVorschau] = useState<Vorschau | null>(null);
  async function textVorschau(blob: Blob) {
    const setV = setUeberVorschau;
    if (!supabase || !navigator.onLine) { setV({ status: 'fehler', text: '', quelle: null, sprache: 'de', grund: 'Kein Netz — der Text kommt, sobald die Meldung gesendet ist.' }); return; }
    setV({ status: 'laeuft', text: '', quelle: null, sprache: 'de' });
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      const { data, error } = await supabase.functions.invoke('transkribieren', { body: { audio_base64: b64, mime: blob.type || 'audio/webm', team_id: teamId, baustelle_id: baustelle?.id ?? null, schritt: 'erkennen' } });
      if (error || data?.fehler) throw new Error(data?.fehler ?? error?.message ?? 'kein Text');
      if (data?.transkript) {
        // Deutsch gesprochen: der bereinigte Text kommt direkt, kein Prüfschritt nötig
        setV({ status: 'fertig', text: data.transkript, quelle: data.quelle ?? null, sprache: data.sprache ?? 'de', bestaetigt: false });
      } else if (data?.original) {
        // Andere Sprache: der Sprecher prüft zuerst sein Original — Deutsch entsteht nach der Bestätigung
        setV({ status: 'pruefen', text: data.original, quelle: null, sprache: data.sprache ?? 'de' });
      } else {
        throw new Error('kein Text');
      }
    } catch (e) {
      setV({ status: 'fehler', text: '', quelle: null, sprache: 'de', grund: 'Text konnte jetzt nicht erstellt werden — er kommt nach dem Senden. ' + (e instanceof Error ? e.message : '') });
    }
  }

  /** Der Sprecher hat sein Original gutgeheissen — jetzt entsteht daraus das Deutsche für den Bauführer. */
  async function originalBestaetigen() {
    const v = ueberVorschau;
    if (!v || v.status !== 'pruefen' || !supabase) return;
    const original = v.text.trim();
    if (!original) return;
    setUeberVorschau({ ...v, status: 'uebersetze', text: original, grund: undefined });
    try {
      const { data, error } = await supabase.functions.invoke('transkribieren', { body: { schritt: 'uebersetzen', text: original, sprache: v.sprache, team_id: teamId, baustelle_id: baustelle?.id ?? null } });
      if (error || data?.fehler || !data?.transkript) throw new Error(data?.fehler ?? error?.message ?? 'keine Übersetzung');
      setUeberVorschau({ status: 'fertig', text: data.transkript, quelle: original, sprache: v.sprache, bestaetigt: true });
    } catch (e) {
      // Zurück zum Prüfschritt. Speichern geht trotzdem: dann überträgt der Server nach dem Upload
      // aus der Aufnahme — die Korrekturen von hier gehen dabei allerdings verloren.
      setUeberVorschau({ ...v, status: 'pruefen', text: original, grund: 'Übersetzung gerade nicht möglich, nochmals antippen. ' + (e instanceof Error ? e.message : '') });
    }
  }
  // Fotos zur Meldung — der Bauführer will Bilder bei Zusatzarbeit; hier ohne Umweg über die Galerie
  const [fotos, setFotos] = useState<{ id: string; blob: Blob; url: string }[]>([]);
  const [fotoLaedt, setFotoLaedt] = useState(false);

  async function fotosHinzufuegen(liste: FileList | null) {
    if (!liste || liste.length === 0) return;
    setFotoLaedt(true);
    const neue: { id: string; blob: Blob; url: string }[] = [];
    for (const datei of Array.from(liste).slice(0, 6)) {
      try {
        const blob = await fotoVerkleinern(datei);
        neue.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      } catch {
        setHinweis('Ein Bild konnte nicht gelesen werden.');
      }
    }
    setFotos((f) => [...f, ...neue].slice(0, 8));
    setFotoLaedt(false);
  }
  function fotoEntfernen(id: string) {
    setFotos((f) => { const x = f.find((y) => y.id === id); if (x) URL.revokeObjectURL(x.url); return f.filter((y) => y.id !== id); });
  }

  /** Was die Bildleiste braucht — die Komponente steht oben, ausserhalb dieser Funktion. */
  const fotoLeiste = (text: string) => (
    <FotoLeiste text={text} fotos={fotos} laedt={fotoLaedt} hinzufuegen={(l) => void fotosHinzufuegen(l)} entfernen={fotoEntfernen} />
  );
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [sekunden, setSekunden] = useState(0);
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  // Sperre gegen Doppeltippen: das Beenden der Aufnahme dauert eine Sekunde, ein zweiter Tipp darf nichts auslösen
  const [speichert, setSpeichert] = useState(false);
  const speichertRef = useRef(false);
  /**
   * Die Abweichung, die gerade in der Warteschlange liegt (Fehler vom 03.10.2026).
   *
   * Ging das Senden schief, legte jeder weitere Druck auf «Tag melden» eine neue Meldung an —
   * am Ende standen fünf gleiche Tage mit 95 Stunden beim Bauführer. Für den normalen Tag fragt seither der Dialog
   * «schon gemeldet — ersetzen oder zusätzlich?» (er prüft jedes Mal frisch, was für den Tag schon da ist). Die
   * Abweichung hat keinen solchen Dialog: dort merkt sich das Gerät den Entwurf und versucht ihn nochmals.
   * Seit 13.10.2026 nur noch, solange er nie gesendet wurde — «Zusätzlich» legt immer eine neue Meldung an.
   */
  const entwurfAbRef = useRef<string | null>(null);

  /** Namen der Leute — die Warteschlange zeigt sie, wenn eine Zeile nicht durchkommt. */
  const namenVon = (payload: MeldungPayload): Record<string, string> =>
    Object.fromEntries(payload.eintraege.map((z) => [z.mitarbeiter_id, alleImTeam.find((p) => p.id === z.mitarbeiter_id)?.name ?? '']).filter(([, n]) => n));

  /** In die Warteschlange legen — mit `merker` den wartenden Entwurf nochmals versuchen, solange er nie unterwegs war. */
  async function inWarteschlange(
    merker: React.MutableRefObject<string | null> | null,
    payload: MeldungPayload,
    audio?: Blob,
    bilder: Blob[] = [],
  ): Promise<string> {
    const offen = merker?.current ?? null;
    let uuid: string | null = null;
    if (offen) {
      const r = await aktualisiereMeldung(offen, payload, audio, bilder);
      if (r.art === 'aktualisiert') uuid = r.uuid;
      if (r.art === 'unterwegs') {
        // Die erste Fassung ist schon unterwegs: keine zweite anlegen (sonst doppelte Stunden), ehrlich sagen
        setHinweis('Diese Meldung ist schon unterwegs zum Server und wurde nicht nochmals angelegt. Änderungen macht der Bauführer in der Wochenübersicht.');
        return offen;
      }
    }
    if (!uuid) uuid = await enqueueMeldung(payload, audio, bilder, namenVon(payload));
    if (merker) merker.current = uuid;
    // Beleg konnte nicht abgelegt werden? Sagen, aber die Stunden gehen trotzdem raus.
    const belegFehler = await belegFehlerVon(uuid);
    if (belegFehler) setHinweis(belegFehler);
    return uuid;
  }
  // Längere Rückmeldung nach dem Speichern (z. B. «normaler Tag 8.0 h + 1.0 h zusätzlich») — eigene Zeile, nicht im Knopf
  const [bestaetigung, setBestaetigung] = useState<string | null>(null);
  // Abschluss-Seite nach dem Speichern: was steht jetzt für den Tag, und wohin jetzt?
  const [fertig, setFertig] = useState<{ text: string; stand: 'gesendet' | 'wartet' | 'fehler'; notizUuid?: string } | null>(null);
  const [hinweis, setHinweis] = useState('');
  const [heuteGemeldet, setHeuteGemeldet] = useState<Gemeldet[]>([]);
  // An diesem Tag schon eine Normalmeldung (egal welche Baustelle) → erst nachfragen, statt still eine zweite anzulegen.
  // `gruende`: warum «ersetzen» nicht geht (13.10.2026, lib/ersetzen.ts) — null, solange die Prüfung läuft; leer = es geht.
  const [doppelt, setDoppelt] = useState<{ baustellen: string[]; bisherMin: number; neuMin: number; alte: AlteMeldung[]; gruende: string[] | null } | null>(null);
  /** Konnte die App nicht prüfen, was für den Tag schon gemeldet ist? Dann sagen — nicht still so tun, als wäre nichts da. */
  const [pruefFehler, setPruefFehler] = useState(false);
  /** Normalminuten je Person in Meldungen ANDERER Teams an diesem Tag (Gäste, Versetzte) — für Normal/Über */
  const [andere, setAndere] = useState<BisherZeile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [wartend, setWartend] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const [mikroStream, setMikroStream] = useState<MediaStream | null>(null);
  const ticker = useRef<number | null>(null);
  /** Wer beim Speichern noch aufnimmt, verliert nichts: die Aufnahme wird beendet und mitgenommen. */
  const aufnahmeFertig = useRef<((a: { blob: Blob; sekunden: number } | null) => void) | null>(null);

  const heute = new Date();
  const heuteIso = iso(heute);
  // Gemeldet wird für einen Tag — normalerweise heute. Vergessen? Bis 7 Tage zurück nachtragen (lib/nachtrag.ts).
  // /erfassung?tag=JJJJ-MM-TT öffnet einen bestimmten Tag zum Nachtragen. Ist er zu alt (oder in der Zukunft), steht
  // das als Satz da — vorher sprang die Erfassung still auf heute, und das Team meldete auf den falschen Tag.
  const [tagAusLink] = useState(() => tagAusAdresse(new URLSearchParams(window.location.search).get('tag'), new Date()));
  const [datum, setDatum] = useState<Date>(() => (tagAusLink.tag ? new Date(tagAusLink.tag + 'T12:00:00') : new Date()));
  const [tagHinweis, setTagHinweis] = useState<string | null>(tagAusLink.hinweis);
  const tagIso = iso(datum);
  const istHeute = tagIso === heuteIso;
  const fruehesterIso = fruehesterNachtrag(heute);

  /**
   * Neuer Tag (13.10.2026): Stand «Heute» offen, und die App kommt am nächsten Morgen wieder nach vorne, gilt der neue
   * Tag — sonst meldete das Team auf gestern. Nur beim Zurückholen, nie mitten im Tippen. Wer bewusst einen anderen Tag
   * gewählt hat (Nachtrag), bleibt dort.
   */
  const zeigteHeute = useRef(tagIso === heuteIso);
  const gezeigterTag = useRef(tagIso);
  useEffect(() => { zeigteHeute.current = tagIso === iso(new Date()); gezeigterTag.current = tagIso; }, [tagIso]);
  useEffect(() => {
    const pruefen = () => {
      if (document.visibilityState !== 'visible' || !zeigteHeute.current) return;
      const jetzt = new Date();
      if (gezeigterTag.current === iso(jetzt)) return;
      setDatum(jetzt);
      setTagHinweis(`Neuer Tag — jetzt gilt ${lang(jetzt)}.`);
    };
    document.addEventListener('visibilitychange', pruefen);
    return () => document.removeEventListener('visibilitychange', pruefen);
  }, []);
  const team = teams.find((t) => t.id === teamId) ?? null;
  // In welcher Sprache die Sprachnotiz zuhört: Profil des Chefmonteurs — am Mikrofon umstellbar
  const sprecherSprache = team?.chefmonteur?.sprache ?? 'de';
  const sprachName = (PRUEF_TEXTE[sprecherSprache] ?? PRUEF_TEXTE.de).name;
  async function sprecherSpracheSetzen(code: string) {
    const chefId = team?.chefmonteur?.id;
    if (!supabase || !chefId || !teamId) return;
    const { error } = await supabase.from('mitarbeiter').update({ sprache: code }).eq('id', chefId);
    if (error) { setHinweis('Sprache konnte nicht gespeichert werden — ' + error.message); return; }
    setTeams((alt) => alt.map((t) => (t.id === teamId ? { ...t, chefmonteur: { id: chefId, sprache: code } } : t)));
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung,fahrzeug,chefmonteur:chefmonteur_id(id,sprache)').eq('aktiv', true).order('bezeichnung').then(({ data }) => {
      // Ohne Netz (Start auf der Baustelle): die Teams vom letzten Mal — siehe lib/vorrat.ts
      if (!data) { const v = vorratLesen<Team[]>('teams-erfassung'); if (v) setTeams(v); return; }
      vorratSchreiben('teams-erfassung', data);
      // Der Chefmonteur kommt als einzelnes Objekt (FK) — die generierten Typen behaupten eine Liste
      setTeams(data as unknown as Team[]);
      // Gespeichertes Team gibt es nicht mehr (z. B. nach Demo-Neustart) → Team neu wählen lassen
      const gespeichert = localStorage.getItem(TEAM_KEY);
      if (gespeichert && !data.some((t) => t.id === gespeichert)) {
        localStorage.removeItem(TEAM_KEY);
        setTeamId(null);
        setSchritt('team');
      }
    });
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    void offeneAnzahl().then(setWartend);
  }, []);
  // Ging im Hintergrund etwas hinaus oder kam etwas dazu: die Zahl «wartet» oben stimmt sofort
  useEffect(() => warteschlangeBeobachten(() => { void offeneAnzahl().then(setWartend).catch(() => undefined); }), []);

  /**
   * Lädt, was für Team + Tag schon gemeldet ist (lokal + Server), setzt den Zustand und gibt die Liste zurück (für
   * Prüfungen vor dem Speichern). Antwortet der Server nicht, gilt der letzte bekannte Stand vom Server, und oben steht
   * «Konnte nicht prüfen …» (13.10.2026: vorher war die Doppel-Prüfung dann still aus).
   */
  const heutigeLaden = useCallback(async (): Promise<Gemeldet[]> => {
    if (!teamId) return [];
    const bekannt = kacheln.concat(alleGeplanten, suchTreffer, alleBaustellen ?? []);
    const lokal = (await offeneMeldungen()).filter((m) => (m.payload as unknown as MeldungPayload).team_id === teamId && (m.payload as unknown as MeldungPayload).datum === tagIso);
    const liste: Gemeldet[] = lokal.map((m) => {
      const p = m.payload as unknown as MeldungPayload;
      const b = bekannt.find((x) => x.id === p.baustelle_id);
      const konto = b?.konto_nr ?? p.eintraege[0]?.konto_nr ?? '';
      return {
        bezeichnung: b?.bezeichnung ?? (konto ? `Konto-Nr. ${konto}` : 'Baustelle'), konto_nr: konto, baustelle_id: p.baustelle_id,
        normalfall: p.normalfall, abweichung_typ: p.abweichung_typ, lokal: true, schluessel: m.client_uuid, freigegeben: false,
        min: p.eintraege.reduce((s, z) => s + z.normal_min + z.ueber_min, 0),
        personen: p.eintraege.length,
        zeilen: p.eintraege.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, normal_min: z.normal_min })),
        haengt: !!m.kopfFehler || (m.zeilenFehler?.length ?? 0) > 0,
      };
    });
    // Schon gesendet, aber noch in der Liste vom Gerät? Dann nicht zweimal zeigen (Kopf-id = id auf dem Server)
    const lokaleIds = new Set(lokal.map((m) => (m.payload as unknown as MeldungPayload).id));
    type Zeile = { id: string; normalfall: boolean; abweichung_typ: Abweichung | null; baustelle_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null; zeiteintrag: { mitarbeiter_id: string; normal_min: number; ueber_min: number; status: string }[] };
    const vorratKey = `gemeldet:${teamId}:${tagIso}`;
    let server: Zeile[] | null = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.from('tagesmeldung').select('id,normalfall,abweichung_typ,baustelle_id,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(mitarbeiter_id,normal_min,ueber_min,status)').eq('team_id', teamId).eq('datum', tagIso).order('erfasst_am');
        if (!error && data) server = data as unknown as Zeile[];
      } catch {
        // keine Antwort — unten gilt der letzte bekannte Stand
      }
    }
    if (server) {
      vorratSchreiben(vorratKey, server);
      setPruefFehler(false);
    } else if (supabase) {
      server = vorratLesen<Zeile[]>(vorratKey) ?? [];
      setPruefFehler(true);
    }
    for (const d of server ?? []) {
      if (lokaleIds.has(d.id)) continue;
      liste.push({
        bezeichnung: d.baustelle?.bezeichnung ?? (d.baustelle?.konto_nr ? `Konto-Nr. ${d.baustelle.konto_nr}` : 'Baustelle'), konto_nr: d.baustelle?.konto_nr ?? '', baustelle_id: d.baustelle_id,
        normalfall: d.normalfall, abweichung_typ: d.abweichung_typ, lokal: false, schluessel: d.id,
        freigegeben: d.zeiteintrag.some((z) => z.status === 'freigegeben'),
        min: d.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0),
        personen: d.zeiteintrag.length,
        zeilen: d.zeiteintrag.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, normal_min: z.normal_min })),
      });
    }
    setHeuteGemeldet(liste);
    return liste;
  }, [teamId, tagIso, kacheln, alleGeplanten, suchTreffer, alleBaustellen]);

  /**
   * Normalminuten der Leute in Meldungen ANDERER Teams an diesem Tag (Server und Gerät) — ein Gast, den zwei Teams
   * melden, hat nur einen normalen Tag (13.10.2026). Ohne Antwort vom Server: der letzte bekannte Stand.
   */
  const andereLaden = useCallback(async (ids: string[]): Promise<BisherZeile[]> => {
    if (!teamId || ids.length === 0) return [];
    const lokal: BisherZeile[] = (await offeneMeldungen()).flatMap((m) => {
      const p = m.payload as unknown as MeldungPayload;
      if (p.datum !== tagIso || p.team_id === teamId || !Array.isArray(p.eintraege)) return [];
      return p.eintraege.filter((z) => ids.includes(z.mitarbeiter_id)).map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, normal_min: z.normal_min, meldung: m.client_uuid }));
    });
    if (!supabase) return lokal;
    const vorratKey = `andere:${teamId}:${tagIso}`;
    let server: BisherZeile[] | null = null;
    try {
      const { data, error } = await supabase.from('zeiteintrag').select('mitarbeiter_id,normal_min,tagesmeldung:tagesmeldung_id!inner(id,datum,team_id)').in('mitarbeiter_id', ids).eq('tagesmeldung.datum', tagIso).neq('tagesmeldung.team_id', teamId);
      if (!error && data) {
        server = (data as unknown as { mitarbeiter_id: string; normal_min: number; tagesmeldung: { id: string } }[]).map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, normal_min: z.normal_min, meldung: z.tagesmeldung.id }));
        vorratSchreiben(vorratKey, server);
      }
    } catch { /* unten der letzte Stand */ }
    const lokaleIds = new Set((await offeneMeldungen()).map((m) => (m.payload as unknown as MeldungPayload).id));
    return lokal.concat((server ?? vorratLesen<BisherZeile[]>(vorratKey) ?? []).filter((z) => !lokaleIds.has(z.meldung)));
  }, [teamId, tagIso]);

  // Team gewählt → Leute, Kacheln (Plan + zuletzt), Vorbelegung
  useEffect(() => {
    if (!supabase || !teamId) return;
    const client = supabase;
    setLaedtTeam(true);
    setLeute([]); setKacheln([]); setAlleGeplanten([]); setBaustelle(null); setZiffern(''); setSuchTreffer([]);
    setGaeste([]); setZeigeGast(false); setGastFilter('');
    setZweite(null); setWahlZweite(false); setWechsel(NACHMITTAG_MIN);
    // Ohne Netz: Leute und Kacheln, wie sie beim letzten Laden mit Netz waren (lib/vorrat.ts)
    type TeamVorrat = { personen: Person[]; gaeste: Person[]; kacheln: Baustelle[]; geplant: Baustelle[] };
    const ausVorrat = (): boolean => {
      const v = vorratLesen<TeamVorrat>(`team:${teamId}`);
      if (!v) return false;
      setLeute(v.personen);
      const a: Record<string, Anwesenheit> = {};
      for (const p of v.personen) a[p.id] = neueAnwesenheit(p, 'zeit', standardSpannen(znueni()));
      setAnw(a);
      setTeamSpannen(standardSpannen(znueni()));
      setZuletztGaeste(v.gaeste);
      setKacheln(v.kacheln);
      setAlleGeplanten(v.geplant);
      setBaustelle(v.kacheln[0] ?? null);
      return true;
    };
    void (async () => {
      try {
      const { data: mg, error: mgFehler } = await client
        .from('team_mitglied')
        .select('mitarbeiter:mitarbeiter_id(id,name,typ,funktion,oev_standard,km_standard,aktiv)')
        .eq('team_id', teamId)
        .is('bis', null);
      if (mgFehler || !mg) {
        if (ausVorrat()) return;
        throw mgFehler ?? new Error('Team nicht geladen');
      }
      const personen = ((mg ?? []) as unknown as { mitarbeiter: Person & { aktiv: boolean } }[])
        .map((r) => r.mitarbeiter)
        .filter((p) => p && p.aktiv)
        .sort((a, b) => a.name.localeCompare(b.name));
      setLeute(personen);
      const a: Record<string, Anwesenheit> = {};
      for (const p of personen) a[p.id] = neueAnwesenheit(p, 'zeit', standardSpannen(znueni()));
      setAnw(a);
      setTeamSpannen(standardSpannen(znueni()));

      // Zuletzt auf diesem Gerät hinzugefügte Gäste — nur die, die es noch gibt und die nicht inzwischen fest im Team sind
      const gastIds = gaesteLesen(teamId).filter((id) => !personen.some((p) => p.id === id));
      let gaesteListe: Person[] = [];
      if (gastIds.length > 0) {
        const { data: g } = await client.from('mitarbeiter').select('id,name,typ,funktion,oev_standard,km_standard').in('id', gastIds).eq('aktiv', true);
        const gefunden = (g ?? []) as Person[];
        gaesteListe = gastIds.map((id) => gefunden.find((p) => p.id === id)).filter((p): p is Person => !!p);
      }
      setZuletztGaeste(gaesteListe);

      const seit = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const verlauf = (gefiltert: boolean) => {
        const q = client.from('plan_verlauf').select('tabelle,datensatz_id,aktion,vorher,nachher,zeit').gte('zeit', seit);
        return (gefiltert ? q.or(verlaufFilter(teamId, personen.map((p) => p.id))) : q).order('zeit', { ascending: false }).limit(1000);
      };
      const [plan, zuletzt, vlGefiltert] = await Promise.all([
        // Nur Einsätze, die frühestens am ersten nachtragbaren Tag enden — sonst schneidet die Obergrenze der API
        // (1000 Zeilen) bei einem Team mit langer Geschichte ausgerechnet den aktuellen Plan ab (13.10.2026)
        client.from('jahresplan').select('id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).gte('bis', fruehesterNachtrag(new Date())).order('von'),
        client.from('tagesmeldung').select('datum,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).gte('datum', iso(addTage(heute, -14))).order('datum', { ascending: false }).limit(40),
        // Verlauf nur für dieses Team und seine Leute, neueste zuerst (vorher die ganze Firma, ohne Reihenfolge)
        verlauf(true),
      ]);
      // Versteht die Datenbank den Filter nicht, wenigstens die neuesten Zeilen der Firma
      const vl = vlGefiltert.error ? await verlauf(false) : vlGefiltert;
      const gesehen = new Set<string>();
      const tiles: Baustelle[] = [];
      const push = (b: Baustelle | null) => { if (b && !gesehen.has(b.id) && tiles.length < 4) { gesehen.add(b.id); tiles.push(b); } };
      const planRows = (plan.data ?? []) as unknown as { id: string; von: string; bis: string; baustelle: Baustelle | null }[];
      // Heute Geplantes zuerst (11.10.2026): nach einer Umplanung am Morgen ist sonst die Baustelle von gestern vorgewählt
      const heuteGeplant = planRows.filter((p) => p.von <= heuteIso && p.bis >= heuteIso).map((p) => p.baustelle).filter((b): b is Baustelle => !!b);
      for (const b of heuteGeplant) push(b);
      for (const z of (zuletzt.data ?? []) as unknown as { baustelle: Baustelle | null }[]) push(z.baustelle);
      for (const p of planRows) push(p.baustelle);
      const umgeplant = !vl.error && planHinweise(teamId, personen.map((p) => p.id), [heuteIso], (vl.data ?? []) as VerlaufZeile[], seit,
        planRows.map((p) => ({ id: p.id, team_id: teamId, baustelle_id: p.baustelle?.id ?? null, von: p.von, bis: p.bis })), []).some((h) => h.art === 'baustelle');
      setGeplantHeute({ ids: heuteGeplant.map((b) => b.id), neu: umgeplant });
      const geplant = planRows.map((p) => p.baustelle).filter((b): b is Baustelle => !!b);
      setKacheln(tiles);
      setAlleGeplanten(geplant);
      setBaustelle(tiles[0] ?? null);
      vorratSchreiben(`team:${teamId}`, { personen, gaeste: gaesteListe, kacheln: tiles, geplant });
      } catch {
        setHinweis('Team konnte nicht geladen werden — Netz prüfen und nochmals versuchen.');
      } finally {
        setLaedtTeam(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => { void heutigeLaden(); }, [heutigeLaden]);
  // Andere Teams am selben Tag — für alle, die in der Liste stehen (feste Leute und Gäste)
  const personenSchluessel = leute.concat(gaeste).map((p) => p.id).sort().join(',');
  useEffect(() => {
    let veraltet = false;
    void andereLaden(personenSchluessel ? personenSchluessel.split(',') : []).then((z) => { if (!veraltet) setAndere(z); }).catch(() => undefined);
    return () => { veraltet = true; };
  }, [andereLaden, personenSchluessel]);

  /**
   * Abwesenheiten des Tages (0036, Arbnor 10.10.2026): wer laut Sekretariat Ferien, Krank, Unfall … hat, ist abgehakt
   * und trägt eine Pille. Antippen geht trotzdem (z. B. kam doch zur Arbeit). Wechselt der Tag, kommen die nur
   * deswegen Abgehakten wieder dazu. Ohne Netz oder ohne Migration: nichts davon, alles wie bisher.
   */
  const [abwesend, setAbwesend] = useState<Record<string, string>>({});
  const autoAbgehakt = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase || leute.length === 0) { setAbwesend({}); return; }
    let veraltet = false;
    void supabase.from('abwesenheit').select('mitarbeiter_id,art').eq('datum', tagIso).in('mitarbeiter_id', leute.map((p) => p.id)).then(({ data, error }) => {
      if (veraltet || error) return;
      const m: Record<string, string> = Object.fromEntries(((data ?? []) as { mitarbeiter_id: string; art: string }[]).map((r) => [r.mitarbeiter_id, r.art]));
      const vorher = autoAbgehakt.current;
      autoAbgehakt.current = new Set(Object.keys(m));
      setAbwesend(m);
      setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, m[k] ? { ...a, dabei: false } : vorher.has(k) ? { ...a, dabei: true } : a])));
    });
    return () => { veraltet = true; };
  }, [leute, tagIso]);

  /**
   * Einteilung des Tages aus der Planung (0036, Mehmeti 10.10.2026): wer an diesem Tag in einem anderen Team arbeitet,
   * ist hier abgehakt («in Team 4»); wer aus einem anderen Team hierher eingeteilt ist, steht als «eingeteilt» in der
   * Liste. Ohne Netz oder ohne Migration: die festen Teams wie bisher.
   */
  const [versetzt, setVersetzt] = useState<Record<string, string>>({});
  const autoVersetzt = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase || !teamId) return;
    const client = supabase;
    let veraltet = false;
    const ids = leute.map((p) => p.id);
    void (async () => {
      type Zeile = { mitarbeiter_id: string; team_id: string; team: { bezeichnung: string } | null; mitarbeiter: (Person & { aktiv: boolean }) | null };
      const q = client.from('einsatz_person').select('mitarbeiter_id,team_id,team:team_id(bezeichnung),mitarbeiter:mitarbeiter_id(id,name,typ,funktion,oev_standard,km_standard,aktiv)').eq('datum', tagIso);
      const { data, error } = await (ids.length > 0 ? q.or(`team_id.eq.${teamId},mitarbeiter_id.in.(${ids.join(',')})`) : q.eq('team_id', teamId));
      if (veraltet || error) return;
      const zeilen = (data ?? []) as unknown as Zeile[];
      const weg: Record<string, string> = Object.fromEntries(zeilen.filter((z) => ids.includes(z.mitarbeiter_id) && z.team_id !== teamId).map((z) => [z.mitarbeiter_id, z.team?.bezeichnung ?? 'anderes Team']));
      const dazu = zeilen.filter((z) => z.team_id === teamId && !ids.includes(z.mitarbeiter_id) && z.mitarbeiter?.aktiv).map((z) => ({ ...z.mitarbeiter!, gast: true, eingeteilt: true }));
      const vorher = autoVersetzt.current;
      autoVersetzt.current = new Set(Object.keys(weg));
      setVersetzt(weg);
      setGaeste((alt) => [...alt.filter((g) => !g.eingeteilt && !dazu.some((x) => x.id === g.id)), ...dazu]);
      setAnw((alt) => {
        const neu: Record<string, Anwesenheit> = Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, weg[k] ? { ...a, dabei: false } : vorher.has(k) && !autoAbgehakt.current.has(k) ? { ...a, dabei: true } : a]));
        for (const p of dazu) if (!neu[p.id]) neu[p.id] = neueAnwesenheit(p, 'zeit', teamSpannen);
        return neu;
      });
    })();
    return () => { veraltet = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leute, tagIso, teamId]);

  /** Baustelle aus «andere Baustelle …» übernehmen: wird die erste Kachel oben (markiert), das Suchfeld geht zu. */
  const [gesuchtId, setGesuchtId] = useState<string | null>(null);
  /** Alle aktiven Baustellen zum Durchblättern — geladen erst beim Aufklappen, alphabetisch. */
  async function listeUmschalten() {
    setZeigeListe((v) => !v);
    if (alleBaustellen !== null) return;
    if (!supabase || !navigator.onLine) { setAlleBaustellen([]); return; }
    const { data } = await supabase.from('baustelle').select('id,konto_nr,bezeichnung').eq('status', 'aktiv').order('bezeichnung');
    setAlleBaustellen((data ?? []) as Baustelle[]);
  }

  function andereWaehlen(b: Baustelle) {
    if (wahlZweite) {
      if (b.id !== baustelle?.id) setZweite(b);
      setWahlZweite(false);
      setZeigeAndere(false);
      setZiffern('');
      setSuchTreffer([]);
      return;
    }
    if (b.id === zweite?.id) setZweite(null);
    setGesuchtId(b.id);
    setBaustelle(b);
    setKacheln((k) => [b, ...k.filter((x) => x.id !== b.id)].slice(0, 5));
    setZeigeAndere(false);
    setZiffern('');
    setSuchTreffer([]);
  }

  // Anderer Tag, anderes Team, andere Baustelle = eine andere Meldung. Der wartende Entwurf
  // gehört dann nicht mehr dazu und darf nicht überschrieben werden.
  useEffect(() => {
    entwurfAbRef.current = null;
  }, [teamId, tagIso, baustelle?.id, zweite?.id]);
  // Ein offener «schon gemeldet»-Dialog gilt nur für Team und Tag, für die er gefragt hat
  useEffect(() => { setDoppelt(null); }, [teamId, tagIso]);

  /**
   * Angefangene Meldung? Dann darf keine neue App-Fassung die Seite neu laden (lib/aktualisierung.ts). Angefangen heisst:
   * auf dieser Seite wurde getippt, seit sie offen ist oder seit dem letzten Speichern.
   */
  useEffect(() => {
    if (schritt === 'fertig' || schritt === 'team') { erfassungOffen(false); formularVerlassen(); return; }
    const beruehrt = () => erfassungOffen(true);
    document.addEventListener('pointerdown', beruehrt, true);
    document.addEventListener('keydown', beruehrt, true);
    return () => {
      document.removeEventListener('pointerdown', beruehrt, true);
      document.removeEventListener('keydown', beruehrt, true);
    };
  }, [schritt]);
  useEffect(() => () => erfassungOffen(false), []);
  // Gleiche Baustelle zweimal gibt es nicht
  useEffect(() => { if (zweite && zweite.id === baustelle?.id) setZweite(null); }, [baustelle?.id, zweite]);

  // Ausnahme für den Chefmonteur: Konto-Nr. oder Name, falls die Kacheln nicht reichen (ab 2 Zeichen, max. 5 Treffer).
  // Volle Nummer mit genau einem Treffer → direkt übernehmen, ohne zweiten Tipp.
  useEffect(() => {
    const q = ziffern.trim();
    // Nummern ab 3 Zeichen (sonst passt die halbe Liste), Namen ab 2 — «Aarstrasse» tippt niemand ganz
    const nurZiffern = /^\d+$/.test(q);
    if (!supabase || q.length < (nurZiffern ? 3 : 2)) { setSuchTreffer([]); return; }
    const client = supabase;
    const t = setTimeout(() => {
      // Nummer von vorne, Name irgendwo im Text. Komma trennt die beiden Bedingungen (ODER).
      const muster = q.replace(/[,()*]/g, ' ');
      const filter = nurZiffern ? `konto_nr.like.${muster}%` : `konto_nr.like.${muster}%,bezeichnung.ilike.%${muster}%`;
      void client.from('baustelle').select('id,konto_nr,bezeichnung').or(filter).order('konto_nr').limit(60).then(({ data: roh }) => {
        if (!roh) return;
        // Anfang zuerst (lib/suche.ts) — «ch» bringt «Chollerstrasse» vor «Archivstrasse»
        const data = baustellenSuchen(roh, q, 5);
        // Volle Nummer mit genau einem Treffer → direkt übernehmen, ohne zweiten Tipp
        if (nurZiffern && q.length >= 6 && data.length === 1 && data[0].konto_nr === q) { andereWaehlen(data[0]); return; }
        setSuchTreffer(data);
      });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ziffern]);

  function teamWaehlen(id: string) {
    localStorage.setItem(TEAM_KEY, id);
    setZuletzt(zuletztMerken(id));
    setWeitereTeams(0);
    setTeamId(id);
    setSchritt('tag');
  }

  // Teamwahl: zuletzt gewähltes + zuletzt genutzte Teams zuerst (max. 5), der Rest in Fünferblöcken hinter «Weitere Teams …»
  const teamAuswahl = useMemo(() => {
    const sortiert = teamsSortiert(teams);
    const vorneIds = [teamId, ...zuletzt].filter((x): x is string => !!x).filter((x, i, a) => a.indexOf(x) === i);
    const vorne = vorneIds.map((id) => sortiert.find((t) => t.id === id)).filter((t): t is Team => !!t).slice(0, 5);
    const erste = vorne.length > 0 ? vorne : sortiert.slice(0, 5);
    const rest = sortiert.filter((t) => !erste.some((e) => e.id === t.id));
    return { erste, rest };
  }, [teams, teamId, zuletzt]);

  /** Feste Mitglieder plus heutige Gäste — in dieser Reihenfolge, so steht es auch in der Liste. */
  const alleImTeam = useMemo(() => leute.concat(gaeste), [leute, gaeste]);
  const dabei = useMemo(() => alleImTeam.filter((p) => anw[p.id]?.dabei), [alleImTeam, anw]);
  // Lieferwagen-Haken nur, wenn Subunternehmer (Anstellung «extern») dabei sind und die Datenbank die Spalte kennt (0036)
  const lieferwagenPreis = lieferwagenTagRp();
  const mitExternen = lieferwagenPreis !== null && lieferwagenPreis > 0 && dabei.some((p) => p.typ === 'extern');
  useEffect(() => { setLieferwagen(false); }, [teamId, tagIso]);
  /**
   * Normalminuten, die jede Person an diesem Tag schon hat: Meldungen dieses Teams (Gerät + Server) und anderer Teams.
   * Die Anzeige rechnet damit, als käme die neue Meldung dazu; beim Speichern zählt, was dann wirklich gilt (ersetzen
   * nimmt die alten Meldungen aus der Rechnung).
   */
  const bisherAnzeige = useMemo(
    () => bisherNormal(heuteGemeldet.flatMap((m) => m.zeilen.map((z) => ({ ...z, meldung: m.schluessel }))).concat(andere)),
    [heuteGemeldet, andere],
  );
  const bisherVon = (id: string) => bisherAnzeige.get(id) ?? 0;
  const ueberTotal = dabei.reduce((s, p) => s + ueberFertig(anw[p.id], bisherVon(p.id)), 0);
  /** Die meisten Überstunden einer Person — daran hängt, ob die Sprachnotiz Pflicht ist (0045) */
  const ueberMax = dabei.reduce((m, p) => Math.max(m, ueberFertig(anw[p.id], bisherVon(p.id))), 0);
  // Keine Überstunden mehr (Zeit geändert) → die Rückfrage ist hinfällig
  useEffect(() => { if (ueberTotal === 0) { setRegieFrage(false); setRegieAntwort(null); setNotizFehlt(false); } }, [ueberTotal]);
  useEffect(() => { setRegieAntwort(null); setNotizFehlt(false); }, [teamId, tagIso]);
  useEffect(() => { if (regieFrage) regieFrageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [regieFrage]);

  /** Team-Zeiten setzen alle, die gerade auf Zeiten stehen. */
  function setzeTeamSpannen(s: Spanne[]) {
    setTeamSpannen(s);
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, a.modus === 'zeit' ? { ...a, zeiten: s.map((x) => ({ ...x })) } : a])));
  }

  // Gäste: Personen ausserhalb des Teams. Liste wird erst geladen, wenn der Knopf gedrückt wird.
  async function alleLeuteLaden() {
    if (!supabase || alleLeute) return;
    // Büro-Leute (Funktion «buero») helfen nie auf der Baustelle — nicht als Gast anbieten
    const { data } = await supabase.from('mitarbeiter').select('id,name,typ,funktion,oev_standard,km_standard').eq('aktiv', true).neq('funktion', FUNKTION_BUERO).order('name');
    setAlleLeute((data ?? []) as Person[]);
  }
  function gastHinzufuegen(p: Person) {
    if (alleImTeam.some((x) => x.id === p.id)) return;
    const g: Person = { ...p, gast: true };
    setGaeste((alt) => [...alt, g]);
    setAnw((alt) => ({ ...alt, [p.id]: neueAnwesenheit(p, 'zeit', teamSpannen) }));
    if (teamId) { gaesteMerken(teamId, p.id); setZuletztGaeste((alt) => [g, ...alt.filter((x) => x.id !== p.id)].slice(0, 5)); }
    setZeigeGast(false);
    setGastFilter('');
  }
  function gastEntfernen(id: string) {
    setGaeste((alt) => alt.filter((x) => x.id !== id));
    setAnw((alt) => { const { [id]: _weg, ...rest } = alt; void _weg; return rest; });
  }
  const gastTreffer = useMemo(() => {
    const q = gastFilter.trim().toLowerCase();
    if (!alleLeute || q.length < 2) return [];
    return alleLeute.filter((p) => !alleImTeam.some((x) => x.id === p.id) && p.name.toLowerCase().includes(q)).slice(0, 5);
  }, [alleLeute, gastFilter, alleImTeam]);
  const zuletztGaesteFrei = zuletztGaeste.filter((p) => !alleImTeam.some((x) => x.id === p.id));

  /**
   * Muss bei diesen Überstunden (Minuten der Person mit den meisten) gesprochen werden? Ab der Grenze der Firma
   * (0045, Standard 30 Min.; 0 = ab der ersten Minute) — darunter freiwillig (14.10.2026, Amir).
   */
  const notizNoetig = (ueberMaxPerson: number) => ueberMaxPerson > 0 && ueberMaxPerson >= notizPflichtAbMin();
  /** Pflicht, aber die Sprachnotiz fehlt noch (ohne Mikrofon auf dem Gerät gilt die Pflicht nicht). */
  const notizFehltNoch = (noetig: boolean) => noetig && !ueberAufnahme && !nimmtAuf && !mikroFehlt;
  /** Mikrofon-Feld zeigt «fehlt noch» (rote laufende Linie) — nie während der Aufnahme, nie ohne Mikrofon */
  const fehltAnzeige = notizFehlt && !ueberAufnahme && !nimmtAuf && !mikroFehlt;
  /**
   * Pflicht-Sprachnotiz bei Überstunden — für Regie genauso wie für «nur länger gearbeitet» (13.10.2026). Fehlt sie,
   * zeigt es das Mikrofon-Feld selbst (laufende rote Strichlinie, einmal anstupsen, «Fehlt noch»; das Mikrofon bleibt
   * neutral, damit es nicht wie eine laufende Aufnahme aussieht), auf dem
   * Tag-Schritt wird dorthin gescrollt. Kein zusätzlicher roter Satz mehr. Gibt true zurück, wenn es nicht weitergeht.
   */
  function notizPflichtPruefen(noetig: boolean): boolean {
    if (!notizFehltNoch(noetig)) return false;
    setHinweis('');
    setNotizFehlt(true);
    setStupser((n) => n + 1);
    setTimeout(() => notizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    return true;
  }

  /**
   * Abweichung beginnen (nur Regie-Modus): Leute mit Überstunden sind vorbelegt, ihre Überstunden
   * werden die Stunden der Zusatzarbeit — nicht doppelt. Die Sprachnotiz vom Tag wandert mit; sie ist
   * ja genau die Erklärung, die zur Abweichung gehört.
   */
  function abweichungStarten(typ: Abweichung) {
    if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; }
    if (dabei.length === 0) { setHinweis('Zuerst anhaken, wer dabei war.'); return; }
    // Regie braucht immer eine Notiz — der Bauführer muss dem Kunden sagen können, was gemacht wurde
    if (notizPflichtPruefen(true)) return;
    // Überstunden aus den Zeiten von–bis (wirksam), nicht aus dem alten Stundenzahl-Feld — sonst wurde nichts übernommen
    const ueberVon = (p: Person) => (anw[p.id] ? wirksam(anw[p.id], bisherVon(p.id)).ueber : 0);
    const mitUeber = dabei.filter((p) => ueberVon(p) > 0);
    setRegieFrage(false);
    setAbweichung(typ);
    setAbLeute(new Set((mitUeber.length > 0 ? mitUeber : dabei).map((p) => p.id)));
    if (mitUeber.length > 0) {
      setAbMin(ueberVon(mitUeber[0]));
      setAbMinPerson(Object.fromEntries(mitUeber.map((p) => [p.id, ueberVon(p)])));
    }
    setHinweis('');
    setSchritt('wer');
  }

  /** Minuten einer Person im Teil `i` des Tages (zwei Baustellen, Wechsel um `wechsel`). Ohne Zeiten: alles im ersten Teil. */
  function teilMin(p: Person, i: number): number {
    const a = anw[p.id];
    if (!a) return 0;
    if (a.modus !== 'zeit') return i === 0 ? 1 : 0;
    return spannenMinuten(spannenTeilen(a.zeiten, [wechsel])[i] ?? []);
  }

  /**
   * Meldung für die gewählte Baustelle bauen.
   *
   * `normal`: alle Anwesenden, Normal- und Überstunden wie eingestellt; die Sprachnotiz als Bemerkung
   * zum Tag (bei Überstunden Pflicht). `ohneUeberFuer` nimmt denen die Überstunden weg, deren Stunden
   * in die Abweichung gewandert sind — sonst stünden sie zweimal da.
   *
   * Sonst (nur Regie-Modus): die Abweichung — nur die Beteiligten, mit ihren Stunden der Zusatzarbeit,
   * Symbol und «wer wollte das». Keine Anreise, die hängt am normalen Tag.
   *
   * `bisher`: Normalminuten je Person, die an dem Tag schon gemeldet sind — vom normalen Tag bleibt nur der Rest
   * (13.10.2026, lib/tagesrest.ts).
   */
  function meldungBauen(
    b: Baustelle,
    notiz: { blob: Blob; sekunden: number } | null,
    art: 'normal' | 'abweichung' = 'normal',
    ohneUeberFuer: Set<string> = new Set(),
    teil: number | null = null,
    bisher: Map<string, number> = new Map(),
  ): MeldungPayload {
    const normal = art === 'normal';
    // Zwei Baustellen: nur wer in diesem Teil des Tages Zeit hat
    const beteiligt = (normal ? dabei : dabei.filter((p) => abLeute.has(p.id))).filter((p) => teil === null || teilMin(p, teil) > 0);
    const schon = (p: Person) => bisher.get(p.id) ?? 0;
    const ueberVon = (p: Person) => (ohneUeberFuer.has(p.id) ? 0 : wirksam(anw[p.id], schon(p)).ueber);
    const nz = notiz;
    const vs = ueberVorschau;
    const textOk = !!nz && vs?.status === 'fertig' && !!vs.text.trim();
    return {
      id: crypto.randomUUID(), team_id: teamId!, datum: tagIso, baustelle_id: b.id,
      normalfall: normal, abweichung_typ: normal ? null : abweichung, wer_hats_gewollt: normal ? null : wer,
      audio_sekunden: nz?.sekunden ?? null, erfasst_von: userId,
      // geprüfter Text (ggf. vom Chefmonteur korrigiert) geht mit — sonst erstellt der Server ihn nach dem Upload
      transkript: textOk ? vs!.text.trim() : null,
      transkript_quelle: textOk ? vs!.quelle : null,
      transkript_sprache: textOk ? vs!.sprache : null,
      // nur wenn ja — so geht jede andere Meldung auch ohne Migration 0036 durch
      ...(normal && lieferwagen && mitExternen && !teil ? { lieferwagen: true } : {}),
      eintraege: beteiligt.map((p) => {
        const a = anw[p.id];
        if (teil !== null && a.modus === 'zeit') {
          // Teil des Tages: Zeiten bis/ab Wechsel, Normal füllt sich über den ganzen Tag (teileAufteilen), Anreise am ersten Teil
          const t = spannenTeilen(a.zeiten, [wechsel]);
          const v = teileNachBisher(t.map(spannenMinuten), standardMin(), schon(p))[teil];
          const erster = t.findIndex((x) => spannenMinuten(x) > 0);
          return {
            id: crypto.randomUUID(), mitarbeiter_id: p.id, normal_min: v.normal_min, ueber_min: v.ueber_min,
            oev: teil === erster ? a.oev : false, km: teil === erster ? a.km : 0, baustelle_id: b.id, konto_nr: b.konto_nr,
            ...zuSpalten(t[teil]),
          };
        }
        const w = wirksam(a, schon(p));
        const min = normal ? w.min : abMinVon(p.id);
        // Vom normalen Tag ist nur noch der Rest frei — gilt auch für die Stunden der Abweichung
        const rest = restNormal(standardMin(), schon(p));
        return {
          id: crypto.randomUUID(), mitarbeiter_id: p.id,
          normal_min: Math.min(min, rest),
          ueber_min: Math.max(0, min - rest) + (normal ? ueberVon(p) : 0),
          oev: normal ? a.oev : false, km: normal ? a.km : 0, baustelle_id: b.id, konto_nr: b.konto_nr,
          // Zeiten nur mitschicken, wenn welche eingetragen sind — so bleibt die Stundenzahl-Meldung auch vor Migration 0016 gültig
          ...(normal && a.modus === 'zeit' ? zuSpalten(a.zeiten) : {}),
        };
      }),
    };
  }

  /** Die Abweichung in Worten: «2.0 h zusätzlich je 3 Pers.» — oder, wenn sie unterschiedlich sind, die Summe. */
  function abweichungText(): string {
    if (!abweichung) return '';
    const liste = dabei.filter((p) => abLeute.has(p.id));
    const erste = liste[0]?.id ?? '';
    const gleich = liste.every((p) => abMinVon(p.id) === abMinVon(erste));
    const gesamt = liste.reduce((sum, p) => sum + abMinVon(p.id), 0);
    return gleich
      ? `${stunden(abMinVon(erste))} h ${AB_KURZ[abweichung]} je ${liste.length} Pers.`
      : `${stunden(gesamt)} h ${AB_KURZ[abweichung]} (${liste.length} Pers., unterschiedlich)`;
  }

  /** Überstunden in Worten, wie der Chefmonteur denkt: «1.6 h Überstunden je Person» — sind sie verschieden, das Teamtotal. */
  function ueberText(): string {
    const je = dabei.map((p) => ueberFertig(anw[p.id], bisherVon(p.id))).filter((m) => m > 0);
    if (je.length > 1 && je.every((m) => m === je[0]) && je.length === dabei.length) return `${stunden(je[0])} h Überstunden je Person`;
    return `${stunden(ueberTotal)} h Überstunden${je.length > 1 ? ' im Team' : ''}`;
  }

  /** Stunden des normalen Tags in Worten: «8.0 h» wenn alle gleich, sonst «7.5–8.5 h». Aus den gespeicherten Meldungen. */
  function normalStundenText(gebaut: MeldungPayload[]): string {
    const je = new Map<string, { min: number; ueber: number }>();
    for (const z of gebaut.filter((m) => m.normalfall).flatMap((m) => m.eintraege)) {
      const x = je.get(z.mitarbeiter_id) ?? { min: 0, ueber: 0 };
      je.set(z.mitarbeiter_id, { min: x.min + z.normal_min, ueber: x.ueber + z.ueber_min });
    }
    const werte = [...je.values()];
    if (werte.length === 0) return '0.0 h';
    const lo = Math.min(...werte.map((w) => w.min));
    const hi = Math.max(...werte.map((w) => w.min));
    const ueber = werte.reduce((s, w) => s + w.ueber, 0);
    const basis = lo === hi ? `${stunden(lo)} h` : `${stunden(lo)}–${stunden(hi)} h`;
    return ueber > 0 ? `${basis} + ${stunden(ueber)} h Überstunden` : basis;
  }

  /** Speichern darf nie stumm scheitern: jeder Fehler landet als Satz auf dem Bildschirm. */
  async function speichern(modus: SpeicherModus = 'normal', art: 'normal' | 'abweichung' = 'normal') {
    if (speichertRef.current) return;
    speichertRef.current = true;
    setSpeichert(true);
    try {
      await speichernInnen(modus, art);
    } catch (e) {
      setGespeichert(null);
      setHinweis('Speichern fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) + ' — nochmals versuchen; die Aufnahme ist noch da.');
    } finally {
      speichertRef.current = false;
      setSpeichert(false);
    }
  }
  async function speichernInnen(modus: SpeicherModus, art: 'normal' | 'abweichung' = 'normal') {
    if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; }
    if (dabei.length === 0) { setHinweis('Niemand angehakt.'); return; }
    if (art === 'abweichung' && abLeute.size === 0) { setHinweis('Niemand bei der Zusatzarbeit angehakt.'); return; }
    // Zeiten von–bis: ohne «bis» gibt es keine Stunden — nichts raten, nachfragen. Seit 10.10.2026 jede Zeile: vorher zählte ein
    // Nachmittag ohne «bis» still 0, sobald der Vormittag stimmte (5 h statt 9 h gemeldet).
    const wer = (liste: Person[]) => (liste.length === dabei.length ? '' : `Bei ${liste.map((p) => p.name).join(', ')}: `);
    const ohneBis = dabei.filter((p) => anw[p.id]?.modus === 'zeit' && spannenOffen(anw[p.id].zeiten) === 'fehlt');
    if (ohneBis.length > 0) { setHinweis(`${wer(ohneBis)}Es fehlt noch «bis» — bitte eintragen, wann ihr fertig wart. Nur am Vormittag gearbeitet? Den Nachmittag mit × entfernen.`); return; }
    const verkehrt = dabei.filter((p) => anw[p.id]?.modus === 'zeit' && spannenOffen(anw[p.id].zeiten) === 'verkehrt');
    if (verkehrt.length > 0) { setHinweis(`${wer(verkehrt)}Eine Zeit endet vor ihrem Beginn — bitte prüfen.`); return; }
    const ueberlappt = dabei.filter((p) => anw[p.id]?.modus === 'zeit' && spannenUeberlappen(anw[p.id].zeiten));
    if (ueberlappt.length > 0) { setHinweis(`Bei ${ueberlappt.map((p) => p.name).join(', ')} überschneiden sich Vormittag und Nachmittag — bitte Zeiten prüfen.`); return; }
    // Zwei Baustellen: beide brauchen Zeit — sonst stimmt die Wechselzeit nicht
    const teile = art === 'normal' && zweite ? [baustelle, zweite] : null;
    if (teile) {
      const leer = teile.findIndex((_, i) => dabei.every((p) => teilMin(p, i) === 0));
      if (leer >= 0) { setHinweis(`Auf ${anzeigeName(teile[leer].bezeichnung) || teile[leer].konto_nr} hat niemand Zeit — die Wechselzeit ${uhrzeit(wechsel)} prüfen.`); return; }
    }

    // Frisch nachsehen, was für den Tag schon da ist (Gerät + Server, auch andere Teams) — nie mit einem alten Stand
    // entscheiden: sonst legte der zweite Druck nach einem Fehler still eine zweite Meldung an (03.10.2026)
    let aktuell = heuteGemeldet;
    try { aktuell = await heutigeLaden(); } catch { /* lokaler Stand reicht */ }
    let andereJetzt = andere;
    try { andereJetzt = await andereLaden(dabei.map((p) => p.id)); } catch { /* letzter Stand */ }

    if (art === 'normal') {
      const bisher = aktuell.filter((m) => m.normalfall);
      const gleiche = bisher.filter((m) => m.baustelle_id === baustelle.id);
      if (gleiche.some((m) => m.freigegeben)) {
        setHinweis(`Für ${baustelle.bezeichnung ?? baustelle.konto_nr} ist an diesem Tag schon eine Meldung vom Bauführer freigegeben. Änderungen macht der Bauführer in der Wochenübersicht.`);
        return;
      }
      if (bisher.length > 0 && modus === 'normal') {
        // Erst fragen: ersetzen oder zusätzlich? Ob ersetzen geht, prüft der Server (lib/ersetzen.ts) — bis dahin nur «Zusätzlich»
        const alte: AlteMeldung[] = bisher.map((m) => ({ lokal: m.lokal, schluessel: m.schluessel, bezeichnung: anzeigeName(m.bezeichnung) || m.konto_nr }));
        setDoppelt({
          baustellen: bisher.map((m) => m.bezeichnung).filter((x, i, a) => a.indexOf(x) === i),
          bisherMin: bisher.reduce((s, m) => s + m.min, 0),
          neuMin: dabei.reduce((s, p) => { const w = wirksam(anw[p.id]); return s + w.min + w.ueber; }, 0),
          alte,
          gruende: null,
        });
        const passt = (d: { alte: AlteMeldung[] } | null) => !!d && d.alte === alte;
        void ersetzenPruefen(supabase, alte)
          .then((r) => setDoppelt((d) => (d && passt(d) ? { ...d, gruende: r.filter((x) => x.grund).map((x) => `«${x.bezeichnung}»: ${x.grund}`) } : d)))
          .catch(() => setDoppelt((d) => (d && passt(d) ? { ...d, gruende: ['Konnte nicht prüfen, ob die frühere Meldung ersetzt werden darf.'] } : d)));
        return;
      }
    }

    // Was zählt für Normal und Über? Alles, was an dem Tag schon gemeldet ist — ausser den Meldungen, die gleich ersetzt
    // werden, und dem eigenen Entwurf der Abweichung, falls er nochmals versucht wird (13.10.2026)
    const ersetzteSchluessel = new Set(art === 'normal' && modus === 'ersetzen' ? aktuell.filter((m) => m.normalfall).map((m) => m.schluessel) : []);
    if (art === 'abweichung' && entwurfAbRef.current) ersetzteSchluessel.add(entwurfAbRef.current);
    const schon = bisherNormal(aktuell.flatMap((m) => m.zeilen.map((z) => ({ ...z, meldung: m.schluessel }))).concat(andereJetzt), ersetzteSchluessel);
    const ueberJetztMax = dabei.reduce((m, p) => Math.max(m, wirksam(anw[p.id], schon.get(p.id) ?? 0).ueber), 0);
    // Der «schon gemeldet»-Dialog bleibt offen: nach der Aufnahme dort nochmals wählen. Regie kommt immer aus Überstunden —
    // dort ist die Notiz genauso Pflicht (auch wenn sie im Regie-Schritt nochmals gelöscht wurde).
    if (notizPflichtPruefen(art === 'normal' ? notizNoetig(ueberJetztMax) : true)) return;
    setNotizFehlt(false);
    setHinweis('');

    // Ersetzen: erst wenn auf dem Server alles sauber entfernt ist, kommt die neue Meldung — sonst gar nichts (lib/ersetzen.ts)
    let uebernahme: Uebernahme = { fotos: [] };
    if (art === 'normal' && modus === 'ersetzen') {
      const alte: AlteMeldung[] = aktuell.filter((m) => m.normalfall).map((m) => ({ lokal: m.lokal, schluessel: m.schluessel, bezeichnung: anzeigeName(m.bezeichnung) || m.konto_nr }));
      const r = await ersetzen(supabase, alte);
      if (!r.ok) {
        setDoppelt(null);
        setHinweis(r.fehler);
        void heutigeLaden();
        return;
      }
      uebernahme = r.uebernahme;
    }
    setDoppelt(null);

    const clientUuids: string[] = [];
    const gebaut: MeldungPayload[] = [];
    /** Steht nur bei der Abweichung: ob der normale Tag gleich mitgespeichert wurde */
    let normalMitgespeichert = false;
    // Meldung mit Sprachnotiz — die Abschluss-Seite zeigt dann den Text, sobald er da ist
    let notizUuid: string | undefined;
    /** Normalminuten der Meldungen aus diesem Durchgang dazuzählen — die nächste Meldung im selben Durchgang teilt danach */
    const dazu = (p: MeldungPayload) => { for (const z of p.eintraege) schon.set(z.mitarbeiter_id, (schon.get(z.mitarbeiter_id) ?? 0) + z.normal_min); };

    if (art === 'abweichung') {
      // Die normalen Stunden des Tags dürfen nicht verloren gehen: fehlt die Normalmeldung für diese
      // Baustelle, geht sie zuerst mit in die Warteschlange — ohne die Überstunden der Beteiligten.
      if (!aktuell.some((m) => m.normalfall && m.baustelle_id === baustelle.id)) {
        // Die Notiz gehört nur dann auch zum normalen Tag, wenn dort Überstunden bleiben (Leute ausserhalb
        // der Abweichung) — sonst stünde derselbe Text zweimal beim Bauführer.
        const restUeber = dabei.some((p) => !abLeute.has(p.id) && wirksam(anw[p.id], schon.get(p.id) ?? 0).ueber > 0);
        const fuerNormal = restUeber ? ueberAufnahme : null;
        const p = meldungBauen(baustelle, fuerNormal, 'normal', abLeute, null, schon);
        clientUuids.push(await inWarteschlange(null, p, fuerNormal?.blob));
        gebaut.push(p);
        dazu(p);
        normalMitgespeichert = true;
      }
      const notiz = await aufnahmeAbschliessen();
      const p = meldungBauen(baustelle, notiz, 'abweichung', new Set(), null, schon);
      const uuid = await inWarteschlange(entwurfAbRef, p, notiz?.blob, fotos.map((f) => f.blob));
      gebaut.push(p);
      clientUuids.push(uuid);
      if (notiz) notizUuid = uuid;
    } else {
      // Sprachnotiz geht immer mit, wenn eine da ist — Bemerkung zum Tag (Bauführer 20.09.). Ersetzt eine Meldung, die nur
      // auf dem Gerät lag, gehen ihre Sprachnotiz (wenn keine neue da ist) und ihre Fotos mit (CLAUDE.md #8).
      const eigene = await aufnahmeAbschliessen();
      const alt = !eigene ? uebernahme.audio : undefined;
      const notiz = eigene ?? (alt ? { blob: alt.blob, sekunden: alt.sekunden ?? 1 } : null);
      const mitAltemText = (p: MeldungPayload): MeldungPayload => (alt && !p.transkript
        ? { ...p, transkript: alt.transkript, transkript_quelle: alt.transkript_quelle, transkript_sprache: alt.transkript_sprache }
        : p);
      const bilder = fotos.map((f) => f.blob).concat(uebernahme.fotos);
      // «Zusätzlich» und «ersetzen» legen immer NEUE Meldungen an — nie eine wartende überschreiben (13.10.2026: vorher
      // überschrieb «Zusätzlich» auf derselben Baustelle die erste, noch wartende Meldung samt Sprachnotiz)
      if (teile) {
        // Zwei Baustellen in einem Durchgang: je Baustelle eine Meldung. Notiz und Fotos an die Meldung mit den
        // Überstunden (dort fragt der Bauführer nach dem Warum), sonst an die erste.
        const ueberJeTeil = teile.map((_, i) => dabei.reduce((s, p) => {
          const a = anw[p.id];
          if (!a || a.modus !== 'zeit') return s;
          return s + teileNachBisher(spannenTeilen(a.zeiten, [wechsel]).map(spannenMinuten), standardMin(), schon.get(p.id) ?? 0)[i].ueber_min;
        }, 0));
        const mitNotiz = ueberJeTeil.some((u) => u > 0) ? ueberJeTeil.indexOf(Math.max(...ueberJeTeil)) : 0;
        const payloads = teile.map((b, i) => meldungBauen(b, i === mitNotiz ? notiz : null, 'normal', new Set(), i, schon));
        for (let i = 0; i < teile.length; i++) {
          const n = i === mitNotiz ? notiz : null;
          const p = n ? mitAltemText(payloads[i]) : payloads[i];
          const uuid = await inWarteschlange(null, p, n?.blob, i === mitNotiz ? bilder : []);
          gebaut.push(p);
          clientUuids.push(uuid);
          if (n) notizUuid = uuid;
        }
      } else {
        const p = mitAltemText(meldungBauen(baustelle, notiz, 'normal', new Set(), null, schon));
        const uuidNormal = await inWarteschlange(null, p, notiz?.blob, bilder);
        gebaut.push(p);
        clientUuids.push(uuidNormal);
        if (notiz) notizUuid = uuidNormal;
      }
    }
    const zusammenfassung = art === 'normal'
      ? `Gespeichert: ${normalStundenText(gebaut)}${teile ? ` · ${teile.map((b, i) => `${b.konto_nr} ${i === 0 ? 'bis' : 'ab'} ${uhrzeit(wechsel)}`).join(', ')}` : ''}${lieferwagen && mitExternen ? ' · Lieferwagen gebraucht' : ''}`
      : normalMitgespeichert
        ? `Gespeichert: normaler Tag ${normalStundenText(gebaut)} + ${abweichungText()}`
        : `Gespeichert: ${abweichungText()} (normaler Tag war schon gemeldet)`;

    setGespeichert('Lokal gespeichert …');
    // Höchstens 20 Sekunden aufs Senden warten: läuft gerade ein langsamer Upload im Hintergrund, steht die Meldung
    // trotzdem sicher auf dem Gerät und geht danach automatisch hinaus
    const erg: FlushErgebnis | null = supabase && navigator.onLine
      ? await Promise.race([
        flushNachSupabase(supabase).catch((e: unknown): FlushErgebnis => ({ gesendet: 0, fehler: 1, verworfen: 0, fehlerText: e instanceof Error ? e.message : String(e) })),
        new Promise<null>((r) => setTimeout(() => r(null), 20000)),
      ])
      : null;
    if (erg) {
      const offen = await offeneMeldungen();
      const alleDurch = clientUuids.every((u) => offen.every((m) => m.client_uuid !== u));
      if (alleDurch) {
        // Durch: der nächste Druck meint eine neue Meldung
        entwurfAbRef.current = null;
        setGespeichert(art === 'normal' ? 'Gespeichert ✓' : 'Abweichung gespeichert ✓');
        setBestaetigung(zusammenfassung + ' ✓');
        setFertig({ text: zusammenfassung, stand: 'gesendet', notizUuid });
        if (erg.verworfen > 0) setHinweis(`${erg.verworfen} alte Meldung${erg.verworfen === 1 ? '' : 'en'} aussortiert: ${erg.fehlerText ?? ''}`);
      } else {
        // Ehrlich bleiben: auf dem Gerät ist es sicher, aber der Server hat abgelehnt — Grund zeigen
        setHinweis(`Auf dem Gerät gespeichert, aber noch nicht gesendet: ${erg.fehlerText ?? 'unbekannter Fehler'}`);
        setGespeichert('Lokal gespeichert — Senden fehlgeschlagen');
        setBestaetigung(zusammenfassung + ' — noch nicht gesendet');
        setFertig({ text: zusammenfassung, stand: 'fehler', notizUuid });
      }
    } else {
      setGespeichert('Gespeichert — wird gesendet, sobald Netz da ist');
      setBestaetigung(zusammenfassung + ' — wird gesendet, sobald Netz da ist');
      setFertig({ text: zusammenfassung, stand: 'wartet', notizUuid });
    }
    void heutigeLaden();
    void offeneAnzahl().then(setWartend);
    setTimeout(() => setGespeichert(null), 3500);
    setTimeout(() => setBestaetigung(null), 8000);
    setAbweichung(null); setWer(null); setAbMin(60); setAbMinPerson({}); setAbLeute(new Set());
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, { ...a, ueber: 0 }])));
    setUeberAufnahme(null); setUeberVorschau(null);
    for (const f of fotos) URL.revokeObjectURL(f.url);
    setFotos([]);
    setSchritt('fertig');
  }

  // Sprachnotiz — gedrückt halten / antippen
  async function aufnahmeStart() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMikroFehlt(false);
      setMikroStream(stream);
      // Safari (iPhone) kann kein WebM — dort entsteht AAC in MP4. Das Etikett muss zum Inhalt
      // passen, sonst liest Azure die Datei als WebM und die Erkennung scheitert.
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const teile: BlobPart[] = [];
      rec.ondataavailable = (ev) => teile.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setMikroStream(null);
        const typ = (rec.mimeType || mime || 'audio/mp4').split(';')[0];
        const fertig = { blob: new Blob(teile, { type: typ }), sekunden: Math.max(1, Math.round((Date.now() - start) / 1000)) };
        setUeberAufnahme(fertig);
        setNimmtAuf(false);
        void textVorschau(fertig.blob);
        if (ticker.current) window.clearInterval(ticker.current);
        aufnahmeFertig.current?.(fertig);
        aufnahmeFertig.current = null;
      };
      const start = Date.now();
      recorder.current = rec;
      rec.start();
      setNimmtAuf(true);
      setSekunden(0);
      ticker.current = window.setInterval(() => setSekunden(Math.round((Date.now() - start) / 1000)), 250);
    } catch (e) {
      setMikroFehlt(true);
      // Verweigert ≠ kaputt: bei «blockiert» hilft nur der Weg über die Handy-Einstellungen.
      const verweigert = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setHinweis(verweigert
        ? 'Das Mikrofon ist für Rapporto gesperrt. In den Einstellungen des Handys das Mikrofon für diese App erlauben, dann nochmals antippen.'
        : 'Mikrofon nicht verfügbar — die Meldung geht auch ohne Sprachnotiz.');
    }
  }
  /** Laufende Aufnahme beenden und auf die Datei warten — sonst geht sie beim Speichern verloren. */
  function aufnahmeAbschliessen(): Promise<{ blob: Blob; sekunden: number } | null> {
    const bisher = ueberAufnahme;
    if (!nimmtAuf || !recorder.current || recorder.current.state === 'inactive') return Promise.resolve(bisher);
    return new Promise((resolve) => {
      aufnahmeFertig.current = resolve;
      recorder.current?.stop();
      window.setTimeout(() => { if (aufnahmeFertig.current === resolve) { aufnahmeFertig.current = null; resolve(bisher); } }, 3000);
    });
  }
  function aufnahmeStop() {
    recorder.current?.stop();
  }

  // ── Ansichten ──────────────────────────────────────────────────────────────

  if (schritt === 'team') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold">Welches Team?</h1>
          <p className="text-sm text-ink3">Einmal wählen — das Gerät merkt es sich.</p>
          <div className="grid grid-cols-2 gap-2">
            {teamAuswahl.erste.map((t) => (
              <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className={'py-4 text-base ' + (t.id === teamId ? 'chip chip-on' : 'chip')}>
                {t.bezeichnung}{t.id === teamId ? ' · zuletzt' : ''}
              </button>
            ))}
          </div>
          {weitereTeams > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {teamAuswahl.rest.slice(0, weitereTeams).map((t) => (
                <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">{t.bezeichnung}</button>
              ))}
            </div>
          )}
          {weitereTeams < teamAuswahl.rest.length && (
            <button type="button" onClick={() => setWeitereTeams((n) => n + 5)} className="btn-ghost w-full">Weitere Teams …</button>
          )}
          {teams.length === 0 && <p className="card text-sm text-ink3">Keine Teams — unter Verwaltung anlegen{istDemoFirma() ? ' oder den Demo-Betrieb laden' : ''}.</p>}
        </div>
      </Shell>
    );
  }

  // ── Regie-Modus (nur über «Überstunden — war das Regie?» → Ja): «Wer wollte das?» → Stunden je Person und Notiz ──
  if (schritt === 'wer') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <p className="lbl mb-0">{abweichung ? ABWEICHUNG_NAME[abweichung] : ''}</p>
          <h1 className="font-display text-2xl font-semibold">Wer wollte das?</h1>
          <div className="grid grid-cols-3 gap-2">
            {([['kunde', 'Kunde', '#D82816'], ['chef', 'Unser Chef', '#29506B'], ['niemand', 'Niemand', '']] as const).map(([w, label, farbe]) => (
              <button key={w} type="button" onClick={() => { setWer(w); setSchritt('notiz'); }} className="chip flex flex-col items-center gap-2 py-5">
                {farbe ? <Helm farbe={farbe} /> : (
                  <svg viewBox="0 0 48 40" className="h-10 w-12" aria-hidden="true"><circle cx="24" cy="20" r="12" fill="none" stroke="#6C7B81" strokeWidth="3" /><line x1="15.5" y1="28.5" x2="32.5" y2="11.5" stroke="#6C7B81" strokeWidth="3" /></svg>
                )}
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink3">Kunde = der Bauleiter hat es angeordnet · Unser Chef = kam von uns · Niemand = selbst gemacht, meist weil etwas kaputt war</p>
          <button type="button" onClick={() => { setAbweichung(null); setRegieAntwort(null); setSchritt('tag'); }} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'notiz') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <p className="lbl mb-0">{abweichung ? ABWEICHUNG_NAME[abweichung] : ''} · {wer === 'kunde' ? 'Kunde' : wer === 'chef' ? 'unser Chef' : 'niemand'}</p>
          <h1 className="font-display text-2xl font-semibold">Wie lange?</h1>
          <Stepper wert={abMin} setWert={(v) => { setAbMin(v); setAbMinPerson({}); }} schritt={30} min={30} format={(v) => stunden(v) + ' h'} />
          <p className="-mt-2 text-center text-xs text-ink3">
            {dabei.some((x) => wirksam(anw[x.id], bisherVon(x.id)).ueber > 0)
              ? 'Vorbelegt mit den Überstunden — die zählen dann hier, nicht doppelt.'
              : 'Gilt für alle — unten kann jede Person einzeln anders sein.'}
          </p>

          <div>
            <p className="lbl">Wer war dabei · wie lange</p>
            <div className="divide-y divide-line rounded-[14px] border border-line bg-surface">
              {dabei.map((x) => {
                const dabeiAb = abLeute.has(x.id);
                const min = abMinVon(x.id);
                return (
                  <div key={x.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <button type="button" onClick={() => setAbLeute((alt) => { const n = new Set(alt); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} className="flex min-w-0 items-center gap-2 text-left">
                      <span className={'grid h-9 w-9 flex-none place-items-center rounded-[10px] border ' + (dabeiAb ? 'border-good bg-good text-white' : 'border-line-strong bg-surface text-transparent')}><Check size={18} strokeWidth={2.6} /></span>
                      <span className={'truncate ' + (dabeiAb ? '' : 'text-ink3')}>{x.name}{x.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}</span>
                    </button>
                    {dabeiAb ? (
                      <span className="flex flex-none items-center gap-1">
                        <MiniKnopf art="minus" onClick={() => setAbMinPerson((m) => ({ ...m, [x.id]: Math.max(30, min - 30) }))} />
                        <span className={'w-12 text-center font-mono text-[15px] tabular-nums ' + (abMinPerson[x.id] !== undefined && abMinPerson[x.id] !== abMin ? 'font-semibold text-steel' : '')}>{stunden(min)}</span>
                        <MiniKnopf art="plus" onClick={() => setAbMinPerson((m) => ({ ...m, [x.id]: min + 30 }))} />
                      </span>
                    ) : (
                      <span className="text-xs text-ink3">nicht dabei</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {fotoLeiste('Bitte Fotos machen — der Bauführer braucht Bilder bei Regie.')}

          {/* Dieselbe Sprachnotiz wie am Tag: wurde beim Tag schon aufgenommen, ist sie hier schon da. Pflicht (13.10.2026). */}
          <div key={stupser} className={'relative rounded-[14px] border-2 border-dashed p-5 text-center ' + (nimmtAuf ? 'border-accent bg-accent-soft' : ueberAufnahme ? 'border-good/50 bg-good-soft/40' : fehltAnzeige ? 'notiz-stupser border-transparent bg-steel-soft' : 'border-steel bg-steel-soft')}>
            {fehltAnzeige && <LaufStrich r={14} />}
            {ueberAufnahme ? (
              <div className="space-y-2">
                <p className="font-display font-semibold">Sprachnotiz · {ueberAufnahme.sekunden} Sek. ✓</p>
                <audio controls src={aufnahmeUrl} className="mx-auto h-9 w-full max-w-xs" />
                <TranskriptPruefung
                  vorschau={ueberVorschau}
                  aendern={(t) => setUeberVorschau((v) => (v ? { ...v, text: t } : v))}
                  bestaetigen={() => void originalBestaetigen()}
                />
                <button type="button" onClick={() => { setUeberAufnahme(null); setUeberVorschau(null); }} className="btn-ghost">nochmal aufnehmen</button>
              </div>
            ) : (
              <button type="button" onClick={() => (nimmtAuf ? aufnahmeStop() : void aufnahmeStart())} className="w-full">
                <span className={'mx-auto grid h-16 w-16 place-items-center rounded-full ' + (nimmtAuf ? 'aufnahme-ring bg-accent text-white' : 'bg-surface text-steel ring-1 ring-line-strong')}>
                  <svg viewBox="0 0 40 48" className="h-8 w-7" aria-hidden="true" fill="currentColor">
                    <rect x="13" y="4" width="14" height="24" rx="7" />
                    <path d="M8 22a12 12 0 0 0 24 0" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                    <rect x="18.2" y="34" width="3.6" height="8" rx="1.8" />
                  </svg>
                </span>
                {nimmtAuf && <span className="mt-3 block"><Pegel stream={mikroStream} /></span>}
                <span className="mt-2 block font-display font-semibold">{nimmtAuf ? `${sekunden} Sek. — antippen zum Stoppen` : 'Antippen und kurz erzählen, was war'}</span>
                <span className={'mt-1 block text-xs ' + (fehltAnzeige ? 'font-semibold text-accent-deep' : 'text-ink3')}>{nimmtAuf ? 'Die App hört zu und schreibt danach mit.' : mikroFehlt ? 'Mikrofon nicht verfügbar — Speichern geht trotzdem.' : fehltAnzeige ? 'Fehlt noch — 10 Sekunden reichen, dann nochmals «Speichern».' : `Pflicht bei Regie — auf ${sprachName} sprechen, 10 Sekunden reichen.`}</span>
              </button>
            )}
            {!ueberAufnahme && !nimmtAuf && team?.chefmonteur?.id && <SprachWahl sprache={sprecherSprache} setzen={(c) => void sprecherSpracheSetzen(c)} />}
          </div>

          <button type="button" disabled={speichert} onClick={() => void speichern('normal', 'abweichung')} className="cta disabled:opacity-70">{speichert ? 'Speichert …' : 'Speichern'}</button>
          {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}
          <button type="button" onClick={() => setSchritt('wer')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'fertig') {
    const stand = fertig?.stand ?? 'gesendet';
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <section className={'rounded-[14px] border px-4 py-4 ' + (stand === 'fehler' ? 'border-amber/50 bg-amber-soft' : 'border-good/40 bg-good-soft')}>
            <p className={'font-display text-xl font-semibold ' + (stand === 'fehler' ? 'text-amber-deep' : 'text-good-deep')}>
              {stand === 'gesendet' ? '✓ Gespeichert und gesendet' : stand === 'wartet' ? '✓ Gespeichert — wird gesendet, sobald Netz da ist' : 'Gespeichert, aber noch nicht gesendet'}
            </p>
            <p className="mt-1 text-sm text-ink2">{fertig?.text}</p>
            {hinweis && <p className="mt-1 text-xs text-amber-deep">{hinweis}</p>}
          </section>

          {fertig?.notizUuid && <TranskriptLive clientUuid={fertig.notizUuid} stand={stand} />}

          <section className="card">
            <p className="lbl mb-1">{istHeute ? 'Das steht jetzt für heute' : `Das steht jetzt für ${lang(datum)}`} · {team?.bezeichnung ?? 'Team'}</p>
            <ul className="divide-y divide-line text-sm">
              {heuteGemeldet.map((m, i) => (
                <li key={i} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">{m.normalfall ? <CheckCircle2 size={16} className="shrink-0 text-good" /> : <Flag size={16} className="shrink-0 text-amber-deep" />} <span>{anzeigeName(m.bezeichnung)}</span>{!m.normalfall && <span className="ml-1 text-xs text-amber-deep">{m.abweichung_typ ? AB_KURZ[m.abweichung_typ] : 'Abweichung'}</span>}</span>
                    <span className={'block text-[11px] ' + (m.haengt ? 'font-semibold text-amber-deep' : 'text-ink3')}>{m.haengt ? 'kommt nicht durch — siehe Startseite' : m.lokal ? 'wartet auf Netz' : 'gesendet'}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono tabular-nums">
                    {m.personen > 1 && m.min % m.personen === 0 ? <>{stunden(m.min / m.personen)} h<span className="block text-[10px] text-ink3">je {m.personen} Pers.</span></> : <>{stunden(m.min)} h</>}
                  </span>
                </li>
              ))}
              {heuteGemeldet.length === 0 && <li className="py-1.5 text-ink3">Lädt …</li>}
            </ul>
            <p className="mt-2 text-xs text-ink3">Der Bauführer sieht das in der Wochenübersicht. Ändern kann er es dort, bis er es freigibt.</p>
          </section>

          <Link to="/" className="cta cta-good block text-center">Fertig für {istHeute ? 'heute' : 'diesen Tag'}</Link>
          <button type="button" className="btn-ghost w-full py-2.5" onClick={() => setSchritt('tag')}>Noch etwas melden — zweite Baustelle</button>
          {/* Gleiche Grenze wie der Pfeil ‹ (lib/nachtrag.ts) — vorher ging es hier beliebig weit zurück */}
          {tagIso > fruehesterIso && (
            <button type="button" className="btn-ghost w-full py-2.5" onClick={() => { setDatum(addTage(datum, -1)); setSchritt('tag'); }}>Anderen Tag nachtragen</button>
          )}
        </div>
      </Shell>
    );
  }

  // Hauptansicht: der normale Tag
  return (
    <Shell zurueck schmal>
      <div className="space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button type="button" className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-ink2 disabled:opacity-30" disabled={tagIso <= fruehesterIso} onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück"><ChevronLeft size={18} /></button>
              <h1 className="font-display text-2xl font-semibold">{istHeute ? 'Heute' : lang(datum)}</h1>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-ink2 disabled:opacity-30" disabled={istHeute} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor"><ChevronRight size={18} /></button>
            </div>
            <p className="mt-0.5 text-xs text-ink3">
              {istHeute ? lang(datum) : <span className="font-semibold text-accent-deep">Nachtrag — nicht heute</span>}
              {' · '}
              <button type="button" onClick={() => setSchritt('team')} className="font-semibold text-steel">
                {team?.bezeichnung ?? 'Team'}{kennzeichen(team?.fahrzeug) ? ` · ${kennzeichen(team?.fahrzeug)}` : ''} · ändern
              </button>
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink3">
            <span className={'inline-block h-2 w-2 rounded-full ' + (navigator.onLine ? 'bg-good' : 'bg-amber')} aria-hidden="true" />
            {navigator.onLine ? 'online' : 'offline'}
            {wartend > 0 && <span className="ml-1 rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-deep">{wartend} wartet</span>}
          </span>
        </header>

        {bestaetigung && (
          <section className="rounded-[14px] border border-good/40 bg-good-soft px-4 py-3 text-sm font-semibold text-good-deep" role="status">
            {bestaetigung}
          </section>
        )}

        {/* Zu alter Tag im Link, oder über Nacht ein neuer Tag: sagen, welcher Tag jetzt gilt — nie still wechseln */}
        {tagHinweis && (
          <section className="flex items-start justify-between gap-2 rounded-[14px] border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-deep" role="status">
            <span>{tagHinweis}</span>
            <button type="button" onClick={() => setTagHinweis(null)} aria-label="Hinweis schliessen" className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-amber-deep"><X size={15} /></button>
          </section>
        )}

        {/* Meldungen, die nicht von allein durchkommen — hier wie auf der Startseite, damit es niemand übersieht */}
        <Warteschlange nurProbleme />

        {pruefFehler && (
          <p className="rounded-[12px] bg-surface-2 px-4 py-2.5 text-xs text-ink2" role="status">
            Konnte nicht prüfen, ob {istHeute ? 'heute' : 'an diesem Tag'} schon gemeldet wurde{heuteGemeldet.some((m) => !m.lokal) ? ' — gezeigt ist der letzte bekannte Stand' : ''}. Melden geht trotzdem.
          </p>
        )}

        {/* Schon gemeldet? Zuoberst, damit niemand doppelt meldet — und der Weg zum Nachtrag ist klar. */}
        {heuteGemeldet.length > 0 && (
          <section className="rounded-[14px] border border-good/40 bg-good-soft px-4 py-3">
            <p className="text-sm font-semibold text-good-deep">
              {istHeute ? 'Heute schon gemeldet' : `Für ${lang(datum)} schon gemeldet`}
            </p>
            <ul className="mt-1 space-y-1 text-sm text-ink2">
              {heuteGemeldet.map((m, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      {m.normalfall ? <CheckCircle2 size={16} className="shrink-0 text-good" /> : <Flag size={16} className="shrink-0 text-amber-deep" />} <span>{anzeigeName(m.bezeichnung)}</span>
                      {!m.normalfall && <span className="ml-1 text-xs text-amber-deep">{m.abweichung_typ ? AB_KURZ[m.abweichung_typ] : 'Abweichung'}</span>}
                    </span>
                    <span className={'block text-[11px] ' + (m.haengt ? 'font-semibold text-amber-deep' : 'text-ink3')}>
                      {m.freigegeben ? 'vom Bauführer freigegeben — kann hier nicht mehr ersetzt werden' : m.haengt ? 'kommt nicht durch — Grund steht oben' : m.lokal ? 'wartet auf Netz' : 'gesendet'}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-sm tabular-nums">
                    {m.personen > 1 && m.min % m.personen === 0 ? <>{stunden(m.min / m.personen)} h<span className="block text-[10px] text-ink3">je {m.personen} Pers.</span></> : <>{stunden(m.min)} h{m.personen > 1 ? <span className="block text-[10px] text-ink3">{m.personen} Pers. zusammen</span> : null}</>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-ink3">
              Zweite Baustelle an diesem Tag? Unten antippen und speichern. Einen anderen Tag vergessen? Oben mit dem Pfeil zurück.
            </p>
          </section>
        )}

        <section>
          <p className="lbl">Wo wart ihr?</p>
          {laedtTeam && kacheln.length === 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="chip flex min-h-[4.5rem] items-center justify-center text-ink3">Lädt …</div>
              <div className="chip min-h-[4.5rem] opacity-40" aria-hidden="true" />
            </div>
          )}
          {!(laedtTeam && kacheln.length === 0) && (
          <div className="grid grid-cols-2 gap-2">
            {kacheln.map((b, i) => (
              <button key={b.id} type="button" onClick={() => setBaustelle(b)} className={'chip flex min-h-[4.5rem] flex-col items-start justify-center py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : zweite?.id === b.id ? 'border-ink/30 bg-surface-2' : '')}>
                <span className="break-words text-sm font-semibold leading-tight">{anzeigeName(b.bezeichnung)}</span>
                <span className="mt-1 flex items-center gap-1.5"><span className="knr">{b.konto_nr}</span>{zweite?.id === b.id ? <span className="text-[10px] font-semibold text-ink2">2. Baustelle</span>
                  : geplantHeute.ids.includes(b.id) ? <span className={'text-[10px] ' + (geplantHeute.neu ? 'rounded-md bg-amber-soft px-1.5 py-px font-semibold text-amber-deep' : 'text-ink3')}>{geplantHeute.neu ? 'neu geplant' : 'geplant'}</span>
                  : i === 0 && <span className="text-[10px] text-ink3">{b.id === gesuchtId ? 'eingegeben' : 'zuletzt'}</span>}</span>
              </button>
            ))}
            <button type="button" onClick={() => setZeigeAndere((v) => !v)} className="chip flex min-h-[4.5rem] items-center justify-center text-ink3">andere Baustelle …</button>
          </div>
          )}
          {zeigeAndere && (
            <div className="card mt-2 space-y-2 p-3">
              {wahlZweite && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">Zweite Baustelle wählen</p>
                  <button type="button" onClick={() => { setWahlZweite(false); setZeigeAndere(false); }} className="text-xs font-semibold text-ink3">Abbrechen</button>
                </div>
              )}
              {(wahlZweite ? kacheln.concat(alleGeplanten).filter((b, i, a) => b.id !== baustelle?.id && a.findIndex((x) => x.id === b.id) === i).slice(0, 6) : alleGeplanten.filter((b) => !kacheln.some((k) => k.id === b.id)).slice(0, 5)).map((b) => (
                <button key={b.id} type="button" onClick={() => andereWaehlen(b)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-ground">
                  <span>{anzeigeName(b.bezeichnung)}</span><span className="knr">{b.konto_nr}</span>
                </button>
              ))}
              {/* Ziffernblock statt Tastatur (Regel 2): Konto-Nr. tippen, ab 3 Ziffern kommen bis zu 5 Treffer */}
              <div className="border-t border-line pt-3">
                <p className="lbl">Nummer oder Name eintippen</p>
                {/* Echtes Feld: tippen, einfügen, Tastatur — der Ziffernblock darunter bleibt für Handschuhe */}
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoFocus
                  value={ziffern}
                  onChange={(e) => setZiffern(e.target.value.slice(0, 40))}
                  onPaste={(e) => { e.preventDefault(); setZiffern(e.clipboardData.getData('text').trim().slice(0, 40)); }}
                  placeholder="903221 oder Aarstrasse"
                  aria-label="Konto-Nr. oder Name der Baustelle"
                  className={'field mb-2 text-center text-xl font-semibold ' + (/^\d*$/.test(ziffern) ? 'font-mono tabular-nums tracking-[0.2em] placeholder:tracking-normal placeholder:font-sans placeholder:text-base placeholder:font-normal' : 'placeholder:text-base placeholder:font-normal')}
                />
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((z) => (
                    <button key={z} type="button" onClick={() => setZiffern((s) => (s.length < 6 ? s + z : s))} className="chip py-3 font-mono text-xl">{z}</button>
                  ))}
                  <button type="button" onClick={() => setZiffern('')} disabled={ziffern.length === 0} className="chip py-3 text-sm text-ink3 disabled:opacity-40">leer</button>
                  <button type="button" onClick={() => setZiffern((s) => (s.length < 6 ? s + '0' : s))} className="chip py-3 font-mono text-xl">0</button>
                  <button type="button" onClick={() => setZiffern((s) => s.slice(0, -1))} disabled={ziffern.length === 0} aria-label="letzte Ziffer löschen" className="chip py-3 font-mono text-xl disabled:opacity-40">←</button>
                </div>
                {!zeigeListe && (ziffern.trim().length < (/^\d+$/.test(ziffern.trim()) ? 3 : 2)
                  ? <p className="mt-2 text-[11px] text-ink3">Nummer ab 3 Ziffern, Name ab 2 Buchstaben.</p>
                  : suchTreffer.length === 0 && <p className="mt-2 text-[11px] text-ink3">Keine Baustelle für «{ziffern.trim()}» gefunden.</p>)}
                {!zeigeListe && suchTreffer.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {suchTreffer.map((b) => (
                      <button key={b.id} type="button" onClick={() => andereWaehlen(b)} className={'chip flex items-center justify-between py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : '')}>
                        <span className="text-sm font-semibold">{b.bezeichnung ? anzeigeName(b.bezeichnung) : 'Baustelle'}</span><span className="knr">{b.konto_nr}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Zum Nachschauen wie auf dem Papierzettel: alle aktiven Baustellen, das Suchfeld oben filtert mit */}
              <div className="border-t border-line pt-3">
                <button type="button" onClick={() => void listeUmschalten()} className="text-xs font-semibold text-steel">
                  {zeigeListe ? 'Liste zuklappen' : 'Alle Baustellen zeigen — zum Nachschauen'}
                </button>
                {zeigeListe && (alleBaustellen === null
                  ? <p className="mt-2 text-sm text-ink3">Lädt …</p>
                  : (() => {
                      const q = ziffern.trim();
                      const liste = q ? baustellenSuchen(alleBaustellen, q, alleBaustellen.length) : alleBaustellen;
                      return (
                        <div className="mt-2 max-h-80 divide-y divide-line overflow-y-auto rounded-[10px] border border-line bg-surface">
                          {liste.map((b) => (
                            <button key={b.id} type="button" onClick={() => andereWaehlen(b)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-ground">
                              <span className="min-w-0 truncate text-sm">{b.bezeichnung ? anzeigeName(b.bezeichnung) : 'Baustelle'}</span>
                              <span className="knr shrink-0">{b.konto_nr}</span>
                            </button>
                          ))}
                          {liste.length === 0 && (
                            <p className="p-3 text-sm text-ink3">{alleBaustellen.length === 0 ? 'Liste konnte nicht geladen werden — dafür braucht es Netz.' : `Nichts gefunden für «${ziffern.trim()}».`}</p>
                          )}
                        </div>
                      );
                    })())}
                {zeigeListe && alleBaustellen !== null && alleBaustellen.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-ink3">{alleBaustellen.length} aktive Baustellen, alphabetisch — oben tippen zum Filtern.</p>
                )}
              </div>
            </div>
          )}
          {/* Zweite Baustelle am selben Tag — in einem Durchgang statt zweimal melden */}
          {baustelle && !zweite && !wahlZweite && !abweichung && (
            <button type="button" onClick={() => { setWahlZweite(true); setZeigeAndere(true); setZiffern(''); }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong px-3 py-3 text-sm font-semibold text-steel active:bg-surface-2">
              <Plus size={16} strokeWidth={2.4} aria-hidden="true" /> Zweite Baustelle heute
            </button>
          )}
          {baustelle && zweite && (
            <div className="card mt-2 space-y-3 p-3">
              <p className="text-sm font-semibold text-ink">Zwei Baustellen heute</p>
              {[baustelle, zweite].map((b, i) => {
                const min = spannenMinuten(spannenTeilen(teamSpannen, [wechsel])[i] ?? []);
                return (
                  <div key={b.id} className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight">{anzeigeName(b.bezeichnung) || 'Baustelle'}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink3"><span className="knr">{b.konto_nr}</span>{i === 0 ? `bis ${uhrzeit(wechsel)}` : `ab ${uhrzeit(wechsel)}`}</span>
                    </span>
                    <span className={'font-mono text-sm tabular-nums ' + (min > 0 ? 'text-ink2' : 'font-semibold text-amber-deep')}>{min > 0 ? `${stunden(min)} h` : '0 h'}</span>
                    {i === 1
                      ? <button type="button" onClick={() => setZweite(null)} aria-label="Zweite Baustelle entfernen" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>
                      : <span className="w-9 shrink-0" aria-hidden="true" />}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-sm text-ink2">Wechsel um</span>
                <ZeitFeld wert={uhrzeitFeld(wechsel)} aendern={(t) => { const v = ausUhrzeit(t); if (v !== null) setWechsel(v); }} label="Wechselzeit" klasse="h-10 w-[5.4rem] rounded-[10px] border border-line bg-surface text-center font-mono text-[15px] font-semibold tabular-nums focus:border-accent focus:outline-none" />
                {[MITTAG_VON_MIN, NACHMITTAG_MIN].filter((v, i, a) => a.indexOf(v) === i && v !== wechsel).map((v) => (
                  <button key={v} type="button" onClick={() => setWechsel(v)} className="chip px-2.5 py-1.5 text-xs">{uhrzeit(v)}</button>
                ))}
              </div>
              <p className="text-[11px] text-ink3">Die Zeiten unten gelten für den ganzen Tag — die App teilt sie beim Wechsel auf die zwei Baustellen auf. Überstunden zählen über den ganzen Tag.</p>
            </div>
          )}
        </section>

        <section>
          <p className="lbl">Arbeitszeit — alle gleich</p>
          <div className="rounded-[14px] border border-line bg-surface p-3 shadow-[0_1px_2px_rgb(17_17_19/0.04)]">
            <SpannenEditor spannen={teamSpannen} setSpannen={setzeTeamSpannen} />
            {(() => {
              const t = aufteilen(spannenMinuten(teamSpannen), normaltagMin());
              return (
                <p className="mt-2 font-mono text-sm tabular-nums">
                  {teamSpannen.some(spanneVollstaendig) ? <>{stunden(t.normal_min + t.ueber_min)} h{spannenOffen(teamSpannen) === 'fehlt' ? <span className="font-semibold text-amber-deep"> · Nachmittag: «bis» fehlt noch</span> : t.ueber_min > 0 && <span className="font-semibold text-amber-deep"> · davon {stunden(t.ueber_min)} h Überstunden</span>}</> : <span className="text-ink3">«bis» eintragen</span>}
                </p>
              );
            })()}
            <p className="mt-1 text-[11px] text-ink3">
              {znueni().immer
                ? `Was hier steht, zählt. Die Pause ${uhrzeit(znueni().von)}–${uhrzeit(znueni().bis)} ist schon abgezogen, Mittag 12–13 ist als Lücke vorgegeben. Unten kann jede Person anders sein.`
                : `Die App zieht von sich aus keine Pause ab — was hier steht, zählt. Mittag 12–13 ist als Lücke vorgegeben. Zahlt der Bauherr die Pause ${uhrzeit(znueni().von)}–${uhrzeit(znueni().bis)} nicht: «− Pause» tippen. Unten kann jede Person anders sein.`}
            </p>
            <MittagHinweis spannen={teamSpannen} />
            {/* Zweite Meldung am Tag (oder ein Gast, den schon ein anderes Team gemeldet hat): der normale Tag ist schon belegt */}
            {dabei.some((p) => bisherVon(p.id) > 0) && (
              <p className="mt-1.5 rounded-[8px] bg-amber-soft px-2.5 py-1.5 text-[11px] text-amber-deep">
                An diesem Tag ist schon etwas gemeldet — was über den normalen Tag ({stunden(normaltagMin())} h) hinausgeht, zählt als Überstunden. Je Person steht es unten.
              </p>
            )}
          </div>
        </section>

        <section>
          <p className="lbl">Wer war dabei</p>
          <div className="card divide-y divide-line p-0">
            {alleImTeam.map((p) => {
              const a = anw[p.id];
              if (!a) return null;
              const w = wirksam(a, bisherVon(p.id));
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, dabei: !a.dabei } }))} aria-pressed={a.dabei} className={'grid h-10 w-10 flex-none place-items-center rounded-[10px] border transition active:scale-95 ' + (a.dabei ? 'border-good bg-good text-white shadow-[0_6px_14px_-8px_rgb(31_157_85/0.7)]' : 'border-line-strong bg-surface text-transparent')}>
                      <Check size={20} strokeWidth={2.6} />
                    </button>
                    <span className={'min-w-0 flex-1 truncate text-sm ' + (a.dabei ? 'font-medium' : 'text-ink3 line-through')}>
                      {p.name}
                      {p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                      {p.gast && <span className={'ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' + (p.eingeteilt ? 'bg-good-soft text-good-deep' : 'bg-steel-soft text-steel')}>{p.eingeteilt ? 'eingeteilt' : 'Gast'}</span>}
                    </span>
                    {abwesend[p.id] && <ArtPille art={abwesend[p.id]} />}
                    {versetzt[p.id] && <span className="whitespace-nowrap rounded-md bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-amber-deep">in {versetzt[p.id]}</span>}
                    {a.dabei && (
                      <>
                        <span className={'font-mono text-sm tabular-nums ' + (a.modus === 'zeit' && !a.zeiten.some(spanneVollstaendig) ? 'text-amber-deep' : 'text-ink2')}>{a.modus === 'zeit' && !a.zeiten.some(spanneVollstaendig) ? '– h' : `${stunden(w.min + w.ueber)} h`}</span>
                        {/* Anreise: nur Auto (km). öV ist ausgeblendet (OEV_AKTIV), bis geklärt ist, ob es ganz weg soll. */}
                        <button type="button" onClick={() => setAnreiseOffen(anreiseOffen === p.id ? null : p.id)} aria-label="Anreise" className={'grid h-10 min-w-10 place-items-center rounded-[10px] border px-1.5 text-[11px] ' + (a.oev || a.km > 0 ? 'border-steel/40 bg-steel-soft text-steel' : 'border-line bg-surface text-ink3')}>{a.oev ? 'öV' : a.km > 0 ? `${a.km} km` : <Car size={16} />}</button>
                      </>
                    )}
                    {p.gast && (
                      <button type="button" onClick={() => gastEntfernen(p.id)} aria-label={`${p.name} entfernen`} className="grid h-10 w-8 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>
                    )}
                  </div>
                  {a.dabei && (
                    <div className="mt-2">
                      <div className="flex items-start gap-2">
                        <SpannenEditor klein spannen={a.zeiten} setSpannen={(z) => setAnw((s) => ({ ...s, [p.id]: { ...a, zeiten: z } }))} />
                        {ueberFertig(a, bisherVon(p.id)) > 0 && <span className="ml-auto shrink-0 pt-2 text-[11px] font-semibold text-amber-deep">{stunden(w.ueber)} h über</span>}
                      </div>
                      <MittagHinweis spannen={a.zeiten} />
                    </div>
                  )}
                  {anreiseOffen === p.id && a.dabei && (
                    <div className="mt-2 flex items-center gap-2 pl-10">
                      {OEV_AKTIV && <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, oev: !a.oev, km: a.oev ? a.km : 0 } }))} className={'chip px-3 py-1.5 text-xs ' + (a.oev ? 'chip-on' : '')}>öV</button>}
                      <span className="text-[11px] text-ink3">Auto</span>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: Math.max(0, a.km - 5), oev: false } }))} className="btn-ghost px-2" aria-label="weniger km">−</button>
                      <span className="font-mono text-xs tabular-nums">{a.km} km</span>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: a.km + 5, oev: false } }))} className="btn-ghost px-2" aria-label="mehr km">+</button>
                    </div>
                  )}
                </div>
              );
            })}
            {alleImTeam.length === 0 && <p className="p-3 text-sm text-ink3">{laedtTeam ? 'Lädt …' : 'Keine Mitglieder in diesem Team.'}</p>}
          </div>

          {/* Jemand hilft heute mit, der nicht zum Team gehört (Bauführer 20.09.). Aus der Mitarbeiterliste, nie frei eingetippt. */}
          <button type="button" onClick={() => { setZeigeGast((v) => !v); void alleLeuteLaden(); }} className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 py-2.5 text-sm" aria-expanded={zeigeGast}>
            <UserPlus size={16} /> Person hinzufügen
          </button>
          {zeigeGast && (
            <div className="card mt-2 space-y-2 p-3">
              {zuletztGaesteFrei.length > 0 && (
                <div>
                  <p className="lbl">Zuletzt dabei</p>
                  <div className="flex flex-wrap gap-1.5">
                    {zuletztGaesteFrei.map((p) => (
                      <button key={p.id} type="button" onClick={() => gastHinzufuegen(p)} className="chip px-3 py-2 text-sm">{p.name}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Ausnahme für den Chefmonteur wie bei der Konto-Nr.: Name tippen, ab 2 Buchstaben bis zu 5 Treffer */}
              <div className={zuletztGaesteFrei.length > 0 ? 'border-t border-line pt-3' : ''}>
                <p className="lbl">Name tippen (nur Chefmonteur)</p>
                <input
                  type="text"
                  autoComplete="off"
                  autoFocus={zuletztGaesteFrei.length === 0}
                  value={gastFilter}
                  onChange={(e) => setGastFilter(e.target.value)}
                  placeholder="z. B. Mu"
                  aria-label="Name"
                  className="field mb-2"
                />
                {alleLeute === null
                  ? <p className="text-[11px] text-ink3">Lädt …</p>
                  : gastFilter.trim().length < 2
                    ? <p className="text-[11px] text-ink3">Ab 2 Buchstaben werden Personen gezeigt.</p>
                    : gastTreffer.length === 0 && <p className="text-[11px] text-ink3">Niemand mit «{gastFilter.trim()}» gefunden — oder schon in der Liste.</p>}
                {gastTreffer.length > 0 && (
                  <div className="grid gap-2">
                    {gastTreffer.map((p) => (
                      <button key={p.id} type="button" onClick={() => gastHinzufuegen(p)} className="chip flex items-center justify-between py-2.5 text-left">
                        <span className="text-sm font-semibold">{p.name}</span>
                        <span className="text-[10px] text-ink3">{p.typ === 'temporaer' ? 'temp' : p.funktion}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Lieferwagen (0036, Arbnor 10.10.2026): Subunternehmer tippen an, ob sie den Lieferwagen der Firma heute hatten — Fr. 100 pro Tag. */}
        {mitExternen && (
          <button
            type="button"
            role="checkbox"
            aria-checked={lieferwagen}
            onClick={() => setLieferwagen((v) => !v)}
            className={'card flex w-full items-center gap-3 text-left transition ' + (lieferwagen ? 'border-good/40 bg-good-soft/40' : '')}
          >
            <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-2 transition ' + (lieferwagen ? 'border-good bg-good text-white' : 'border-line bg-surface text-transparent')}>
              <Check size={20} strokeWidth={3} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Truck size={16} className="text-steel" aria-hidden="true" /> Lieferwagen der Firma gebraucht</span>
              <span className="mt-0.5 block text-[11px] text-ink3">Nur antippen, wenn ihr ihn heute hattet — {`Fr. ${((lieferwagenPreis ?? 0) / 100).toFixed(0)}`} pro Tag.</span>
            </span>
          </button>
        )}

        {/* Bemerkung zum Tag: die Sprachnotiz ist immer da (Bauführer 20.09.), bei Überstunden Pflicht — kein eigener Bildschirm. */}
        <section ref={notizRef} className={'card space-y-2.5 ' + (ueberTotal > 0 ? 'border-amber/30' : '')}>
            <p className="flex items-start justify-between gap-3 text-sm font-semibold">
              <span>{ueberTotal > 0 ? <>{ueberText()} — kurz sagen, warum</> : 'Bemerkung zum Tag — freiwillig'}</span>
              {notizFehltNoch(notizNoetig(ueberMax))
                ? <span className="mt-px shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">Pflicht</span>
                : ueberTotal > 0 && !notizNoetig(ueberMax) && !ueberAufnahme && <span className="mt-px shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink3">freiwillig</span>}
            </p>
            {/* «War das Regie?» steht nicht mehr hier (Amir 13.10.2026: «ein bisschen verwirrend») — die App fragt einmal beim Melden */}
            <div key={stupser} className={'relative rounded-[12px] border-2 border-dashed p-4 text-center ' + (nimmtAuf ? 'border-accent bg-accent-soft' : ueberAufnahme ? 'border-good/50 bg-good-soft/40' : fehltAnzeige ? 'notiz-stupser border-transparent bg-steel-soft' : 'border-steel bg-steel-soft')}>
              {fehltAnzeige && <LaufStrich r={12} />}
              {ueberAufnahme ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Sprachnotiz · {ueberAufnahme.sekunden} Sek. ✓</p>
                  <audio controls src={aufnahmeUrl} className="mx-auto h-9 w-full max-w-xs" />
                  <TranskriptPruefung
                    vorschau={ueberVorschau}
                    aendern={(t) => setUeberVorschau((v) => (v ? { ...v, text: t } : v))}
                    bestaetigen={() => void originalBestaetigen()}
                  />
                  <button type="button" onClick={() => { setUeberAufnahme(null); setUeberVorschau(null); }} className="btn-ghost">nochmal aufnehmen</button>
                </div>
              ) : (
                <button type="button" onClick={() => (nimmtAuf ? aufnahmeStop() : void aufnahmeStart())} className="w-full">
                  <span className={'mx-auto grid h-14 w-14 place-items-center rounded-full ' + (nimmtAuf ? 'aufnahme-ring bg-accent text-white' : 'bg-surface text-steel ring-1 ring-line-strong')}>
                    <svg viewBox="0 0 40 48" className="h-7 w-6" aria-hidden="true" fill="currentColor">
                      <rect x="13" y="4" width="14" height="24" rx="7" />
                      <path d="M8 22a12 12 0 0 0 24 0" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                      <rect x="18.2" y="34" width="3.6" height="8" rx="1.8" />
                    </svg>
                  </span>
                  {nimmtAuf && <span className="mt-2 block"><Pegel stream={mikroStream} /></span>}
                  <span className="mt-2 block text-sm font-semibold">{nimmtAuf ? `${sekunden} Sek. — antippen zum Stoppen` : ueberTotal > 0 ? 'Antippen und kurz erzählen, warum' : 'Antippen und kurz erzählen, was heute war'}</span>
                  <span className={'mt-0.5 block text-xs ' + (fehltAnzeige ? 'font-semibold text-accent-deep' : 'text-ink3')}>{mikroFehlt ? 'Mikrofon nicht verfügbar — Speichern geht trotzdem.' : fehltAnzeige ? 'Fehlt noch — 10 Sekunden reichen, dann nochmals «Tag melden».' : `Auf ${sprachName} sprechen, 10 Sekunden reichen — der Bauführer liest es auf Deutsch.`}</span>
                </button>
              )}
              {!ueberAufnahme && !nimmtAuf && team?.chefmonteur?.id && <SprachWahl sprache={sprecherSprache} setzen={(c) => void sprecherSpracheSetzen(c)} />}
            </div>
            <p className="text-xs text-ink3">{ueberTotal > 0
              ? modus === 'regie'
                ? 'Der Bauführer sieht die Überstunden mit deiner Notiz. Beim Melden fragt die App, ob es Regie war.'
                : 'Der Bauführer sieht die Überstunden mit deiner Notiz und gibt sie frei.'
              : 'Der Bauführer liest die Notiz in der Wochenübersicht — z. B. Material fehlt, Kunde war da, früher Schluss.'}</p>
        </section>

        {fotoLeiste('Foto vom Stand heute — freiwillig, hilft dem Bauführer.')}

        {doppelt && (
          <section className="card space-y-3 border-amber/40 bg-amber-soft">
            <p className="text-sm">
              <strong>{istHeute ? 'Heute' : 'An diesem Tag'} habt ihr schon gemeldet: {doppelt.baustellen.map(anzeigeName).join(', ')}</strong>
              {' '}— {stunden(doppelt.bisherMin)} h für das Team zusammen.
            </p>
            {/* «Ersetzen» nur, wenn der Server bestätigt, dass jede frühere Meldung noch unberührt ist (lib/ersetzen.ts) */}
            {doppelt.gruende === null ? (
              <>
                <p className="text-sm text-ink2">Prüfe, ob die frühere Meldung noch ersetzt werden kann …</p>
                <button type="button" disabled={speichert} className="btn-ghost w-full py-2.5 text-sm disabled:opacity-70" onClick={() => void speichern('zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle) · dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h
                </button>
              </>
            ) : doppelt.gruende.length === 0 ? (
              <>
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern('ersetzen')}>
                  Frühere ersetzen
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.neuMin)} h (Team zusammen).</span>
                </button>
                <button type="button" disabled={speichert} className="btn-ghost w-full py-2.5 text-sm disabled:opacity-70" onClick={() => void speichern('zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle) · dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h
                </button>
              </>
            ) : (
              <>
                <div className="space-y-1 text-sm text-ink2">
                  <p className="font-semibold text-ink">Ersetzen geht hier nicht mehr:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {doppelt.gruende.map((g) => <li key={g}>{g}</li>)}
                  </ul>
                  <p>Änderungen an der früheren Meldung macht der Bauführer in der Wochenübersicht.</p>
                </div>
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern('zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle)
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h (Team zusammen).</span>
                </button>
              </>
            )}
            <button type="button" className="btn-ghost w-full py-2.5 text-sm" onClick={() => setDoppelt(null)}>Abbrechen</button>
          </section>
        )}

        {regieFrage ? (
          <section ref={regieFrageRef} className="card space-y-3 border-amber/40 bg-amber-soft" role="alertdialog" aria-labelledby="regie-frage">
            <p id="regie-frage" className="text-[17px] font-semibold leading-snug text-ink">{ueberText()} — war das Regie?</p>
            <p className="-mt-1 text-sm text-ink2">Regie = Arbeit, die der Kunde zusätzlich wollte.</p>
            <button type="button" disabled={speichert} className="cta py-4 text-[16px] disabled:opacity-70" onClick={() => { setRegieAntwort('ja'); abweichungStarten('zusaetzlich'); }}>
              Ja, Regie ausgeführt
            </button>
            <button type="button" disabled={speichert} className="btn-ghost w-full py-3 text-sm disabled:opacity-70" onClick={() => { setRegieAntwort('nein'); setRegieFrage(false); void speichern(); }}>
              Nein, nur länger gearbeitet
            </button>
          </section>
        ) : (
          <button
            type="button"
            disabled={speichert}
            onClick={() => {
              // Zuerst die Sprachnotiz — noch vor der Frage «War das Regie?» (13.10.2026)
              if (notizPflichtPruefen(notizNoetig(ueberMax))) return;
              if (modus === 'regie' && ueberTotal > 0) {
                if (regieAntwort === 'ja') { abweichungStarten('zusaetzlich'); return; }
                if (regieAntwort === null) { setRegieFrage(true); return; }
              }
              void speichern();
            }}
            className="cta cta-good py-5 text-[17px] disabled:opacity-70"
          >
            <span className="inline-flex items-center gap-2">{gespeichert ? gespeichert : <><CheckCircle2 size={22} strokeWidth={2.2} aria-hidden="true" /> {modus === 'regie' && ueberTotal > 0 && regieAntwort === 'ja' ? 'Weiter zur Regie' : 'Tag melden'}</>}</span>
            {!gespeichert && notizFehltNoch(notizNoetig(ueberMax)) && <span className="mt-0.5 block text-xs font-normal opacity-90">Zuerst die Sprachnotiz — bei Überstunden Pflicht</span>}
          </button>
        )}
        {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}

      </div>
    </Shell>
  );
}
