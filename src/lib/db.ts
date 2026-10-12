/**
 * Offline-Warteschlange (CLAUDE.md #4/#5):
 * Jede Erfassung schreibt ZUERST hierhin — nie direkt ins Netz.
 * Gesendet wird, sobald Verbindung da ist; der Server dedupliziert
 * über client_uuid bzw. clientseitig vergebene ids — mehrfaches Senden ist harmlos.
 *
 * Eine Warteschlange: Tagesmeldungen (Teamgerät, inkl. Zeiteinträge, Sprachnotiz, Fotos).
 * Die zweite (Zusatzaufträge des Bauführers) ist seit 20.09. weg — mit der ganzen Regie; Dexie-Version 4
 * räumt die Tabelle auf Altgeräten ab.
 *
 * Vor dem Start bei der Gerüst GmbH (13.10.2026) dazugekommen:
 *   - Nie zwei Durchgänge gleichzeitig: Senden, Ändern und Ersetzen laufen über eine Sperre (`exklusiv`). Vorher konnten
 *     der Hintergrund und «Tag melden» dieselbe Meldung zweimal senden, oder eine Meldung wurde ersetzt, während sie
 *     gerade hinausging.
 *   - Nichts wird verworfen, was ein Team gemeldet hat. Lehnt der Server eine Zeile endgültig ab (Person im Büro
 *     gelöscht), gehen die übrigen Zeilen, Sprachnotiz und Fotos trotzdem hinaus; die eine Zeile bleibt mit Grund auf
 *     dem Gerät, bis der Chefmonteur entscheidet. Vorher verschwand die ganze Meldung samt Sprachnotiz still.
 *   - Jede Meldung trägt die Firma und das Konto, mit dem sie erfasst wurde (zugang.ts), und geht nur mit dieser Firma
 *     hinaus.
 *   - Gesendet wird auch, wenn die App wieder in den Vordergrund kommt und jede Minute, solange etwas wartet.
 */
import Dexie, { type Table } from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';
import { firmaVon, gehoertZu, zugang } from './zugang';

/** Eine Zeile, die der Server endgültig ablehnt — mit Grund in einfachen Worten. */
export interface ZeilenFehler { id: string; mitarbeiter_id: string; grund: string }

interface QueueEintrag {
  client_uuid: string;
  payload: Record<string, unknown>;
  erstellt: number;
  /**
   * lokal     — wartet (oder hängt: siehe `kopfFehler` / `zeilenFehler`)
   * gesendet  — ganz auf dem Server
   * verworfen — Alt-Eintrag in fremdem Format (frühe Tests) oder ein Zusatzauftrag, der nie durchkommt
   * beiseite  — der Chefmonteur hat eine Meldung, die nie durchkommt, bewusst beiseitegelegt
   * ersetzt   — durch eine neuere Fassung ersetzt, bevor sie beim Server war
   * Bei «beiseite» und «ersetzt» bleiben Sprachnotiz und Fotos auf dem Gerät liegen (CLAUDE.md #8).
   */
  status: 'lokal' | 'gesendet' | 'verworfen' | 'beiseite' | 'ersetzt';
  /** Sprachnotiz oder Fotos liessen sich auf diesem Gerät nicht ablegen — Grund für den Bildschirm. */
  belegFehler?: string;
  /** Mit welcher Anmeldung erfasst (zugang.ts). Fehlt beides: Eintrag von vor dem 13.10.2026. */
  firma_id?: string | null;
  firma_name?: string | null;
  auth_user_id?: string | null;
  /** Zählt jede Änderung — «gesendet» gilt nur, wenn sie sich seit dem Start des Sendens nicht geändert hat. */
  rev?: number;
  /** Ein Sendeversuch hat begonnen: der Kopf kann auf dem Server sein, auch wenn die Antwort nie kam. */
  versucht?: boolean;
  /** Der Kopf ist sicher auf dem Server. */
  amServer?: boolean;
  /** Wird gerade ersetzt (Zeitpunkt) — ein laufendes Senden hört beim nächsten Schritt auf. */
  zurueckgezogen?: number;
  /** Letzter Fehler beim Senden, und wann. */
  fehlerText?: string;
  fehlerZeit?: number;
  /** Der Kopf kommt nie durch (Team oder Baustelle gibt es nicht mehr) — wartet auf den Chefmonteur. */
  kopfFehler?: string;
  /** Zeilen, die der Server endgültig ablehnt — alle anderen sind drin. */
  zeilenFehler?: ZeilenFehler[];
  /** Zeilen, die der Chefmonteur bewusst ohne Server abgeschlossen hat. Sie bleiben im payload stehen. */
  ausgelassen?: ZeilenFehler[];
  /** Namen der Personen, nur für den Bildschirm — geht nie zum Server. */
  namen?: Record<string, string>;
}

export interface FlushErgebnis {
  gesendet: number;
  fehler: number;
  /** Alt-Einträge in fremdem Format und Zusatzaufträge, die nie mehr durchkommen — aussortiert. */
  verworfen: number;
  /** Meldungen, die auf eine Entscheidung des Chefmonteurs warten (eine Zeile oder der Kopf kommt nie durch). */
  haengend?: number;
  /** Letzte Fehlermeldung in einfachen Worten — wird dem Nutzer gezeigt statt verschluckt. */
  fehlerText?: string;
}

/** Keine Antwort vom Server: kein Netz, WLAN mit Anmeldeseite, Zeitüberschreitung (supabase.ts). */
function istVerbindungsfehler(text: string): boolean {
  return /Failed to fetch|NetworkError|Load failed|AbortError|network|Zeitüberschreitung|kein Netz/i.test(text);
}
const VERBINDUNG_TEXT = 'Keine Verbindung zum Server — die Meldung bleibt auf dem Gerät und geht automatisch raus.';

/** Was zeigt bei einem Fremdschlüssel-Fehler ins Leere? */
function fehltWas(message: string): string {
  return /team_id/.test(message) ? 'das Team' : /mitarbeiter_id/.test(message) ? 'eine Person' : /baustelle_id/.test(message) ? 'die Baustelle' : 'ein Stammdatensatz';
}

/**
 * Postgres-Fehler in einen Satz übersetzen, den ein Chefmonteur versteht.
 * Gibt zusätzlich zurück, ob der Eintrag je durchkommen kann.
 */
function fehlerDeuten(err: { code?: string; message: string }): { text: string; endgueltig: boolean } {
  if (err.code === '23503') {
    // Fremdschlüssel: die Meldung zeigt auf ein Team, eine Baustelle oder eine Person, die es auf dem Server nicht (mehr) gibt.
    const was = fehltWas(err.message);
    return { text: `${was[0].toUpperCase()}${was.slice(1)} dieser Meldung gibt es auf dem Server nicht mehr (z. B. im Büro gelöscht). Die Meldung bleibt auf dem Gerät — bitte Büro anrufen.`, endgueltig: true };
  }
  if (/(von3_min|bis3_min)/.test(err.message) && /does not exist|schema cache/.test(err.message)) {
    // Dritte Spanne (Pause abgezogen + Nachmittag) vor Migration 0029 — nur diese Meldung wartet, die übrigen gehen durch
    return { text: 'Die Datenbank kennt die Zeit nach der Pause noch nicht — Migration 0029 ausführen. Die Meldung bleibt auf dem Gerät.', endgueltig: false };
  }
  if (err.code === '42703' || /column .* does not exist/.test(err.message)) {
    return { text: `Die Datenbank ist nicht auf dem neusten Stand (${err.message}). Migration ausführen.`, endgueltig: false };
  }
  if (err.code === '23514' && /abweichung_typ/.test(err.message)) {
    // Prüfregel der Datenbank kennt die Abweichungsart noch nicht (z. B. «laenger» vor Migration 0014) — Meldung bleibt, nicht verwerfen
    return { text: 'Die Datenbank kennt diese Abweichungsart noch nicht — Migration 0014 ausführen. Die Meldung bleibt auf dem Gerät.', endgueltig: false };
  }
  if (err.code === '42501' || /row-level security/.test(err.message)) {
    return { text: 'Keine Berechtigung — bitte neu anmelden.', endgueltig: false };
  }
  if (istVerbindungsfehler(err.message)) return { text: VERBINDUNG_TEXT, endgueltig: false };
  return { text: err.message, endgueltig: false };
}

/** Grund für eine einzelne Zeile, die der Server endgültig ablehnt. */
function zeileGrund(err: { message: string }): string {
  const was = fehltWas(err.message);
  return was === 'eine Person' ? 'diese Person gibt es auf dem Server nicht mehr' : `${was} dieser Zeile gibt es auf dem Server nicht mehr`;
}

/**
 * Datei in den Bucket «anhaenge» legen — OHNE upsert: Seit Migration 0009 darf niemand Belege
 * überschreiben oder löschen (CLAUDE.md #8). Liegt die Datei schon (409 / «already exists»),
 * gilt das als Erfolg: der Pfad ist deterministisch, der Inhalt derselbe — ein früherer Flush
 * kam bis hierhin und brach erst danach ab.
 */
async function belegHochladen(client: SupabaseClient, pfad: string, blob: Blob, contentType: string): Promise<string | null> {
  const { error } = await client.storage.from('anhaenge').upload(pfad, blob, { upsert: false, contentType });
  if (!error) return null;
  const e = error as { message?: string; statusCode?: string | number; status?: number; error?: string };
  const schonDa =
    String(e.statusCode ?? e.status ?? '') === '409' ||
    /already exists|duplicate/i.test(e.message ?? '') ||
    /duplicate/i.test(e.error ?? '');
  if (schonDa) return null;
  const text = e.message ?? 'Upload fehlgeschlagen';
  return istVerbindungsfehler(text) ? 'keine Verbindung zum Server, geht automatisch nochmals' : text;
}

export type LokaleMeldung = QueueEintrag;
export type LokalerAuftrag = QueueEintrag;

/**
 * Belege liegen als rohe Bytes im Gerätespeicher, nicht als Blob: Safari (iPhone) wirft beim
 * Ablegen von Blobs in IndexedDB zeitweise «Error preparing Blob/File data to be stored in
 * object store» (WebKit-Fehler, 04.10.2026 auf der Baustelle passiert). Bytes verträgt es.
 * Alte Zeilen von früheren App-Fassungen tragen noch `blob` — beim Lesen zählt beides.
 */
export interface LokalesAudio {
  client_uuid: string;
  bytes?: ArrayBuffer;
  typ?: string;
  blob?: Blob;
}

/** Foto zu einer Meldung — id ist die spätere Zeile in `foto`, client_uuid die Meldung. */
export interface LokalesFoto {
  id: string;
  client_uuid: string;
  bytes?: ArrayBuffer;
  typ?: string;
  blob?: Blob;
}

/** Blob → speicherbare Bytes (Safari-sicher) … */
async function alsBytes(b: Blob): Promise<{ bytes: ArrayBuffer; typ: string }> {
  return { bytes: await b.arrayBuffer(), typ: b.type };
}
/** … und beim Lesen wieder ein Blob, egal in welcher Form die Zeile liegt. */
function alsBlob(r: { bytes?: ArrayBuffer; typ?: string; blob?: Blob }): Blob {
  return r.blob ?? new Blob([r.bytes ?? new ArrayBuffer(0)], { type: r.typ ?? '' });
}

/** Eine Tagesmeldung samt Zeiteinträgen — ids werden auf dem Gerät vergeben. */
export interface MeldungPayload {
  id: string;
  team_id: string;
  datum: string;
  baustelle_id: string;
  normalfall: boolean;
  abweichung_typ: 'zusaetzlich' | 'warten' | 'kaputt' | 'laenger' | null;
  wer_hats_gewollt: 'kunde' | 'chef' | 'niemand' | null;
  audio_sekunden: number | null;
  erfasst_von: string | null;
  /** Text der Sprachnotiz, wenn er schon beim Erfassen erstellt und vom Chefmonteur geprüft wurde (sonst nach dem Upload). */
  transkript?: string | null;
  transkript_quelle?: string | null;
  transkript_sprache?: string | null;
  /** Subunternehmer hatten den Lieferwagen der Firma (Migration 0036) — nur gesetzt, wenn ja; sonst fehlt das Feld ganz. */
  lieferwagen?: boolean;
  eintraege: {
    id: string;
    mitarbeiter_id: string;
    normal_min: number;
    ueber_min: number;
    oev: boolean;
    km: number;
    baustelle_id: string;
    konto_nr: string;
    /** Zeiten von–bis (Migration 0016), nur wenn das Team Zeiten statt der Stundenzahl eingetragen hat. */
    von_min?: number | null;
    bis_min?: number | null;
    von2_min?: number | null;
    bis2_min?: number | null;
    /** Dritte Spanne (Migration 0029) — nur nach einem Pausen-Abzug mit Nachmittag, sonst fehlt das Feld ganz. */
    von3_min?: number | null;
    bis3_min?: number | null;
  }[];
}

class LokaleDb extends Dexie {
  meldungen!: Table<LokaleMeldung, string>;
  audio!: Table<LokalesAudio, string>;
  fotos!: Table<LokalesFoto, string>;
  /** Zusatzaufträge — nur im Regie-Modus benutzt, die Tabelle existiert aber immer (ein Code, zwei Modi). */
  auftraege!: Table<LokalerAuftrag, string>;

  constructor() {
    super('geruest-rapport');
    this.version(1).stores({
      meldungen: 'client_uuid, status, erstellt',
      audio: 'client_uuid',
    });
    this.version(2).stores({
      meldungen: 'client_uuid, status, erstellt',
      audio: 'client_uuid',
      auftraege: 'client_uuid, status, erstellt',
    });
    this.version(3).stores({
      meldungen: 'client_uuid, status, erstellt',
      audio: 'client_uuid',
      auftraege: 'client_uuid, status, erstellt',
      fotos: 'id, client_uuid',
    });
    // 20.09.: Zusatzaufträge gibt es nicht mehr — Tabelle entfernen (null = löschen)
    this.version(4).stores({
      meldungen: 'client_uuid, status, erstellt',
      audio: 'client_uuid',
      auftraege: null,
      fotos: 'id, client_uuid',
    });
    // 02.10.: Regie ist pro Firma zuschaltbar (MODUS_ERFASSUNG) — die Warteschlange kommt zurück.
    // Im Modus «wochenblatt» bleibt sie einfach leer.
    // 13.10.: neue Felder (Firma, rev, Fehler je Zeile) brauchen keinen Index und darum keine neue Version.
    this.version(5).stores({
      meldungen: 'client_uuid, status, erstellt',
      audio: 'client_uuid',
      auftraege: 'client_uuid, status, erstellt',
      fotos: 'id, client_uuid',
    });
  }
}

export const db = new LokaleDb();

// ── Eine Sperre für alles, was die Warteschlange verändert (13.10.2026) ──────────────────────────────

let kette: Promise<unknown> = Promise.resolve();

/**
 * `fn` erst ausführen, wenn kein anderer Durchgang läuft — Senden, Ändern und Ersetzen einer Meldung kommen einander so
 * nie in die Quere. Die Sperre gilt für alle Aufrufer im selben Tab (Hintergrund, Startseite, Teamgerät).
 */
export function exklusiv<T>(fn: () => Promise<T>): Promise<T> {
  const p = kette.then(fn);
  kette = p.catch(() => undefined);
  return p;
}

type Beobachter = (erg?: FlushErgebnis) => void;
const beobachter = new Set<Beobachter>();

/** Bescheid bekommen, wenn sich in der Warteschlange etwas getan hat (Senden fertig, neue Meldung, Entscheid). */
export function warteschlangeBeobachten(fn: Beobachter): () => void {
  beobachter.add(fn);
  return () => { beobachter.delete(fn); };
}

/** Alle Beobachter wecken — auch für ersetzen.ts. */
export function warteschlangeGeaendert(erg?: FlushErgebnis): void {
  for (const f of [...beobachter]) {
    try { f(erg); } catch { /* ein Bildschirm darf das Senden nicht aufhalten */ }
  }
}

/** Anmeldung, wie sie auf dem Gerät gemerkt ist — ohne Abfrage, für Zählen und Anzeigen. */
function zugangJetzt(): { user: string | null; firma: string | null } {
  const z = zugang();
  return { user: z?.user ?? null, firma: z?.firma ?? null };
}

/**
 * Anmeldung fürs Senden: der Benutzer aus der Sitzung des Clients (nicht aus dem Gemerkten — beim Start kann noch die
 * Firma vom letzten Mal im Speicher stehen), die Firma nur, wenn sie zu diesem Benutzer gehört.
 */
async function zugangZumSenden(client: SupabaseClient): Promise<{ user: string | null; firma: string | null }> {
  let user: string | null = null;
  try {
    const { data } = await client.auth.getSession();
    user = data.session?.user.id ?? null;
  } catch { /* Client ohne Anmeldung (Test) — dann zählen nur Alt-Einträge */ }
  return { user, firma: firmaVon(user).firma };
}

function neuerEintrag(payload: Record<string, unknown>, namen?: Record<string, string>): QueueEintrag {
  const z = zugang();
  return {
    client_uuid: crypto.randomUUID(), payload, erstellt: Date.now(), status: 'lokal', rev: 0,
    firma_id: z?.firma ?? null, firma_name: z?.name ?? null, auth_user_id: z?.user ?? null,
    ...(namen ? { namen } : {}),
  };
}

/**
 * Sprachnotiz und Fotos ablegen. Schlägt das fehl, ist das ärgerlich, aber kein Grund, die
 * Stunden zu verlieren (Fehler vom 03.10.2026): auf dem iPhone im privaten Modus und bei vollem
 * Speicher wirft IndexedDB beim Ablegen eines Blobs. Vorher riss das die ganze Meldung mit, der
 * Chefmonteur sah «Speichern fehlgeschlagen» und tippte nochmals — fünf Meldungen später.
 *
 * Gibt den Grund als Satz zurück, wenn etwas nicht abgelegt werden konnte.
 */
async function belegeAblegen(clientUuid: string, audio?: Blob, fotos: Blob[] = []): Promise<string | undefined> {
  const grund = (e: unknown) => (e instanceof Error ? e.message : String(e));
  try {
    if (audio) await db.audio.add({ client_uuid: clientUuid, ...(await alsBytes(audio)) });
  } catch (e) {
    return `Die Sprachnotiz liess sich auf diesem Gerät nicht ablegen (${grund(e)}). Die Meldung selbst ist gespeichert und geht raus.`;
  }
  try {
    for (const blob of fotos) await db.fotos.add({ id: crypto.randomUUID(), client_uuid: clientUuid, ...(await alsBytes(blob)) });
  } catch (e) {
    return `Die Fotos liessen sich auf diesem Gerät nicht ablegen (${grund(e)}). Die Meldung selbst ist gespeichert und geht raus.`;
  }
  return undefined;
}

/** Tagesmeldung lokal ablegen. Gibt die client_uuid zurück. `namen` (Person → Name) nur für den Bildschirm. */
export async function enqueueMeldung(payload: MeldungPayload, audio?: Blob, fotos: Blob[] = [], namen?: Record<string, string>): Promise<string> {
  const e = neuerEintrag(payload as unknown as Record<string, unknown>, namen);
  await db.meldungen.add(e);
  const belegFehler = await belegeAblegen(e.client_uuid, audio, fotos);
  if (belegFehler) await db.meldungen.update(e.client_uuid, { belegFehler });
  warteschlangeGeaendert();
  return e.client_uuid;
}

/** Konnte ein Beleg nicht abgelegt werden? Der Satz dazu, für den Bildschirm. */
export async function belegFehlerVon(clientUuid: string): Promise<string | undefined> {
  return (await db.meldungen.get(clientUuid))?.belegFehler;
}

/** Sprachnotiz und Fotos einer Meldung auf dem Gerät, als Blobs (Kopien — die Zeilen bleiben liegen). */
export async function belegeLesen(clientUuid: string): Promise<{ audio?: Blob; fotos: Blob[] }> {
  const [a, f] = await Promise.all([db.audio.get(clientUuid), db.fotos.where('client_uuid').equals(clientUuid).toArray()]);
  return { audio: a ? alsBlob(a) : undefined, fotos: f.map(alsBlob) };
}

/** Ergebnis von `aktualisiereMeldung`. */
export type Aktualisierung =
  | { art: 'aktualisiert'; uuid: string }
  /** Die Meldung ist gesendet, ersetzt oder weg — der Aufrufer legt eine neue an. */
  | { art: 'neu' }
  /** Schon unterwegs zum Server — weder ändern noch eine zweite anlegen. */
  | { art: 'unterwegs' };

/**
 * Eine wartende Meldung nochmals versuchen, statt eine zweite anzulegen (Fehler vom 03.10.2026).
 *
 * Am Handy kam beim Senden ein Fehler. Jeder weitere Druck auf «Tag melden» legte eine neue
 * Meldung an — am Ende standen fünf gleiche Tage mit 95 Stunden beim Bauführer. Jetzt bekommt
 * der zweite Druck dieselbe Meldung: der Kopf behält seine `id`, jede Person ihre Eintrags-`id`.
 * Nur so bleibt der Upsert auf dem Server idempotent, und es entsteht nie eine Dublette.
 *
 * Seit 13.10.2026: Hat das Senden schon begonnen, wird nichts mehr geändert (`unterwegs`) — Kopf und Zeilen gehen mit
 * «ignoreDuplicates», eine geänderte Fassung käme auf dem Server nie an. Und die alte Fassung wird nicht überschrieben,
 * sondern als «ersetzt» abgelegt: ihre Sprachnotiz und Fotos bleiben auf dem Gerät (CLAUDE.md #8). Die neue Fassung
 * bekommt eine eigene client_uuid und behält die Kennungen.
 */
export function aktualisiereMeldung(clientUuid: string, payload: MeldungPayload, audio?: Blob, fotos: Blob[] = []): Promise<Aktualisierung> {
  return exklusiv(async (): Promise<Aktualisierung> => {
    const alt = await db.meldungen.get(clientUuid);
    if (!alt || alt.status !== 'lokal' || alt.zurueckgezogen) return { art: 'neu' };
    if (alt.versucht || alt.amServer) return { art: 'unterwegs' };

    const altP = alt.payload as unknown as MeldungPayload;
    // Die Kennungen der ersten Fassung behalten; neue Personen bekommen ihre eigene
    const idFuer = new Map((altP.eintraege ?? []).map((z) => [z.mitarbeiter_id, z.id]));
    const neu: MeldungPayload = {
      ...payload,
      id: altP.id,
      eintraege: payload.eintraege.map((z) => ({ ...z, id: idFuer.get(z.mitarbeiter_id) ?? z.id })),
    };
    const e = neuerEintrag(neu as unknown as Record<string, unknown>, alt.namen);
    // Herkunft der ersten Fassung gilt weiter, falls sie damals schon bekannt war
    if (alt.firma_id && !e.firma_id) { e.firma_id = alt.firma_id; e.firma_name = alt.firma_name ?? null; }
    if (alt.auth_user_id && !e.auth_user_id) e.auth_user_id = alt.auth_user_id;
    await db.transaction('rw', db.meldungen, async () => {
      await db.meldungen.update(clientUuid, { status: 'ersetzt', rev: (alt.rev ?? 0) + 1 });
      await db.meldungen.add(e);
    });
    const belegFehler = await belegeAblegen(e.client_uuid, audio, fotos);
    if (belegFehler) await db.meldungen.update(e.client_uuid, { belegFehler });
    warteschlangeGeaendert();
    return { art: 'aktualisiert', uuid: e.client_uuid };
  });
}

/** Noch nicht gesendet — nur, was zur aktuellen Anmeldung gehört (Meldungen und Zusatzaufträge). */
export async function offeneAnzahl(): Promise<number> {
  const z = zugangJetzt();
  const [m, a] = await Promise.all([
    db.meldungen.where('status').equals('lokal').toArray(),
    db.auftraege.where('status').equals('lokal').toArray(),
  ]);
  return m.filter((e) => gehoertZu(e, z)).length + a.filter((e) => gehoertZu(e, z)).length;
}

/** Zusatzauftrag lokal ablegen (Bauführer am Telefon — muss auch ohne Netz klappen). Nur Regie-Modus. */
export async function enqueueZusatzauftrag(payload: Record<string, unknown>): Promise<string> {
  const e = neuerEintrag(payload);
  await db.auftraege.add(e);
  warteschlangeGeaendert();
  return e.client_uuid;
}

/** Noch nicht gesendete Zusatzaufträge — für die «wird gesendet…»-Anzeige in der Liste. */
export async function offeneAuftraege(): Promise<LokalerAuftrag[]> {
  const z = zugangJetzt();
  return (await db.auftraege.where('status').equals('lokal').sortBy('erstellt')).filter((e) => gehoertZu(e, z));
}

/** Noch nicht gesendete Tagesmeldungen (lokal) der aktuellen Anmeldung. */
export async function offeneMeldungen(): Promise<LokaleMeldung[]> {
  const z = zugangJetzt();
  return (await db.meldungen.where('status').equals('lokal').sortBy('erstellt')).filter((e) => gehoertZu(e, z));
}

/** Ein Ersetzen, das länger als 10 Minuten «läuft», ist abgestürzt — dann gilt die Meldung wieder als normal wartend. */
const ZURUECK_MS = 10 * 60 * 1000;
function wirdErsetzt(e: QueueEintrag | undefined): boolean {
  return !!e?.zurueckgezogen && Date.now() - e.zurueckgezogen < ZURUECK_MS;
}

/**
 * Meldung in drei idempotenten Schritten: Kopfzeile, Zeiteinträge, Sprachnotiz (dazu Fotos).
 * Bricht ein Schritt ab, wiederholt der nächste Flush ab dort — nichts wird doppelt.
 */
async function flushMeldungen(client: SupabaseClient, z: { user: string | null; firma: string | null }): Promise<FlushErgebnis> {
  const offene = (await db.meldungen.where('status').equals('lokal').sortBy('erstellt')).filter((e) => gehoertZu(e, z));
  let gesendet = 0;
  let fehler = 0;
  let verworfen = 0;
  let haengend = 0;
  let fehlerText: string | undefined;
  const merken = async (uuid: string, text: string) => {
    fehlerText = text;
    await db.meldungen.update(uuid, { fehlerText: text, fehlerZeit: Date.now() });
  };
  for (const vorher of offene) {
    const uuid = vorher.client_uuid;
    // Frisch lesen: seit dem Schnappschuss kann sie ersetzt oder entschieden worden sein
    const e = await db.meldungen.get(uuid);
    if (!e || e.status !== 'lokal' || wirdErsetzt(e)) continue;
    const p = e.payload as unknown as Partial<MeldungPayload>;
    // Alt-Einträge aus frühen Tests (anderes Format) dürfen die Warteschlange nicht blockieren
    if (typeof p.id !== 'string' || !Array.isArray(p.eintraege)) {
      await db.meldungen.update(uuid, { status: 'verworfen' });
      verworfen += 1;
      continue;
    }
    // Kopf kommt nie durch — erst wieder, wenn der Chefmonteur «Nochmals versuchen» tippt
    if (e.kopfFehler) { haengend += 1; fehlerText = e.kopfFehler; continue; }
    const rev = e.rev ?? 0;
    /** Wird die Meldung gerade ersetzt? Dann hier aufhören — das Ersetzen kümmert sich um den Rest. */
    const abgebrochen = async () => {
      const f = await db.meldungen.get(uuid);
      return !f || f.status !== 'lokal' || wirdErsetzt(f);
    };
    try {
      const { eintraege, ...kopf } = p as MeldungPayload;
      if (!e.versucht) await db.meldungen.update(uuid, { versucht: true });
      const { error: e1 } = await client
        .from('tagesmeldung')
        .upsert({ ...kopf, client_uuid: uuid }, { onConflict: 'client_uuid', ignoreDuplicates: true });
      if (e1) {
        // Hat der Server selbst abgelehnt (Fehlercode) oder ging die Anfrage gar nicht hinaus, steht sicher nichts dort —
        // dann gilt die Meldung weiter als «nie unterwegs» (ändern und ersetzen gehen ohne Rückfrage beim Server)
        const nieAngekommen = /kein Netz/.test(e1.message) || (!!e1.code && !istVerbindungsfehler(e1.message));
        if (nieAngekommen && !e.versucht) await db.meldungen.update(uuid, { versucht: false });
        const d = fehlerDeuten(e1);
        if (d.endgueltig) {
          // Nicht verwerfen (13.10.2026): Meldung, Sprachnotiz und Fotos bleiben; der Chefmonteur sieht den Grund
          await db.meldungen.update(uuid, { kopfFehler: d.text });
          haengend += 1;
        } else fehler += 1;
        await merken(uuid, d.text);
        continue;
      }
      if (!e.amServer) await db.meldungen.update(uuid, { amServer: true });

      // Zeilen — ohne die, die der Server schon endgültig abgelehnt hat (die wartet auf den Chefmonteur)
      // und ohne die, die er bewusst ausgelassen hat
      const weg = new Set((e.ausgelassen ?? []).map((x) => x.id));
      const zeilen = eintraege.filter((x) => !weg.has(x.id));
      let zeilenFehler = e.zeilenFehler ?? [];
      if (zeilen.length > 0 && zeilenFehler.length === 0) {
        if (await abgebrochen()) continue;
        const senden = (liste: typeof zeilen) => client
          .from('zeiteintrag')
          .upsert(liste.map((x) => ({ ...x, tagesmeldung_id: p.id })), { onConflict: 'id', ignoreDuplicates: true });
        const { error: e2 } = await senden(zeilen);
        if (e2) {
          const d = fehlerDeuten(e2);
          if (!d.endgueltig) { fehler += 1; await merken(uuid, d.text); continue; }
          // Eine Zeile zeigt ins Leere (z. B. Person im Büro gelöscht): einzeln senden, damit die anderen durchkommen
          const abgelehnt: ZeilenFehler[] = [];
          let anderer: string | null = null;
          for (const x of zeilen) {
            const { error } = await senden([x]);
            if (!error) continue;
            const dx = fehlerDeuten(error);
            if (dx.endgueltig) abgelehnt.push({ id: x.id, mitarbeiter_id: x.mitarbeiter_id, grund: zeileGrund(error) });
            else { anderer = dx.text; break; }
          }
          if (anderer) { fehler += 1; await merken(uuid, anderer); continue; }
          zeilenFehler = abgelehnt;
          await db.meldungen.update(uuid, { zeilenFehler });
        }
      }

      const audio = await db.audio.get(uuid);
      if (audio) {
        if (await abgebrochen()) continue;
        const ton = alsBlob(audio);
        // Endung nach echtem Typ: iPhone liefert AAC/M4A, Android WebM. Die Speicher-Regel und
        // die Transkription schneiden die Endung ab bzw. lesen sie — beides verträgt .m4a.
        const endung = ton.type.includes('mp4') ? 'm4a' : ton.type.includes('ogg') ? 'ogg' : 'webm';
        const pfad = `audio/${uuid}.${endung}`;
        const e3 = await belegHochladen(client, pfad, ton, ton.type || 'audio/webm');
        if (e3) { fehler += 1; await merken(uuid, 'Sprachnotiz konnte nicht hochgeladen werden: ' + e3); continue; }
        // Der lokale Blob geht erst weg, wenn der Pfad an der Meldung steht — sonst wäre der Beleg verwaist.
        // Gezählt wird die Zeile, nicht nur «kein Fehler»: lässt eine Regel das Ändern nicht zu, meldet Postgres nichts.
        const { data: verknuepft, error: e3b } = await client.from('tagesmeldung').update({ audio_pfad: pfad }).eq('client_uuid', uuid).select('id');
        if (e3b) { fehler += 1; await merken(uuid, 'Sprachnotiz konnte nicht verknüpft werden: ' + fehlerDeuten(e3b).text); continue; }
        if (!verknuepft || verknuepft.length === 0) { fehler += 1; await merken(uuid, 'Sprachnotiz konnte nicht verknüpft werden: die Meldung ist auf dem Server nicht zu finden. Sie bleibt auf dem Gerät.'); continue; }
        await db.audio.delete(uuid);
        // Text zur Aufnahme — läuft im Hintergrund; ein Fehler hier hält die Warteschlange nicht auf.
        // Text nur noch nachträglich erstellen, wenn er nicht schon geprüft mitkam (z. B. offline erfasst)
        if (!p.transkript) {
          try { void client.functions?.invoke('transkribieren', { body: { client_uuid: uuid } }).catch(() => undefined); } catch { /* kein Functions-Client (Test) */ }
        }
      }

      // Fotos: eins nach dem andern, jedes idempotent (Pfad und Zeile über die id) — bricht eins ab, kommt der Rest beim nächsten Mal
      const fotos = await db.fotos.where('client_uuid').equals(uuid).toArray();
      let fotoFehler: string | null = null;
      for (const f of fotos) {
        if (await abgebrochen()) { fotoFehler = ''; break; }
        const pfad = `fotos/${uuid}/${f.id}.jpg`;
        const e4 = await belegHochladen(client, pfad, alsBlob(f), 'image/jpeg');
        if (e4) { fotoFehler = 'Foto konnte nicht hochgeladen werden: ' + e4; break; }
        const { error: e5 } = await client.from('foto').upsert({ id: f.id, tagesmeldung_id: p.id, pfad, erstellt_von: p.erfasst_von }, { onConflict: 'id', ignoreDuplicates: true });
        if (e5) { fotoFehler = 'Foto: ' + fehlerDeuten(e5).text; break; }
        await db.fotos.delete(f.id);
      }
      if (fotoFehler !== null) { if (fotoFehler) { fehler += 1; await merken(uuid, fotoFehler); } continue; }

      // Alles andere ist drin — fehlt nur die eine Zeile, wartet die Meldung auf den Chefmonteur
      if (zeilenFehler.length > 0) {
        haengend += 1;
        await merken(uuid, problemText(e, zeilenFehler) ?? 'Eine Zeile konnte nicht gesendet werden.');
        continue;
      }

      // «gesendet» nur, wenn sich die Meldung seit dem Start nicht verändert hat und niemand sie gerade ersetzt
      const fertig = await db.transaction('rw', db.meldungen, async () => {
        const f = await db.meldungen.get(uuid);
        if (!f || f.status !== 'lokal' || wirdErsetzt(f) || (f.rev ?? 0) !== rev) return false;
        await db.meldungen.update(uuid, { status: 'gesendet', fehlerText: undefined, fehlerZeit: undefined });
        return true;
      });
      if (fertig) gesendet += 1;
    } catch (err) {
      fehler += 1;
      const text = err instanceof Error ? err.message : String(err);
      await merken(uuid, istVerbindungsfehler(text) ? VERBINDUNG_TEXT : text).catch(() => undefined);
    }
  }
  return { gesendet, fehler, verworfen, haengend, fehlerText };
}

/** Lokale Warteschlange komplett leeren — nur noch für Tests. Die App leert höchstens die Demo-Firma (`firmaWarteschlangeLeeren`). */
export async function lokaleWarteschlangeLeeren(): Promise<void> {
  await Promise.all([db.meldungen.clear(), db.audio.clear(), db.auftraege.clear(), db.fotos.clear()]);
}

/**
 * Demo neu laden: die wartenden Einträge der Demo-Firma zeigen danach ins Leere und dürfen weg. Nur Einträge, die
 * nachweislich zu dieser Firma gehören — Meldungen einer anderen Firma oder ohne Firma (vor dem 13.10.2026) bleiben.
 * Gibt die Anzahl entfernter Einträge zurück.
 */
export function firmaWarteschlangeLeeren(firmaId: string): Promise<number> {
  return exklusiv(async () => {
    const m = await db.meldungen.filter((e) => e.firma_id === firmaId).toArray();
    const a = await db.auftraege.filter((e) => e.firma_id === firmaId).toArray();
    for (const e of m) {
      await db.audio.delete(e.client_uuid);
      await db.fotos.where('client_uuid').equals(e.client_uuid).delete();
      await db.meldungen.delete(e.client_uuid);
    }
    for (const e of a) await db.auftraege.delete(e.client_uuid);
    warteschlangeGeaendert();
    return m.length + a.length;
  });
}

/**
 * Sobald die Firma zu einer Anmeldung bekannt ist (konto.ts): Meldungen, die dieser Benutzer erfasst hat, bevor die
 * Datenbank antwortete, bekommen ihre Firma nachgetragen.
 */
export async function warteschlangeZuordnen(user: string, firma: string, name: string | null): Promise<void> {
  // Ohne Sperre: nur die Herkunft wird ergänzt, nicht der Inhalt — ein laufendes Senden darf dabei weiterlaufen
  const ohne = (e: QueueEintrag) => e.auth_user_id === user && !e.firma_id;
  await db.meldungen.filter(ohne).modify({ firma_id: firma, firma_name: name });
  await db.auftraege.filter(ohne).modify({ firma_id: firma, firma_name: name });
}

/** Zusatzaufträge senden — im Wochenblatt-Modus ist die Warteschlange leer, die Schleife läuft nicht. */
async function flushAuftraege(client: SupabaseClient, z: { user: string | null; firma: string | null }): Promise<FlushErgebnis> {
  const offene = (await db.auftraege.where('status').equals('lokal').sortBy('erstellt')).filter((e) => gehoertZu(e, z));
  let gesendet = 0;
  let fehler = 0;
  let verworfen = 0;
  let fehlerText: string | undefined;
  for (const e of offene) {
    try {
      const { error } = await client
        .from('zusatzauftrag')
        .upsert({ ...e.payload, client_uuid: e.client_uuid }, { onConflict: 'client_uuid', ignoreDuplicates: true });
      if (error) {
        const d = fehlerDeuten(error);
        if (d.endgueltig) {
          // Ein Zusatzauftrag hat keine Belege; die Baustelle gibt es nicht mehr — aussortiert, wie bisher
          fehlerText = `${fehltWas(error.message)} dieses Zusatzauftrags gibt es auf dem Server nicht mehr — Auftrag aussortiert.`;
          await db.auftraege.update(e.client_uuid, { status: 'verworfen' });
          verworfen += 1;
        } else { fehlerText = d.text; fehler += 1; }
        continue;
      }
      await db.auftraege.update(e.client_uuid, { status: 'gesendet' });
      gesendet += 1;
    } catch (err) {
      fehler += 1;
      fehlerText = err instanceof Error ? err.message : String(err);
    }
  }
  return { gesendet, fehler, verworfen, fehlerText };
}

/** Ein Durchgang: erst die Meldungen, dann die Zusatzaufträge. */
async function durchgang(client: SupabaseClient): Promise<FlushErgebnis> {
  const z = await zugangZumSenden(client);
  const m = await flushMeldungen(client, z);
  const a = await flushAuftraege(client, z);
  return {
    gesendet: m.gesendet + a.gesendet,
    fehler: m.fehler + a.fehler,
    verworfen: m.verworfen + a.verworfen,
    haengend: m.haengend ?? 0,
    fehlerText: m.fehlerText ?? a.fehlerText,
  };
}

let wartenderFlush: Promise<FlushErgebnis> | null = null;

/**
 * Alle lokalen Einträge zum Server schieben. Läuft schon ein Durchgang, wartet der Aufruf dahinter (es läuft nie mehr
 * als einer); wartet schon einer, schliesst sich der Aufruf ihm an — er sieht alles, was bis zu seinem Start dazukommt.
 */
export function flushNachSupabase(client: SupabaseClient): Promise<FlushErgebnis> {
  if (wartenderFlush) return wartenderFlush;
  const p = exklusiv(async () => {
    wartenderFlush = null;
    const erg = await durchgang(client);
    warteschlangeGeaendert(erg);
    return erg;
  });
  wartenderFlush = p;
  p.catch(() => undefined).finally(() => { if (wartenderFlush === p) wartenderFlush = null; });
  return p;
}

// ── Was der Chefmonteur sehen und entscheiden muss ───────────────────────────────────────────────

/** Eine Meldung, die nicht von allein durchkommt — mit Grund in einfachen Worten. */
export interface Problem {
  client_uuid: string;
  datum: string | null;
  art: 'kopf' | 'zeilen';
  text: string;
  /** Namen der Personen in den abgelehnten Zeilen (art 'zeilen') */
  namen: string[];
}

/** «1 Zeile konnte nicht gesendet werden: Marco Rossi — diese Person gibt es auf dem Server nicht mehr. Bitte Büro anrufen.» */
export function problemText(e: Pick<QueueEintrag, 'kopfFehler' | 'zeilenFehler' | 'namen'>, zeilen = e.zeilenFehler ?? []): string | null {
  if (e.kopfFehler) return e.kopfFehler;
  if (zeilen.length === 0) return null;
  const namen = zeilen.map((x) => e.namen?.[x.mitarbeiter_id] ?? 'eine Person');
  const gruende = [...new Set(zeilen.map((x) => x.grund))].join('; ');
  return `${zeilen.length} ${zeilen.length === 1 ? 'Zeile konnte' : 'Zeilen konnten'} nicht gesendet werden: ${namen.join(', ')} — ${gruende}. Bitte Büro anrufen.`;
}

export interface WarteStand {
  /** Wartet noch, mit dieser Anmeldung (inkl. Probleme) */
  offen: number;
  /** Letzter Fehler beim Senden (der jüngste) */
  fehlerText?: string;
  fehlerZeit?: number;
  probleme: Problem[];
  /** Meldungen einer anderen Firma auf diesem Gerät — warten auf deren Anmeldung */
  fremd: { name: string | null; anzahl: number }[];
}

/** Alles, was die Startseite über die Warteschlange zeigt — ohne Netz, nur aus dem Gerät. */
export async function warteStand(): Promise<WarteStand> {
  const z = zugangJetzt();
  const alle = await db.meldungen.where('status').equals('lokal').sortBy('erstellt');
  const eigene = alle.filter((e) => gehoertZu(e, z));
  const fremdJe = new Map<string, { name: string | null; anzahl: number }>();
  for (const e of alle) {
    if (gehoertZu(e, z)) continue;
    const k = e.firma_id ?? e.auth_user_id ?? '?';
    const x = fremdJe.get(k) ?? { name: e.firma_name ?? null, anzahl: 0 };
    x.anzahl += 1;
    fremdJe.set(k, x);
  }
  // Letzter Fehler der Meldungen, die von allein weiterversucht werden — die Probleme stehen je für sich
  const letzter = eigene.filter((e) => e.fehlerText && !problemText(e)).sort((a, b) => (b.fehlerZeit ?? 0) - (a.fehlerZeit ?? 0))[0];
  const probleme: Problem[] = [];
  for (const e of eigene) {
    const text = problemText(e);
    if (!text) continue;
    const p = e.payload as unknown as Partial<MeldungPayload>;
    probleme.push({
      client_uuid: e.client_uuid, datum: typeof p.datum === 'string' ? p.datum : null,
      art: e.kopfFehler ? 'kopf' : 'zeilen', text,
      namen: (e.zeilenFehler ?? []).map((x) => e.namen?.[x.mitarbeiter_id] ?? 'eine Person'),
    });
  }
  return { offen: eigene.length + (await offeneAuftraege()).length, fehlerText: letzter?.fehlerText, fehlerZeit: letzter?.fehlerZeit, probleme, fremd: [...fremdJe.values()] };
}

/** «Ohne diese Person abschliessen»: die abgelehnten Zeilen bleiben im Eintrag stehen, der Rest gilt als gesendet. */
export function zeilenAuslassen(clientUuid: string): Promise<void> {
  return exklusiv(async () => {
    const e = await db.meldungen.get(clientUuid);
    if (!e || e.status !== 'lokal' || !e.zeilenFehler?.length) return;
    await db.meldungen.update(clientUuid, { ausgelassen: [...(e.ausgelassen ?? []), ...e.zeilenFehler], zeilenFehler: [], rev: (e.rev ?? 0) + 1 });
    warteschlangeGeaendert();
  });
}

/** «Nochmals versuchen» — z. B. nachdem das Büro die Person oder Baustelle wieder angelegt hat. */
export function nochmalsVersuchen(clientUuid: string): Promise<void> {
  return exklusiv(async () => {
    const e = await db.meldungen.get(clientUuid);
    if (!e || e.status !== 'lokal') return;
    await db.meldungen.update(clientUuid, { kopfFehler: undefined, zeilenFehler: [], rev: (e.rev ?? 0) + 1 });
    warteschlangeGeaendert();
  });
}

/**
 * «Beiseitelegen» — nur, wenn der Kopf nie durchkommt (Team oder Baustelle gibt es nicht mehr). Die Meldung wird nicht
 * mehr gesendet, bleibt aber samt Sprachnotiz und Fotos auf dem Gerät (CLAUDE.md #8).
 */
export function meldungBeiseitelegen(clientUuid: string): Promise<void> {
  return exklusiv(async () => {
    const e = await db.meldungen.get(clientUuid);
    if (!e || e.status !== 'lokal' || !e.kopfFehler) return;
    await db.meldungen.update(clientUuid, { status: 'beiseite', rev: (e.rev ?? 0) + 1 });
    warteschlangeGeaendert();
  });
}

let autoGestartet = false;

/**
 * Beim App-Start registrieren — einmal. Gesendet wird:
 *   - beim Start und wenn das Netz zurückkommt («online»),
 *   - wenn die App wieder in den Vordergrund kommt,
 *   - jede Minute, solange etwas wartet. «online» kommt bei schwachem Netz oder im WLAN mit Anmeldeseite nie, obwohl
 *     das Handy die ganze Zeit «verbunden» meldet.
 * Doppelte Durchgänge gibt es nicht: `flushNachSupabase` lässt immer nur einen laufen.
 */
export function startAutoFlush(flush: () => Promise<unknown>, taktMs = 60 * 1000): void {
  if (autoGestartet) return;
  autoGestartet = true;
  const los = () => {
    if (!navigator.onLine) return;
    void flush().catch(() => undefined);
  };
  window.addEventListener('online', los);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') los();
  });
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void offeneAnzahl().then((n) => { if (n > 0) los(); }).catch(() => undefined);
  }, taktMs);
  los();
}
