import { Check, CheckCircle2, ChevronLeft, ChevronRight, Flag, Car, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Pegel, TranskriptLive } from '../ui/Sprachnotiz';
import { supabase } from '../lib/supabase';
import { enqueueMeldung, flushNachSupabase, offeneMeldungen, offeneAnzahl, lokaleMeldungEntfernen, type MeldungPayload } from '../lib/db';
import { addTage, iso, lang, stunden, NORMALTAG_MIN } from '../lib/datum';
import { fotoVerkleinern } from '../lib/foto';
import { kennzeichen } from '../lib/fahrzeug';
import { MAX_SPANNEN, NACHMITTAG_MIN, ausUhrzeit, aufteilen, mittagMinuten, spanneVollstaendig, spannenMinuten, spannenUeberlappen, standardSpannen, uhrzeitFeld, zeitenText, zuSpalten, type Spanne } from '../lib/zeiten';

/**
 * Phase 2 — das Teamgerät. Ein Chefmonteur meldet für sein Team.
 *
 * Wenig Schritte: Baustelle, wer war dabei, von wann bis wann — ein Knopf.
 * Überstunden brauchen eine Sprachnotiz (warum); der Bauführer liest sie in der Wochenübersicht und gibt frei.
 * Es wird nie gefragt, WARUM-Kategorien oder ob etwas verrechnet wird — das entscheidet der Bauführer in SORBA (Entscheid 17.09./20.09.).
 *
 * Seit 20.09. abends gibt es **nur Zeiten von–bis** (Amir: «nimm die Stundenzahl weg, nur Zeiten eingeben»).
 * Die Stundenzahl als Eingabe, der Umschalter und die Normal/Über-Felder je Person sind raus; Normal und
 * Überstunden rechnet die App aus den Zeiten (ohne Pausenrechnung, `src/lib/zeiten.ts`).
 * Weiter vom 20.09.: Sprachnotiz immer als Bemerkung zum Tag, Personen von ausserhalb des Teams hinzufügen,
 * nur Auto (kein öV).
 */

interface Team { id: string; bezeichnung: string; fahrzeug: string | null }
interface Person { id: string; name: string; typ: string; funktion: string; oev_standard: boolean; km_standard: number; /** heute dabei, aber nicht fest im Team */ gast?: boolean }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null }
/**
 * Anwesenheit einer Person: die Zeiten von–bis, dazu die Anreise.
 * Normal- und Überstunden werden daraus gerechnet (`aufteilen`), nie getippt — seit 20.09. gibt es
 * die Stundenzahl als Eingabe nicht mehr (Amir: «nur Zeiten eingeben»).
 */
interface Anwesenheit { dabei: boolean; oev: boolean; km: number; zeiten: Spanne[] }

type Schritt = 'team' | 'tag' | 'fertig';
/** Nur noch für alte Meldungen (vor 17.09.) — neue Meldungen sind immer normalfall. */
type Abweichung = 'zusaetzlich' | 'warten' | 'kaputt' | 'laenger';

const TEAM_KEY = 'teamgeraet-team-id';
/** Zuletzt gewählte Teams auf diesem Gerät (max. 5, neuestes vorne) — damit die Teamwahl nie mehr als 5 Kacheln braucht (Regel 3). */
const ZULETZT_KEY = 'teamgeraet-zuletzt';
const STANDARD_MIN = NORMALTAG_MIN;
/** Nur Auto (Bauführer 20.09.: «Nur auto») — öV bleibt im Datenmodell, ist in der Erfassung aber ausgeblendet, bis geklärt ist, ob es ganz weg soll. */
const OEV_AKTIV = false;
/** Zuletzt hinzugefügte Personen je Team (max. 5) — wer letzte Woche mitgeholfen hat, ist mit einem Tipp wieder da. */
const GAESTE_KEY = 'teamgeraet-gaeste-';

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

/** Alle eingetragenen Zeiten haben ein «bis» — sonst fehlt etwas und es wird nicht gespeichert (Regel: nichts raten). */
function zeitenVollstaendig(zeiten: Spanne[]): boolean {
  return zeiten.length > 0 && zeiten.every(spanneVollstaendig);
}

function neueAnwesenheit(p: Person, spannen: Spanne[]): Anwesenheit {
  return { dabei: true, oev: OEV_AKTIV && p.oev_standard, km: p.km_standard, zeiten: spannen.map((s) => ({ ...s })) };
}

/** Was für die Person zählt: die Summe der Zeiten (ohne Pausenrechnung), aufgeteilt in Normal und Über. */
function wirksam(a: Anwesenheit): { min: number; ueber: number } {
  const t = aufteilen(spannenMinuten(a.zeiten));
  return { min: t.normal_min, ueber: t.ueber_min };
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
}
type SpeicherModus = 'normal' | 'ersetzen' | 'zusaetzlich';
const AB_KURZ: Record<Abweichung, string> = { zusaetzlich: 'zusätzlich', warten: 'gewartet', kaputt: 'repariert', laenger: 'länger' };

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
 * Zeiten von–bis: eine oder zwei Spannen (Vormittag, Nachmittag). Native Uhrzeit-Wahl statt Tastatur (Regel 2).
 * Kein Pausenabzug — die App zählt, was dasteht; der Mittag 12–13 (unbezahlt) ist als Lücke vorgegeben.
 */
function SpannenEditor({ spannen, setSpannen, klein = false }: { spannen: Spanne[]; setSpannen: (s: Spanne[]) => void; klein?: boolean }) {
  const feld = 'rounded-[10px] border bg-surface text-center font-mono font-semibold tabular-nums focus:border-accent focus:outline-none ' + (klein ? 'h-10 w-[5.9rem] text-[14px]' : 'h-12 w-28 text-lg');
  const aendern = (i: number, teil: 'von' | 'bis', text: string) => {
    const v = ausUhrzeit(text);
    setSpannen(spannen.map((s, j): Spanne => (j !== i ? s : teil === 'von' ? { ...s, von: v ?? s.von } : { ...s, bis: v })));
  };
  return (
    <div className="space-y-1.5">
      {spannen.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {spannen.length > 1 && <span className={'shrink-0 text-[10px] leading-tight text-ink3 ' + (klein ? 'w-10' : 'w-14')}>{klein ? (i === 0 ? 'Vorm.' : 'Nachm.') : i === 0 ? 'Vormittag' : 'Nachmittag'}</span>}
          <input type="time" step={300} value={uhrzeitFeld(s.von)} onChange={(e) => aendern(i, 'von', e.target.value)} aria-label="von" className={feld + ' border-line'} />
          <span className="text-ink3">–</span>
          <input type="time" step={300} value={uhrzeitFeld(s.bis)} onChange={(e) => aendern(i, 'bis', e.target.value)} aria-label="bis" className={feld + (s.bis === null ? ' border-amber/70' : ' border-line')} />
          {i > 0 && <button type="button" onClick={() => setSpannen(spannen.filter((_, j) => j !== i))} aria-label="Zeit entfernen" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>}
        </div>
      ))}
      {spannen.length < MAX_SPANNEN && (
        <button type="button" onClick={() => setSpannen([...spannen, { von: Math.max(NACHMITTAG_MIN, spannen[spannen.length - 1]?.bis ?? 0), bis: null }])} className="text-xs font-semibold text-steel">
          + Nachmittag
        </button>
      )}
    </div>
  );
}

export function Erfassung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [leute, setLeute] = useState<Person[]>([]);
  const [kacheln, setKacheln] = useState<Baustelle[]>([]);
  const [alleGeplanten, setAlleGeplanten] = useState<Baustelle[]>([]);
  // /erfassung?baustelle=wahl öffnet direkt «andere Baustelle …» (Sprung von der Chefmonteur-Startseite)
  const [zeigeAndere, setZeigeAndere] = useState(() => new URLSearchParams(window.location.search).get('baustelle') === 'wahl');
  // Baustellensuche ohne Tastatur (Regel 2): Konto-Nr. über den Ziffernblock, ab 3 Ziffern wird gesucht
  const [ziffern, setZiffern] = useState('');
  const [suchTreffer, setSuchTreffer] = useState<Baustelle[]>([]);
  const [laedtTeam, setLaedtTeam] = useState(false);
  const [zuletzt, setZuletzt] = useState<string[]>(zuletztLesen);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(null);
  const [anw, setAnw] = useState<Record<string, Anwesenheit>>({});
  const [anreiseOffen, setAnreiseOffen] = useState<string | null>(null);
  /** Welche Person gerade ihre Zeiten von Hand ändert — sonst steht nur die Zeile da. */
  const [zeitenOffen, setZeitenOffen] = useState<string | null>(null);
  // Zeiten von–bis fürs ganze Team — die Zeilen darunter können je Person abweichen
  const [teamSpannen, setTeamSpannen] = useState<Spanne[]>(standardSpannen());
  // Personen, die heute mithelfen, aber nicht fest zum Team gehören (Bauführer 20.09.: «Mitarbeiter hinzufüge»)
  const [gaeste, setGaeste] = useState<Person[]>([]);
  const [zeigeGast, setZeigeGast] = useState(false);
  const [gastFilter, setGastFilter] = useState('');
  const [alleLeute, setAlleLeute] = useState<Person[] | null>(null);
  const [zuletztGaeste, setZuletztGaeste] = useState<Person[]>([]);
  // Über die Startseite (/erfassung?wahl) immer zuerst das Team zeigen — zum Testen mehrerer Teams im selben Browser.
  // Das Teamgerät selbst öffnet /erfassung ohne Parameter und landet direkt beim Tag.
  const [schritt, setSchritt] = useState<Schritt>(teamId && !new URLSearchParams(window.location.search).has('wahl') ? 'tag' : 'team');
  // Überstunden: Sprachnotiz als Warum (Pflicht, ausser das Mikrofon fehlt) — hängt an der Tagesmeldung
  const [mikroFehlt, setMikroFehlt] = useState(false);
  const [ueberAufnahme, setUeberAufnahme] = useState<{ blob: Blob; sekunden: number } | null>(null);
  type Vorschau = { status: 'laeuft' | 'fertig' | 'fehler'; text: string; quelle: string | null; sprache: string; grund?: string };
  // Text der Sprachnotiz — entsteht sofort nach der Aufnahme, der Chefmonteur prüft ihn VOR dem Speichern
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
      const { data, error } = await supabase.functions.invoke('transkribieren', { body: { audio_base64: b64, mime: blob.type || 'audio/webm', team_id: teamId } });
      if (error || !data?.transkript) throw new Error(data?.fehler ?? error?.message ?? 'kein Text');
      setV({ status: 'fertig', text: data.transkript, quelle: data.quelle ?? null, sprache: data.sprache ?? 'de' });
    } catch (e) {
      setV({ status: 'fehler', text: '', quelle: null, sprache: 'de', grund: 'Text konnte jetzt nicht erstellt werden — er kommt nach dem Senden. ' + (e instanceof Error ? e.message : '') });
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

  /** Kamera-Knopf + Vorschau. Ein Element für Normalfall und Abweichung. */
  function FotoLeiste({ text }: { text: string }) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          {fotos.map((f) => (
            <span key={f.id} className="relative h-16 w-16 overflow-hidden rounded-[8px] border border-line">
              <img src={f.url} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => fotoEntfernen(f.id)} aria-label="Foto entfernen" className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-ink/80 text-[11px] font-semibold leading-5 text-white">×</button>
            </span>
          ))}
          <label className={'flex h-16 min-w-16 cursor-pointer items-center justify-center gap-2 rounded-[8px] border-2 border-dashed px-3 text-sm font-semibold ' + (fotos.length === 0 ? 'border-steel bg-steel-soft text-steel' : 'border-line-strong text-ink2')}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            {fotoLaedt ? '…' : fotos.length === 0 ? 'Foto' : '+'}
            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { void fotosHinzufuegen(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-ink3">{text}</p>
      </div>
    );
  }
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [sekunden, setSekunden] = useState(0);
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  // Sperre gegen Doppeltippen: das Beenden der Aufnahme dauert eine Sekunde, ein zweiter Tipp darf nichts auslösen
  const [speichert, setSpeichert] = useState(false);
  const speichertRef = useRef(false);
  // Längere Rückmeldung nach dem Speichern (z. B. «normaler Tag 8.0 h + 1.0 h zusätzlich») — eigene Zeile, nicht im Knopf
  const [bestaetigung, setBestaetigung] = useState<string | null>(null);
  // Abschluss-Seite nach dem Speichern: was steht jetzt für den Tag, und wohin jetzt?
  const [fertig, setFertig] = useState<{ text: string; stand: 'gesendet' | 'wartet' | 'fehler'; notizUuid?: string } | null>(null);
  const [hinweis, setHinweis] = useState('');
  const [heuteGemeldet, setHeuteGemeldet] = useState<Gemeldet[]>([]);
  // An diesem Tag schon eine Normalmeldung (egal welche Baustelle) → erst nachfragen, statt still eine zweite anzulegen
  const [doppelt, setDoppelt] = useState<{ baustellen: string[]; bisherMin: number; ersetzbarMin: number; ersetzbar: number; neuMin: number } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [wartend, setWartend] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const [mikroStream, setMikroStream] = useState<MediaStream | null>(null);
  const ticker = useRef<number | null>(null);
  /** Wer beim Speichern noch aufnimmt, verliert nichts: die Aufnahme wird beendet und mitgenommen. */
  const aufnahmeFertig = useRef<((a: { blob: Blob; sekunden: number } | null) => void) | null>(null);

  const heute = new Date();
  const heuteIso = iso(heute);
  // Gemeldet wird für einen Tag — normalerweise heute. Vergessen? Bis 7 Tage zurück nachtragen.
  // /erfassung?tag=JJJJ-MM-TT öffnet einen bestimmten Tag zum Nachtragen (max. 7 Tage zurück, nie in der Zukunft)
  const [datum, setDatum] = useState<Date>(() => {
    const t = new URLSearchParams(window.location.search).get('tag');
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const d = new Date(t + 'T12:00:00');
      const jetzt = new Date();
      const grenze = addTage(jetzt, -7);
      if (!Number.isNaN(d.getTime()) && d <= jetzt && d >= grenze) return d;
    }
    return new Date();
  });
  const tagIso = iso(datum);
  const istHeute = tagIso === heuteIso;
  const fruehesterIso = iso(addTage(heute, -7));
  const team = teams.find((t) => t.id === teamId) ?? null;

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung,fahrzeug').eq('aktiv', true).order('bezeichnung').then(({ data }) => {
      if (!data) return;
      setTeams(data);
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

  /** Lädt, was für Team + Tag schon gemeldet ist (lokal + Server), setzt den Zustand und gibt die Liste zurück (für Prüfungen vor dem Speichern). */
  const heutigeLaden = useCallback(async (): Promise<Gemeldet[]> => {
    if (!teamId) return [];
    const bekannt = kacheln.concat(alleGeplanten, suchTreffer);
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
      };
    });
    if (supabase) {
      try {
        const { data } = await supabase.from('tagesmeldung').select('id,normalfall,abweichung_typ,baustelle_id,baustelle:baustelle_id(konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,status)').eq('team_id', teamId).eq('datum', tagIso).order('erfasst_am');
        type Zeile = { id: string; normalfall: boolean; abweichung_typ: Abweichung | null; baustelle_id: string; baustelle: { konto_nr: string; bezeichnung: string | null } | null; zeiteintrag: { normal_min: number; ueber_min: number; status: string }[] };
        for (const d of (data ?? []) as unknown as Zeile[]) {
          liste.push({
            bezeichnung: d.baustelle?.bezeichnung ?? (d.baustelle?.konto_nr ? `Konto-Nr. ${d.baustelle.konto_nr}` : 'Baustelle'), konto_nr: d.baustelle?.konto_nr ?? '', baustelle_id: d.baustelle_id,
            normalfall: d.normalfall, abweichung_typ: d.abweichung_typ, lokal: false, schluessel: d.id,
            freigegeben: d.zeiteintrag.some((z) => z.status === 'freigegeben'),
            min: d.zeiteintrag.reduce((s, z) => s + z.normal_min + z.ueber_min, 0),
            personen: d.zeiteintrag.length,
          });
        }
      } catch {
        // ohne Netz bleibt die lokale Sicht — mehr wissen wir nicht
      }
    }
    setHeuteGemeldet(liste);
    return liste;
  }, [teamId, tagIso, kacheln, alleGeplanten, suchTreffer]);

  // Team gewählt → Leute, Kacheln (Plan + zuletzt), Vorbelegung
  useEffect(() => {
    if (!supabase || !teamId) return;
    const client = supabase;
    setLaedtTeam(true);
    setLeute([]); setKacheln([]); setAlleGeplanten([]); setBaustelle(null); setZiffern(''); setSuchTreffer([]);
    setGaeste([]); setZeigeGast(false); setGastFilter('');
    void (async () => {
      try {
      const { data: mg } = await client
        .from('team_mitglied')
        .select('mitarbeiter:mitarbeiter_id(id,name,typ,funktion,oev_standard,km_standard,aktiv)')
        .eq('team_id', teamId)
        .is('bis', null);
      const personen = ((mg ?? []) as unknown as { mitarbeiter: Person & { aktiv: boolean } }[])
        .map((r) => r.mitarbeiter)
        .filter((p) => p && p.aktiv)
        .sort((a, b) => a.name.localeCompare(b.name));
      setLeute(personen);
      const a: Record<string, Anwesenheit> = {};
      for (const p of personen) a[p.id] = neueAnwesenheit(p, standardSpannen());
      setAnw(a);
      setTeamSpannen(standardSpannen());

      // Zuletzt auf diesem Gerät hinzugefügte Gäste — nur die, die es noch gibt und die nicht inzwischen fest im Team sind
      const gastIds = gaesteLesen(teamId).filter((id) => !personen.some((p) => p.id === id));
      if (gastIds.length > 0) {
        const { data: g } = await client.from('mitarbeiter').select('id,name,typ,funktion,oev_standard,km_standard').in('id', gastIds).eq('aktiv', true);
        const gefunden = (g ?? []) as Person[];
        setZuletztGaeste(gastIds.map((id) => gefunden.find((p) => p.id === id)).filter((p): p is Person => !!p));
      } else setZuletztGaeste([]);

      const [plan, zuletzt] = await Promise.all([
        client.from('jahresplan').select('von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).order('von'),
        client.from('tagesmeldung').select('datum,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).gte('datum', iso(addTage(heute, -14))).order('datum', { ascending: false }).limit(40),
      ]);
      const gesehen = new Set<string>();
      const tiles: Baustelle[] = [];
      const push = (b: Baustelle | null) => { if (b && !gesehen.has(b.id) && tiles.length < 4) { gesehen.add(b.id); tiles.push(b); } };
      for (const z of (zuletzt.data ?? []) as unknown as { baustelle: Baustelle | null }[]) push(z.baustelle);
      const planRows = (plan.data ?? []) as unknown as { von: string; bis: string; baustelle: Baustelle | null }[];
      for (const p of planRows) if (p.von <= heuteIso && p.bis >= heuteIso) push(p.baustelle);
      for (const p of planRows) push(p.baustelle);
      setKacheln(tiles);
      setAlleGeplanten(planRows.map((p) => p.baustelle).filter((b): b is Baustelle => !!b));
      setBaustelle(tiles[0] ?? null);
      } catch {
        setHinweis('Team konnte nicht geladen werden — Netz prüfen und nochmals versuchen.');
      } finally {
        setLaedtTeam(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => { void heutigeLaden(); }, [heutigeLaden]);

  /** Baustelle aus «andere Baustelle …» übernehmen: wird die erste Kachel oben (markiert), das Suchfeld geht zu. */
  const [gesuchtId, setGesuchtId] = useState<string | null>(null);
  function andereWaehlen(b: Baustelle) {
    setGesuchtId(b.id);
    setBaustelle(b);
    setKacheln((k) => [b, ...k.filter((x) => x.id !== b.id)].slice(0, 5));
    setZeigeAndere(false);
    setZiffern('');
    setSuchTreffer([]);
  }

  // Ausnahme für den Chefmonteur: Konto-Nr. über den Ziffernblock, falls die Kacheln nicht reichen (ab 3 Ziffern, max. 5 Treffer).
  // Volle Nummer mit genau einem Treffer → direkt übernehmen, ohne zweiten Tipp.
  useEffect(() => {
    if (!supabase || ziffern.length < 3) { setSuchTreffer([]); return; }
    const client = supabase;
    const q = ziffern;
    const t = setTimeout(() => {
      void client.from('baustelle').select('id,konto_nr,bezeichnung').like('konto_nr', `${q}%`).order('konto_nr').limit(5).then(({ data }) => {
        if (!data) return;
        if (q.length >= 6 && data.length === 1 && data[0].konto_nr === q) { andereWaehlen(data[0]); return; }
        setSuchTreffer(data);
      });
    }, 150);
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
  const ueberTotal = dabei.reduce((s, p) => s + wirksam(anw[p.id]).ueber, 0);

  /** Die Team-Zeiten oben setzen alle Personen gleich; die Zeile darunter kann jede Person ändern. */
  function setzeTeamSpannen(s: Spanne[]) {
    setTeamSpannen(s);
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, { ...a, zeiten: s.map((x) => ({ ...x })) }])));
  }

  // Gäste: Personen ausserhalb des Teams. Liste wird erst geladen, wenn der Knopf gedrückt wird.
  async function alleLeuteLaden() {
    if (!supabase || alleLeute) return;
    const { data } = await supabase.from('mitarbeiter').select('id,name,typ,funktion,oev_standard,km_standard').eq('aktiv', true).order('name');
    setAlleLeute((data ?? []) as Person[]);
  }
  function gastHinzufuegen(p: Person) {
    if (alleImTeam.some((x) => x.id === p.id)) return;
    const g: Person = { ...p, gast: true };
    setGaeste((alt) => [...alt, g]);
    setAnw((alt) => ({ ...alt, [p.id]: neueAnwesenheit(p, teamSpannen) }));
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

  /** Frühere Normal-Meldungen des Teams an diesem Tag entfernen (alle Baustellen) — lokal und auf dem Server, nur solange nichts freigegeben ist. */
  async function fruehereEntfernen(liste: Gemeldet[]) {
    const alte = liste.filter((m) => m.normalfall && !m.freigegeben);
    for (const m of alte) {
      if (m.lokal) { await lokaleMeldungEntfernen(m.schluessel); continue; }
      if (!supabase) continue;
      await supabase.from('zeiteintrag').delete().eq('tagesmeldung_id', m.schluessel).eq('status', 'offen');
      await supabase.from('tagesmeldung').delete().eq('id', m.schluessel);
    }
  }

  /** Meldung für die gewählte Baustelle bauen: alle Anwesenden, Normal- und Überstunden wie eingestellt; die Sprachnotiz als Bemerkung zum Tag (bei Überstunden Pflicht). */
  function meldungBauen(b: Baustelle, notiz: { blob: Blob; sekunden: number } | null): MeldungPayload {
    const nz = notiz;
    const vs = ueberVorschau;
    const textOk = !!nz && vs?.status === 'fertig' && !!vs.text.trim();
    return {
      id: crypto.randomUUID(), team_id: teamId!, datum: tagIso, baustelle_id: b.id,
      normalfall: true, abweichung_typ: null, wer_hats_gewollt: null,
      audio_sekunden: nz?.sekunden ?? null, erfasst_von: userId,
      // geprüfter Text (ggf. vom Chefmonteur korrigiert) geht mit — sonst erstellt der Server ihn nach dem Upload
      transkript: textOk ? vs!.text.trim() : null,
      transkript_quelle: textOk ? vs!.quelle : null,
      transkript_sprache: textOk ? vs!.sprache : null,
      eintraege: dabei.map((p) => {
        const a = anw[p.id];
        const w = wirksam(a);
        return {
          id: crypto.randomUUID(), mitarbeiter_id: p.id,
          normal_min: Math.min(w.min, STANDARD_MIN), ueber_min: Math.max(0, w.min - STANDARD_MIN) + w.ueber,
          oev: a.oev, km: a.km, baustelle_id: b.id, konto_nr: b.konto_nr,
          // Zeiten gehen immer mit (Migration 0016) — sie sind seit 20.09. die einzige Eingabe
          ...zuSpalten(a.zeiten),
        };
      }),
    };
  }

  /** Stunden des normalen Tags in Worten: «8.0 h» wenn alle gleich, sonst «7.5–8.5 h». */
  function normalStundenText(): string {
    const mins = dabei.map((p) => (anw[p.id] ? wirksam(anw[p.id]).min : STANDARD_MIN));
    const lo = Math.min(...mins);
    const hi = Math.max(...mins);
    const ueber = ueberTotal;
    const basis = lo === hi ? `${stunden(lo)} h` : `${stunden(lo)}–${stunden(hi)} h`;
    return ueber > 0 ? `${basis} + ${stunden(ueber)} h Überstunden` : basis;
  }

  /** Speichern darf nie stumm scheitern: jeder Fehler landet als Satz auf dem Bildschirm. */
  async function speichern(modus: SpeicherModus = 'normal') {
    if (speichertRef.current) return;
    speichertRef.current = true;
    setSpeichert(true);
    try {
      await speichernInnen(modus);
    } catch (e) {
      setGespeichert(null);
      setHinweis('Speichern fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) + ' — nochmals versuchen; die Aufnahme ist noch da.');
    } finally {
      speichertRef.current = false;
      setSpeichert(false);
    }
  }
  async function speichernInnen(modus: SpeicherModus) {
    if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; }
    if (dabei.length === 0) { setHinweis('Niemand angehakt.'); return; }
    // Zeiten von–bis: ohne «bis» gibt es keine Stunden — nichts raten, nachfragen
    const unvollstaendig = dabei.filter((p) => !zeitenVollstaendig(anw[p.id]?.zeiten ?? []));
    if (unvollstaendig.length > 0) { setHinweis(`Bei ${unvollstaendig.map((p) => p.name).join(', ')} fehlt noch «bis» — Zeit eintragen.`); return; }
    const ueberlappt = dabei.filter((p) => spannenUeberlappen(anw[p.id]?.zeiten ?? []));
    if (ueberlappt.length > 0) { setHinweis(`Bei ${ueberlappt.map((p) => p.name).join(', ')} überschneiden sich Vormittag und Nachmittag — bitte Zeiten prüfen.`); return; }
    const hatUeber = ueberTotal > 0;
    if (hatUeber && !ueberAufnahme && !nimmtAuf && !mikroFehlt) { setHinweis('Bei Überstunden bitte kurz sagen, warum — Mikrofon antippen.'); return; }
    setHinweis('');
    const clientUuids: string[] = [];
    // Meldung mit Sprachnotiz — die Abschluss-Seite zeigt dann den Text, sobald er da ist
    let notizUuid: string | undefined;

    {
      const bisher = heuteGemeldet.filter((m) => m.normalfall);
      const gleiche = bisher.filter((m) => m.baustelle_id === baustelle.id);
      if (gleiche.some((m) => m.freigegeben)) {
        setHinweis(`Für ${baustelle.bezeichnung ?? baustelle.konto_nr} ist an diesem Tag schon eine Meldung vom Bauführer freigegeben. Änderungen macht der Bauführer in der Wochenübersicht.`);
        return;
      }
      if (bisher.length > 0 && modus === 'normal') {
        const ersetzbar = bisher.filter((m) => !m.freigegeben);
        setDoppelt({
          baustellen: bisher.map((m) => m.bezeichnung).filter((x, i, a) => a.indexOf(x) === i),
          bisherMin: bisher.reduce((s, m) => s + m.min, 0),
          ersetzbarMin: ersetzbar.reduce((s, m) => s + m.min, 0),
          ersetzbar: ersetzbar.length,
          neuMin: dabei.reduce((s, p) => { const w = wirksam(anw[p.id]); return s + w.min + w.ueber; }, 0),
        });
        return;
      }
      setDoppelt(null);
      if (modus === 'ersetzen') await fruehereEntfernen(bisher);
      // Sprachnotiz geht immer mit, wenn eine da ist — Bemerkung zum Tag (Bauführer 20.09.)
      const notiz = await aufnahmeAbschliessen();
      const uuidNormal = await enqueueMeldung(meldungBauen(baustelle, notiz), notiz?.blob, fotos.map((f) => f.blob));
      clientUuids.push(uuidNormal);
      if (notiz) notizUuid = uuidNormal;
    }
    const zusammenfassung = `Gespeichert: ${normalStundenText()}`;

    setGespeichert('Lokal gespeichert …');
    if (supabase && navigator.onLine) {
      const erg = await flushNachSupabase(supabase);
      const offen = await offeneMeldungen();
      const alleDurch = clientUuids.every((u) => offen.every((m) => m.client_uuid !== u));
      if (alleDurch) {
        setGespeichert('Gespeichert ✓');
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
    // Nächste Meldung beginnt wieder mit der Vorgabe 7:00–12:00 / 13:00–offen
    setTeamSpannen(standardSpannen());
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, { ...a, zeiten: standardSpannen() }])));
    setUeberAufnahme(null); setUeberVorschau(null);
    for (const f of fotos) URL.revokeObjectURL(f.url);
    setFotos([]);
    setSchritt('fertig');
  }

  // Sprachnotiz — gedrückt halten / antippen
  async function aufnahmeStart() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMikroStream(stream);
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const teile: BlobPart[] = [];
      rec.ondataavailable = (ev) => teile.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setMikroStream(null);
        const fertig = { blob: new Blob(teile, { type: mime || 'audio/webm' }), sekunden: Math.max(1, Math.round((Date.now() - start) / 1000)) };
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
    } catch {
      setMikroFehlt(true);
      setHinweis('Mikrofon nicht verfügbar — die Meldung geht auch ohne Sprachnotiz.');
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
          {teams.length === 0 && <p className="card text-sm text-ink3">Keine Teams — unter Verwaltung anlegen oder den Demo-Betrieb laden.</p>}
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
            {stand === 'fehler' && hinweis && <p className="mt-1 text-xs text-amber-deep">{hinweis}</p>}
          </section>

          {fertig?.notizUuid && <TranskriptLive clientUuid={fertig.notizUuid} stand={stand} />}

          <section className="card">
            <p className="lbl mb-1">{istHeute ? 'Das steht jetzt für heute' : `Das steht jetzt für ${lang(datum)}`} · {team?.bezeichnung ?? 'Team'}</p>
            <ul className="divide-y divide-line text-sm">
              {heuteGemeldet.map((m, i) => (
                <li key={i} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">{m.normalfall ? <CheckCircle2 size={16} className="shrink-0 text-good" /> : <Flag size={16} className="shrink-0 text-amber-deep" />} <span>{m.bezeichnung}</span>{!m.normalfall && <span className="ml-1 text-xs text-amber-deep">{m.abweichung_typ ? AB_KURZ[m.abweichung_typ] : 'Abweichung'}</span>}</span>
                    <span className="block text-[11px] text-ink3">{m.lokal ? 'wartet auf Netz' : 'gesendet'}</span>
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
          <button type="button" className="btn-ghost w-full py-2.5" onClick={() => { setDatum(addTage(datum, -1)); setSchritt('tag'); }}>Anderen Tag nachtragen</button>
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
                      {m.normalfall ? <CheckCircle2 size={16} className="shrink-0 text-good" /> : <Flag size={16} className="shrink-0 text-amber-deep" />} <span>{m.bezeichnung}</span>
                      {!m.normalfall && <span className="ml-1 text-xs text-amber-deep">{m.abweichung_typ ? AB_KURZ[m.abweichung_typ] : 'Abweichung'}</span>}
                    </span>
                    <span className="block text-[11px] text-ink3">
                      {m.freigegeben ? 'vom Bauführer freigegeben — kann hier nicht mehr ersetzt werden' : m.lokal ? 'wartet auf Netz' : 'gesendet'}
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
              <button key={b.id} type="button" onClick={() => setBaustelle(b)} className={'chip flex min-h-[4.5rem] flex-col items-start justify-center py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : '')}>
                <span className="text-sm font-semibold leading-tight">{b.bezeichnung}</span>
                <span className="mt-1 flex items-center gap-1.5"><span className="knr">{b.konto_nr}</span>{i === 0 && <span className="text-[10px] text-ink3">{b.id === gesuchtId ? 'eingegeben' : 'zuletzt'}</span>}</span>
              </button>
            ))}
            <button type="button" onClick={() => setZeigeAndere((v) => !v)} className="chip flex min-h-[4.5rem] items-center justify-center text-ink3">andere Baustelle …</button>
          </div>
          )}
          {zeigeAndere && (
            <div className="card mt-2 space-y-2 p-3">
              {alleGeplanten.filter((b) => !kacheln.some((k) => k.id === b.id)).slice(0, 5).map((b) => (
                <button key={b.id} type="button" onClick={() => andereWaehlen(b)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-ground">
                  <span>{b.bezeichnung}</span><span className="knr">{b.konto_nr}</span>
                </button>
              ))}
              {/* Ziffernblock statt Tastatur (Regel 2): Konto-Nr. tippen, ab 3 Ziffern kommen bis zu 5 Treffer */}
              <div className="border-t border-line pt-3">
                <p className="lbl">Konto-Nr. eintippen (nur Chefmonteur)</p>
                {/* Echtes Feld: tippen, einfügen, Tastatur — der Ziffernblock darunter bleibt für Handschuhe */}
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={ziffern}
                  onChange={(e) => setZiffern(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onPaste={(e) => { e.preventDefault(); setZiffern(e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)); }}
                  placeholder="z. B. 903221"
                  aria-label="Konto-Nr."
                  className="field mb-2 text-center font-mono text-xl font-semibold tabular-nums tracking-[0.2em] placeholder:tracking-normal placeholder:font-sans placeholder:text-base placeholder:font-normal"
                />
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((z) => (
                    <button key={z} type="button" onClick={() => setZiffern((s) => (s.length < 6 ? s + z : s))} className="chip py-3 font-mono text-xl">{z}</button>
                  ))}
                  <button type="button" onClick={() => setZiffern('')} disabled={ziffern.length === 0} className="chip py-3 text-sm text-ink3 disabled:opacity-40">leer</button>
                  <button type="button" onClick={() => setZiffern((s) => (s.length < 6 ? s + '0' : s))} className="chip py-3 font-mono text-xl">0</button>
                  <button type="button" onClick={() => setZiffern((s) => s.slice(0, -1))} disabled={ziffern.length === 0} aria-label="letzte Ziffer löschen" className="chip py-3 font-mono text-xl disabled:opacity-40">←</button>
                </div>
                {ziffern.length < 3
                  ? <p className="mt-2 text-[11px] text-ink3">Ab 3 Ziffern werden Baustellen gezeigt.</p>
                  : suchTreffer.length === 0 && <p className="mt-2 text-[11px] text-ink3">Keine Baustelle mit {ziffern}… gefunden.</p>}
                {suchTreffer.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {suchTreffer.map((b) => (
                      <button key={b.id} type="button" onClick={() => andereWaehlen(b)} className={'chip flex items-center justify-between py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : '')}>
                        <span className="text-sm font-semibold">{b.bezeichnung ?? 'Baustelle'}</span><span className="knr">{b.konto_nr}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section>
          {/* Nur noch Zeiten von–bis (Amir 20.09.: «nur Zeiten eingeben») — Normal und Überstunden rechnet die App daraus */}
          <p className="lbl">Zeiten — alle gleich</p>
          <div className="rounded-[14px] border border-line bg-surface p-3 shadow-[0_1px_2px_rgb(17_17_19/0.04)]">
            <SpannenEditor spannen={teamSpannen} setSpannen={setzeTeamSpannen} />
            {(() => {
              const t = aufteilen(spannenMinuten(teamSpannen));
              return (
                <p className="mt-2 font-mono text-sm tabular-nums">
                  {zeitenVollstaendig(teamSpannen) ? <>{stunden(t.normal_min + t.ueber_min)} h{t.ueber_min > 0 && <span className="font-semibold text-amber-deep"> · davon {stunden(t.ueber_min)} h Überstunden</span>}</> : <span className="text-amber-deep">«bis» eintragen</span>}
                </p>
              );
            })()}
            <p className="mt-1 text-[11px] text-ink3">Die App zieht keine Pause ab — was hier steht, zählt. Mittag 12–13 ist als Lücke vorgegeben. Unten kann jede Person anders sein.</p>
            <MittagHinweis spannen={teamSpannen} />
          </div>
        </section>

        <section>
          <p className="lbl">Wer war dabei</p>
          <div className="card divide-y divide-line p-0">
            {alleImTeam.map((p) => {
              const a = anw[p.id];
              if (!a) return null;
              const w = wirksam(a);
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, dabei: !a.dabei } }))} aria-pressed={a.dabei} className={'grid h-10 w-10 flex-none place-items-center rounded-[10px] border transition active:scale-95 ' + (a.dabei ? 'border-good bg-good text-white shadow-[0_6px_14px_-8px_rgb(31_157_85/0.7)]' : 'border-line-strong bg-surface text-transparent')}>
                      <Check size={20} strokeWidth={2.6} />
                    </button>
                    <span className={'min-w-0 flex-1 truncate text-sm ' + (a.dabei ? 'font-medium' : 'text-ink3 line-through')}>
                      {p.name}
                      {p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                      {p.gast && <span className="ml-1.5 rounded-md bg-steel-soft px-1.5 py-0.5 text-[10px] font-semibold text-steel">Gast</span>}
                    </span>
                    {a.dabei && (
                      <>
                        <span className={'font-mono text-sm tabular-nums ' + (!zeitenVollstaendig(a.zeiten) || w.ueber > 0 ? 'font-semibold text-amber-deep' : 'text-ink2')}>{zeitenVollstaendig(a.zeiten) ? `${stunden(w.min + w.ueber)} h` : '– h'}</span>
                        {/* Anreise: nur Auto (km). öV ist ausgeblendet (OEV_AKTIV), bis geklärt ist, ob es ganz weg soll. */}
                        <button type="button" onClick={() => setAnreiseOffen(anreiseOffen === p.id ? null : p.id)} aria-label="Anreise" className={'grid h-10 min-w-10 place-items-center rounded-[10px] border px-1.5 text-[11px] ' + (a.oev || a.km > 0 ? 'border-steel/40 bg-steel-soft text-steel' : 'border-line bg-surface text-ink3')}>{a.oev ? 'öV' : a.km > 0 ? `${a.km} km` : <Car size={16} />}</button>
                      </>
                    )}
                    {p.gast && (
                      <button type="button" onClick={() => gastEntfernen(p.id)} aria-label={`${p.name} entfernen`} className="grid h-10 w-8 place-items-center rounded-[10px] text-ink3 active:bg-surface-2"><X size={16} /></button>
                    )}
                  </div>
                  {/* Die Team-Zeiten oben gelten für alle. Je Person stehen sie als eine Zeile da;
                      die Uhrzeit-Felder kommen erst, wenn jemand abweicht («ändern») oder «bis» noch fehlt. */}
                  {a.dabei && (zeitenOffen === p.id || !zeitenVollstaendig(a.zeiten) ? (
                    <div className="mt-2">
                      <SpannenEditor klein spannen={a.zeiten} setSpannen={(z) => setAnw((s) => ({ ...s, [p.id]: { ...a, zeiten: z } }))} />
                      <div className="mt-1 flex items-center gap-3 text-[11px]">
                        {w.ueber > 0 && <span className="font-semibold text-amber-deep">{stunden(w.ueber)} h über</span>}
                        {!zeitenVollstaendig(a.zeiten) && <span className="text-amber-deep">«bis» fehlt noch</span>}
                        {zeitenVollstaendig(a.zeiten) && (
                          <button type="button" onClick={() => setZeitenOffen(null)} className="ml-auto font-semibold text-steel">fertig</button>
                        )}
                      </div>
                      <MittagHinweis spannen={a.zeiten} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => setZeitenOffen(p.id)} className="mt-1.5 flex w-full items-center gap-2 pl-[52px] text-left">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] tabular-nums text-ink2">{zeitenText(zuSpalten(a.zeiten))}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-steel">ändern</span>
                    </button>
                  ))}
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

        {/* Bemerkung zum Tag: die Sprachnotiz ist immer da (Bauführer 20.09.), bei Überstunden Pflicht — kein eigener Bildschirm. */}
        <section className={'card space-y-2.5 ' + (ueberTotal > 0 ? 'border-amber/30' : '')}>
            <p className="text-sm font-semibold">
              {ueberTotal > 0 ? <>Überstunden · {stunden(ueberTotal)} h — kurz sagen, warum</> : 'Bemerkung zum Tag — freiwillig'}
            </p>
            <div className={'rounded-[12px] border-2 border-dashed p-4 text-center ' + (nimmtAuf ? 'border-accent bg-accent-soft' : ueberAufnahme ? 'border-good/50 bg-good-soft/40' : 'border-steel bg-steel-soft')}>
              {ueberAufnahme ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Sprachnotiz · {ueberAufnahme.sekunden} Sek. ✓</p>
                  <audio controls src={URL.createObjectURL(ueberAufnahme.blob)} className="mx-auto h-9 w-full max-w-xs" />
                  {ueberVorschau?.status === 'laeuft' && (
                    <div className="space-y-1.5 rounded-[10px] bg-surface p-3 text-left" aria-live="polite">
                      <p className="text-xs font-medium text-ink2">Die App schreibt mit …</p>
                      <div className="ki-schimmer h-3 w-11/12 rounded" /><div className="ki-schimmer h-3 w-3/4 rounded" />
                    </div>
                  )}
                  {ueberVorschau?.status === 'fertig' && (
                    <div className="space-y-1.5 rounded-[10px] bg-surface p-3 text-left">
                      <p className="text-xs font-medium text-ink2">Stimmt das so? Sonst hier korrigieren.</p>
                      <textarea value={ueberVorschau.text} onChange={(e) => setUeberVorschau({ ...ueberVorschau, text: e.target.value })} rows={2} className="field text-sm" />
                    </div>
                  )}
                  {ueberVorschau?.status === 'fehler' && <p className="text-xs text-ink3">{ueberVorschau.grund}</p>}
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
                  <span className="mt-0.5 block text-xs text-ink3">{mikroFehlt ? 'Mikrofon nicht verfügbar — Speichern geht trotzdem.' : 'In deiner Sprache, 10 Sekunden reichen. Der Bauführer liest es.'}</span>
                </button>
              )}
            </div>
            <p className="text-xs text-ink3">{ueberTotal > 0 ? 'Der Bauführer sieht die Überstunden mit deiner Notiz und gibt sie frei.' : 'Der Bauführer liest die Notiz in der Wochenübersicht — z. B. Material fehlt, Kunde war da, früher Schluss.'}</p>
        </section>

        <FotoLeiste text="Foto vom Stand heute — freiwillig, hilft dem Bauführer." />

        {doppelt && (
          <section className="card space-y-3 border-amber/40 bg-amber-soft">
            <p className="text-sm">
              <strong>{istHeute ? 'Heute' : 'An diesem Tag'} habt ihr schon gemeldet: {doppelt.baustellen.join(', ')}</strong>
              {' '}— {stunden(doppelt.bisherMin)} h für das Team zusammen.
            </p>
            {doppelt.ersetzbar > 0 ? (
              <>
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern('ersetzen')}>
                  Frühere ersetzen
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.bisherMin - doppelt.ersetzbarMin + doppelt.neuMin)} h (Team zusammen).</span>
                </button>
                <button type="button" disabled={speichert} className="btn-ghost w-full py-2.5 text-sm disabled:opacity-70" onClick={() => void speichern('zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle) · dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink2">Die frühere Meldung ist vom Bauführer freigegeben — ersetzen geht hier nicht mehr. Änderungen macht der Bauführer.</p>
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern('zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle)
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h (Team zusammen).</span>
                </button>
              </>
            )}
            <button type="button" className="btn-ghost w-full py-2.5 text-sm" onClick={() => setDoppelt(null)}>Abbrechen</button>
          </section>
        )}

        <button type="button" disabled={speichert} onClick={() => void speichern()} className="cta cta-good py-5 text-[17px] disabled:opacity-70">
          <span className="inline-flex items-center gap-2">{gespeichert ? gespeichert : <><CheckCircle2 size={22} strokeWidth={2.2} aria-hidden="true" /> Tag melden</>}</span>
        </button>
        {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}


      </div>
    </Shell>
  );
}
