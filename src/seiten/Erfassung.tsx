import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Pegel, TranskriptLive } from '../ui/Sprachnotiz';
import { supabase } from '../lib/supabase';
import { enqueueMeldung, flushNachSupabase, offeneMeldungen, offeneAnzahl, lokaleMeldungEntfernen, type MeldungPayload } from '../lib/db';
import { addTage, iso, lang, stunden } from '../lib/datum';
import { fotoVerkleinern } from '../lib/foto';

/**
 * Phase 2 — das Teamgerät. Ein Chefmonteur meldet für sein Team.
 *
 * Harte Regeln: keine Tastatur, keine Liste über 5 Einträgen, alles offline.
 * Normalfall = ein Knopf. Abweichung = Symbol → «Wer wollte das?» → kurz erzählen.
 * Es wird nie gefragt, OB etwas Regie ist — das kann der Monteur nicht wissen.
 */

interface Team { id: string; bezeichnung: string; fahrzeug: string | null }
interface Person { id: string; name: string; typ: string; funktion: string; oev_standard: boolean; km_standard: number }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null }
interface Anwesenheit { dabei: boolean; min: number; oev: boolean; km: number }

type Schritt = 'team' | 'tag' | 'symbol' | 'wer' | 'notiz' | 'fertig';
type Abweichung = 'zusaetzlich' | 'warten' | 'kaputt';
type Wer = 'kunde' | 'chef' | 'niemand';

const TEAM_KEY = 'teamgeraet-team-id';
/** Zuletzt gewählte Teams auf diesem Gerät (max. 5, neuestes vorne) — damit die Teamwahl nie mehr als 5 Kacheln braucht (Regel 3). */
const ZULETZT_KEY = 'teamgeraet-zuletzt';
const STANDARD_MIN = 480;

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
const AB_KURZ: Record<Abweichung, string> = { zusaetzlich: 'zusätzlich', warten: 'gewartet', kaputt: 'repariert' };

const SYMBOLE: { typ: Abweichung; label: string; svg: ReactElement }[] = [
  {
    typ: 'zusaetzlich', label: 'zusätzlich gearbeitet',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9" fill="currentColor"><rect x="17" y="8" width="6" height="24" rx="2" /><rect x="8" y="17" width="24" height="6" rx="2" /></svg>,
  },
  {
    typ: 'warten', label: 'warten müssen',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none" stroke="currentColor"><circle cx="20" cy="20" r="13" strokeWidth="3.5" /><path d="M20 12v8.5l6 3.5" strokeWidth="3.5" strokeLinecap="round" /></svg>,
  },
  {
    typ: 'kaputt', label: 'etwas kaputt / repariert',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9"><path d="M20 7 L34 31 H6 Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" /><rect x="18.2" y="15" width="3.6" height="8" rx="1.8" fill="currentColor" /><circle cx="20" cy="26.5" r="2" fill="currentColor" /></svg>,
  },
];

/** Kurzform für die drei Kacheln im Tag-Schritt — zwei Wörter, die auch allein verständlich sind. */
const KURZ_LABEL: Record<Abweichung, string> = { zusaetzlich: 'zusätzlich gearbeitet', warten: 'warten müssen', kaputt: 'etwas kaputt' };

function Helm({ farbe }: { farbe: string }) {
  return (
    <svg viewBox="0 0 48 40" className="h-10 w-12" aria-hidden="true">
      <path d="M11 28a13 13 0 0 1 26 0z" fill={farbe} />
      <rect x="5" y="28" width="38" height="5" rx="2.5" fill={farbe} />
    </svg>
  );
}

function Stepper({ wert, setWert, schritt, min, format }: { wert: number; setWert: (v: number) => void; schritt: number; min: number; format: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] border border-line-strong bg-surface-2 px-2 py-1">
      <button type="button" onClick={() => setWert(Math.max(min, wert - schritt))} className="px-3 py-1.5 font-mono text-xl text-steel">◄</button>
      <span className="font-mono text-xl font-semibold tabular-nums">{format(wert)}</span>
      <button type="button" onClick={() => setWert(wert + schritt)} className="px-3 py-1.5 font-mono text-xl text-steel">►</button>
    </div>
  );
}

export function Erfassung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [leute, setLeute] = useState<Person[]>([]);
  const [kacheln, setKacheln] = useState<Baustelle[]>([]);
  const [alleGeplanten, setAlleGeplanten] = useState<Baustelle[]>([]);
  const [zeigeAndere, setZeigeAndere] = useState(false);
  // Baustellensuche ohne Tastatur (Regel 2): Konto-Nr. über den Ziffernblock, ab 3 Ziffern wird gesucht
  const [ziffern, setZiffern] = useState('');
  const [suchTreffer, setSuchTreffer] = useState<Baustelle[]>([]);
  const [laedtTeam, setLaedtTeam] = useState(false);
  const [zuletzt, setZuletzt] = useState<string[]>(zuletztLesen);
  const [weitereTeams, setWeitereTeams] = useState(0);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(null);
  const [teamMin, setTeamMin] = useState(STANDARD_MIN);
  const [anw, setAnw] = useState<Record<string, Anwesenheit>>({});
  const [anreiseOffen, setAnreiseOffen] = useState<string | null>(null);
  // Über die Startseite (/erfassung?wahl) immer zuerst das Team zeigen — zum Testen mehrerer Teams im selben Browser.
  // Das Teamgerät selbst öffnet /erfassung ohne Parameter und landet direkt beim Tag.
  const [schritt, setSchritt] = useState<Schritt>(teamId && !new URLSearchParams(window.location.search).has('wahl') ? 'tag' : 'team');
  const [abweichung, setAbweichung] = useState<Abweichung | null>(null);
  const [wer, setWer] = useState<Wer | null>(null);
  const [abMin, setAbMin] = useState(60);
  const [abLeute, setAbLeute] = useState<Set<string>>(new Set());
  const [aufnahme, setAufnahme] = useState<{ blob: Blob; sekunden: number } | null>(null);
  // Fotos zur Meldung — der Bauführer verlangt Bilder bei Regie; hier ohne Umweg über die Galerie
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
              <button type="button" onClick={() => fotoEntfernen(f.id)} aria-label="Foto entfernen" className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-ink/80 text-[11px] font-bold leading-5 text-white">×</button>
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
  const [datum, setDatum] = useState<Date>(() => new Date());
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
      for (const p of personen) a[p.id] = { dabei: true, min: STANDARD_MIN, oev: p.oev_standard, km: p.km_standard };
      setAnw(a);

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

  // Ausnahme für den Chefmonteur: Konto-Nr. über den Ziffernblock, falls die Kacheln nicht reichen (ab 3 Ziffern, max. 5 Treffer)
  useEffect(() => {
    if (!supabase || ziffern.length < 3) { setSuchTreffer([]); return; }
    const client = supabase;
    const q = ziffern;
    const t = setTimeout(() => {
      void client.from('baustelle').select('id,konto_nr,bezeichnung').like('konto_nr', `${q}%`).order('konto_nr').limit(5).then(({ data }) => data && setSuchTreffer(data));
    }, 150);
    return () => clearTimeout(t);
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

  const dabei = useMemo(() => leute.filter((p) => anw[p.id]?.dabei), [leute, anw]);

  function setzeTeamMin(v: number) {
    setTeamMin(v);
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, { ...a, min: v }])));
  }

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

  /** Meldung für die gewählte Baustelle bauen: normaler Tag (alle Anwesenden, Stunden wie eingestellt) oder Abweichung (nur die Beteiligten, Zusatzminuten). */
  function meldungBauen(normal: boolean, b: Baustelle, notiz: { blob: Blob; sekunden: number } | null = aufnahme): MeldungPayload {
    const beteiligt = normal ? dabei : dabei.filter((p) => abLeute.has(p.id));
    return {
      id: crypto.randomUUID(), team_id: teamId!, datum: tagIso, baustelle_id: b.id,
      normalfall: normal, abweichung_typ: normal ? null : abweichung, wer_hats_gewollt: normal ? null : wer,
      audio_sekunden: normal ? null : notiz?.sekunden ?? null, erfasst_von: userId,
      eintraege: beteiligt.map((p) => {
        const a = anw[p.id];
        const min = normal ? a.min : abMin;
        return { id: crypto.randomUUID(), mitarbeiter_id: p.id, normal_min: Math.min(min, 480), ueber_min: Math.max(0, min - 480), oev: normal ? a.oev : false, km: normal ? a.km : 0, baustelle_id: b.id, konto_nr: b.konto_nr };
      }),
    };
  }

  /** Stunden des normalen Tags in Worten: «8.0 h» wenn alle gleich, sonst «7.5–8.5 h». */
  function normalStundenText(): string {
    const mins = dabei.map((p) => anw[p.id]?.min ?? STANDARD_MIN);
    const lo = Math.min(...mins);
    const hi = Math.max(...mins);
    return lo === hi ? `${stunden(lo)} h` : `${stunden(lo)}–${stunden(hi)} h`;
  }

  /** Speichern darf nie stumm scheitern: jeder Fehler landet als Satz auf dem Bildschirm. */
  async function speichern(normal: boolean, modus: SpeicherModus = 'normal') {
    if (speichertRef.current) return;
    speichertRef.current = true;
    setSpeichert(true);
    try {
      await speichernInnen(normal, modus);
    } catch (e) {
      setGespeichert(null);
      setHinweis('Speichern fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) + ' — nochmals versuchen; die Aufnahme ist noch da.');
    } finally {
      speichertRef.current = false;
      setSpeichert(false);
    }
  }
  async function speichernInnen(normal: boolean, modus: SpeicherModus) {
    if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; }
    if (dabei.length === 0) { setHinweis('Niemand angehakt.'); return; }
    setHinweis('');
    const clientUuids: string[] = [];
    let normalMitgespeichert = false;
    // Meldung mit Sprachnotiz — die Abschluss-Seite zeigt dann den Text, sobald er da ist
    let notizUuid: string | undefined;

    if (normal) {
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
          neuMin: dabei.reduce((s, p) => s + (anw[p.id]?.min ?? 0), 0),
        });
        return;
      }
      setDoppelt(null);
      if (modus === 'ersetzen') await fruehereEntfernen(bisher);
      clientUuids.push(await enqueueMeldung(meldungBauen(true, baustelle), undefined, fotos.map((f) => f.blob)));
    } else {
      // Abweichung: die normalen Stunden des Tags dürfen nicht verloren gehen — fehlt die Normalmeldung für diese Baustelle, geht sie zuerst mit in die Warteschlange.
      let aktuell = heuteGemeldet;
      try { aktuell = await heutigeLaden(); } catch { /* lokaler Stand reicht */ }
      const hatNormal = aktuell.some((m) => m.normalfall && m.baustelle_id === baustelle.id);
      if (!hatNormal) {
        clientUuids.push(await enqueueMeldung(meldungBauen(true, baustelle)));
        normalMitgespeichert = true;
      }
      const notiz = await aufnahmeAbschliessen();
      const uuid = await enqueueMeldung(meldungBauen(false, baustelle, notiz), notiz?.blob, fotos.map((f) => f.blob));
      clientUuids.push(uuid);
      if (notiz) notizUuid = uuid;
    }

    const abText = abweichung ? `${stunden(abMin)} h ${AB_KURZ[abweichung]}` : '';
    const zusammenfassung = normal
      ? `Gespeichert: normaler Tag ${normalStundenText()}`
      : normalMitgespeichert ? `Gespeichert: normaler Tag ${normalStundenText()} + ${abText}` : `Gespeichert: ${abText} (normaler Tag war schon gemeldet)`;

    setGespeichert('Lokal gespeichert …');
    if (supabase && navigator.onLine) {
      const erg = await flushNachSupabase(supabase);
      const offen = await offeneMeldungen();
      const alleDurch = clientUuids.every((u) => offen.every((m) => m.client_uuid !== u));
      if (alleDurch) {
        setGespeichert(normal ? 'Gespeichert ✓' : 'Abweichung gespeichert ✓');
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
    setAbweichung(null); setWer(null); setAufnahme(null); setAbMin(60); setAbLeute(new Set());
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
        setAufnahme(fertig);
        setNimmtAuf(false);
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
      setHinweis('Mikrofon nicht verfügbar — die Meldung geht auch ohne Sprachnotiz.');
    }
  }
  /** Laufende Aufnahme beenden und auf die Datei warten — sonst geht sie beim Speichern verloren. */
  function aufnahmeAbschliessen(): Promise<{ blob: Blob; sekunden: number } | null> {
    if (!nimmtAuf || !recorder.current || recorder.current.state === 'inactive') return Promise.resolve(aufnahme);
    return new Promise((resolve) => {
      aufnahmeFertig.current = resolve;
      recorder.current?.stop();
      window.setTimeout(() => { if (aufnahmeFertig.current === resolve) { aufnahmeFertig.current = null; resolve(aufnahme); } }, 3000);
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
          <h1 className="font-display text-2xl font-bold">Welches Team?</h1>
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
            <p className={'font-display text-xl font-bold ' + (stand === 'fehler' ? 'text-amber-deep' : 'text-good-deep')}>
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
                    <span className="block">{m.normalfall ? '✓' : '⚑'} {m.bezeichnung}{!m.normalfall && <span className="ml-1 text-xs text-amber-deep">{m.abweichung_typ ? AB_KURZ[m.abweichung_typ] : 'Abweichung'}</span>}</span>
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
          <button type="button" className="btn-ghost w-full py-2.5" onClick={() => setSchritt('tag')}>Noch etwas melden — zweite Baustelle oder Abweichung</button>
          <button type="button" className="btn-ghost w-full py-2.5" onClick={() => { setDatum(addTage(datum, -1)); setSchritt('tag'); }}>Anderen Tag nachtragen</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'symbol') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <p className="lbl mb-0">Abweichung</p>
          <h1 className="font-display text-2xl font-bold">Was war anders?</h1>
          <div className="grid grid-cols-3 gap-2">
            {SYMBOLE.map((s) => (
              <button key={s.typ} type="button" onClick={() => { setAbweichung(s.typ); setAbLeute(new Set(dabei.map((p) => p.id))); setSchritt('wer'); }} className="chip flex flex-col items-center gap-2 py-5 text-ink2">
                {s.svg}
                <span className="text-xs leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSchritt('tag')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'wer') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <p className="lbl mb-0">{SYMBOLE.find((s) => s.typ === abweichung)?.label}</p>
          <h1 className="font-display text-2xl font-bold">Wer wollte das?</h1>
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
          <button type="button" onClick={() => setSchritt('symbol')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'notiz') {
    return (
      <Shell zurueck schmal>
        <div className="space-y-4">
          <p className="lbl mb-0">{SYMBOLE.find((s) => s.typ === abweichung)?.label} · {wer === 'kunde' ? 'Kunde' : wer === 'chef' ? 'unser Chef' : 'niemand'}</p>
          <h1 className="font-display text-2xl font-bold">Wie lange?</h1>
          <Stepper wert={abMin} setWert={setAbMin} schritt={30} min={30} format={(v) => (v / 60).toFixed(1) + ' h'} />

          <div>
            <p className="lbl">Wer war dabei</p>
            <div className="grid grid-cols-2 gap-2">
              {dabei.map((p) => (
                <button key={p.id} type="button" onClick={() => setAbLeute((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className={'chip text-left ' + (abLeute.has(p.id) ? 'chip-on' : '')}>
                  {abLeute.has(p.id) ? '✓ ' : ''}{p.name}
                </button>
              ))}
            </div>
          </div>

          <FotoLeiste text="Bitte Fotos machen — der Bauführer braucht Bilder bei Zusatzarbeit." />

          <div className={'rounded-[14px] border-2 border-dashed p-5 text-center ' + (nimmtAuf ? 'border-accent bg-accent-soft' : 'border-steel bg-steel-soft')}>
            {aufnahme ? (
              <div className="space-y-2">
                <p className="font-display font-bold">Sprachnotiz · {aufnahme.sekunden} Sek. ✓</p>
                <audio controls src={URL.createObjectURL(aufnahme.blob)} className="mx-auto h-9 w-full max-w-xs" />
                <button type="button" onClick={() => setAufnahme(null)} className="btn-ghost">nochmal</button>
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
                <span className="mt-2 block font-display font-bold">{nimmtAuf ? `${sekunden} Sek. — antippen zum Stoppen` : 'Antippen und kurz erzählen, was war'}</span>
                <span className="mt-1 block text-xs text-ink3">{nimmtAuf ? 'Die App hört zu und schreibt danach mit.' : 'In deiner Sprache. Freiwillig — die Meldung geht auch ohne.'}</span>
              </button>
            )}
          </div>

          <button type="button" disabled={speichert} onClick={() => void speichern(false)} className="cta disabled:opacity-70">{speichert ? 'Speichert …' : 'Speichern'}</button>
          {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}
          <button type="button" onClick={() => setSchritt('wer')} className="btn-ghost w-full">Zurück</button>
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
              <button type="button" className="btn-ghost px-2.5 py-1" disabled={tagIso <= fruehesterIso} onClick={() => setDatum((d) => addTage(d, -1))} aria-label="Tag zurück">◀</button>
              <h1 className="font-display text-2xl font-bold">{istHeute ? 'Heute' : lang(datum)}</h1>
              <button type="button" className="btn-ghost px-2.5 py-1" disabled={istHeute} onClick={() => setDatum((d) => addTage(d, 1))} aria-label="Tag vor">▶</button>
            </div>
            <p className="mt-0.5 text-xs text-ink3">
              {istHeute ? lang(datum) : <span className="font-semibold text-accent-deep">Nachtrag — nicht heute</span>}
              {' · '}
              <button type="button" onClick={() => setSchritt('team')} className="font-semibold text-steel">
                {team?.bezeichnung ?? 'Team'}{team?.fahrzeug ? ` · ${team.fahrzeug}` : ''} · ändern
              </button>
            </p>
          </div>
          <span className="shrink-0 font-mono text-xs text-ink3">
            {navigator.onLine ? 'online' : 'offline'}
            {wartend > 0 && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-deep">{wartend} wartet</span>}
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
                    <span className="block">
                      {m.normalfall ? '✓' : '⚑'} {m.bezeichnung}
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
              Zweite Baustelle an diesem Tag? Unten antippen und speichern. Einen anderen Tag vergessen? Oben mit ◀ zurück.
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
                <span className="text-sm font-bold leading-tight">{b.bezeichnung}</span>
                <span className="mt-1 flex items-center gap-1.5"><span className="knr">{b.konto_nr}</span>{i === 0 && <span className="text-[10px] text-ink3">zuletzt</span>}</span>
              </button>
            ))}
            <button type="button" onClick={() => setZeigeAndere((v) => !v)} className="chip flex min-h-[4.5rem] items-center justify-center text-ink3">andere Baustelle …</button>
          </div>
          )}
          {zeigeAndere && (
            <div className="card mt-2 space-y-2 p-3">
              {alleGeplanten.filter((b) => !kacheln.some((k) => k.id === b.id)).slice(0, 5).map((b) => (
                <button key={b.id} type="button" onClick={() => { setBaustelle(b); setZeigeAndere(false); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-ground">
                  <span>{b.bezeichnung}</span><span className="knr">{b.konto_nr}</span>
                </button>
              ))}
              {/* Ziffernblock statt Tastatur (Regel 2): Konto-Nr. tippen, ab 3 Ziffern kommen bis zu 5 Treffer */}
              <div className="border-t border-line pt-3">
                <p className="lbl">Konto-Nr. eintippen (nur Chefmonteur)</p>
                <div className="mb-2 flex justify-center gap-1.5" aria-label={`Konto-Nr. ${ziffern || 'leer'}`}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} className={'flex h-11 w-9 items-center justify-center rounded-[8px] border font-mono text-lg font-semibold tabular-nums ' + (ziffern[i] ? 'border-steel bg-steel-soft text-steel' : 'border-line-strong bg-surface text-ink3')}>
                      {ziffern[i] ?? ''}
                    </span>
                  ))}
                </div>
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
                      <button key={b.id} type="button" onClick={() => { setBaustelle(b); setZeigeAndere(false); setZiffern(''); }} className={'chip flex items-center justify-between py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : '')}>
                        <span className="text-sm font-bold">{b.bezeichnung ?? 'Baustelle'}</span><span className="knr">{b.konto_nr}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section>
          <p className="lbl">Wer war dabei</p>
          <div className="card divide-y divide-line p-0">
            {leute.map((p) => {
              const a = anw[p.id];
              if (!a) return null;
              return (
                <div key={p.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, dabei: !a.dabei } }))} className={'flex h-8 w-8 flex-none items-center justify-center rounded-md border text-lg font-bold ' + (a.dabei ? 'border-good bg-good text-white' : 'border-line-strong text-ink3')}>
                      {a.dabei ? '✓' : ''}
                    </button>
                    <span className={'min-w-0 flex-1 truncate text-sm ' + (a.dabei ? 'font-medium' : 'text-ink3 line-through')}>
                      {p.name}{p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                    </span>
                    {a.dabei && (
                      <>
                        <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, min: Math.max(30, a.min - 30) } }))} className="btn-ghost px-2">−</button>
                        <span className="w-11 text-center font-mono text-sm tabular-nums">{(a.min / 60).toFixed(1)}</span>
                        <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, min: a.min + 30 } }))} className="btn-ghost px-2">+</button>
                        <button type="button" onClick={() => setAnreiseOffen(anreiseOffen === p.id ? null : p.id)} className="btn-ghost px-2 text-[11px]">{a.oev ? 'öV' : a.km > 0 ? `${a.km} km` : '–'}</button>
                      </>
                    )}
                  </div>
                  {anreiseOffen === p.id && a.dabei && (
                    <div className="mt-2 flex items-center gap-2 pl-10">
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, oev: !a.oev, km: a.oev ? a.km : 0 } }))} className={'chip px-3 py-1.5 text-xs ' + (a.oev ? 'chip-on' : '')}>öV</button>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: Math.max(0, a.km - 5), oev: false } }))} className="btn-ghost px-2">−</button>
                      <span className="font-mono text-xs tabular-nums">{a.km} km</span>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: a.km + 5, oev: false } }))} className="btn-ghost px-2">+</button>
                    </div>
                  )}
                </div>
              );
            })}
            {leute.length === 0 && <p className="p-3 text-sm text-ink3">{laedtTeam ? 'Lädt …' : 'Keine Mitglieder in diesem Team.'}</p>}
          </div>
        </section>

        <section>
          <p className="lbl">Wie lange — alle</p>
          <Stepper wert={teamMin} setWert={setzeTeamMin} schritt={30} min={30} format={(v) => (v / 60).toFixed(1) + ' h'} />
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
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern(true, 'ersetzen')}>
                  Frühere ersetzen
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.bisherMin - doppelt.ersetzbarMin + doppelt.neuMin)} h (Team zusammen).</span>
                </button>
                <button type="button" disabled={speichert} className="btn-ghost w-full py-2.5 text-sm disabled:opacity-70" onClick={() => void speichern(true, 'zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle) · dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink2">Die frühere Meldung ist vom Bauführer freigegeben — ersetzen geht hier nicht mehr. Änderungen macht der Bauführer.</p>
                <button type="button" disabled={speichert} className="cta py-4 disabled:opacity-70" onClick={() => void speichern(true, 'zusaetzlich')}>
                  Zusätzlich speichern (zweite Baustelle)
                  <span className="mt-0.5 block text-xs font-normal opacity-90">Am Tag stehen dann {stunden(doppelt.bisherMin + doppelt.neuMin)} h (Team zusammen).</span>
                </button>
              </>
            )}
            <button type="button" className="btn-ghost w-full py-2.5 text-sm" onClick={() => setDoppelt(null)}>Abbrechen</button>
          </section>
        )}

        <button type="button" disabled={speichert} onClick={() => void speichern(true)} className="cta cta-good py-5 disabled:opacity-70">
          {gespeichert ?? '✓ Alles wie geplant'}
        </button>
        {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}

        <div>
          <p className="mb-2 text-center text-sm text-ink3">War etwas anders?</p>
          <div className="grid grid-cols-3 gap-2">
            {SYMBOLE.map((s) => (
              <button key={s.typ} type="button" onClick={() => { if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; } setAbweichung(s.typ); setAbLeute(new Set(dabei.map((p) => p.id))); setSchritt('wer'); }} className="chip flex flex-col items-center gap-1.5 py-3 text-ink2">
                {s.svg}
                <span className="text-[11px] leading-tight">{KURZ_LABEL[s.typ]}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-ink3">Abweichung melden speichert den normalen Tag mit.</p>
        </div>

      </div>
    </Shell>
  );
}
