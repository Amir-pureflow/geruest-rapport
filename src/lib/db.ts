/**
 * Offline-Warteschlange (CLAUDE.md #4/#5):
 * Jede Erfassung schreibt ZUERST hierhin — nie direkt ins Netz.
 * Gesendet wird, sobald Verbindung da ist; der Server dedupliziert
 * über client_uuid bzw. clientseitig vergebene ids — mehrfaches Senden ist harmlos.
 *
 * Zwei Warteschlangen: Tagesmeldungen (Teamgerät, inkl. Zeiteinträge + Sprachnotiz)
 * und Zusatzaufträge (Bauführer).
 */
import Dexie, { type Table } from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';

interface QueueEintrag {
  client_uuid: string;
  payload: Record<string, unknown>;
  erstellt: number;
  status: 'lokal' | 'gesendet' | 'verworfen';
}

export interface FlushErgebnis {
  gesendet: number;
  fehler: number;
  /** Einträge, die nie mehr durchkommen (z. B. Team/Baustelle existiert nicht mehr) — aussortiert. */
  verworfen: number;
  /** Letzte Fehlermeldung in einfachen Worten — wird dem Nutzer gezeigt statt verschluckt. */
  fehlerText?: string;
}

/**
 * Postgres-Fehler in einen Satz übersetzen, den ein Chefmonteur versteht.
 * Gibt zusätzlich zurück, ob der Eintrag je durchkommen kann.
 */
function fehlerDeuten(err: { code?: string; message: string }): { text: string; endgueltig: boolean } {
  if (err.code === '23503') {
    // Fremdschlüssel: die Meldung zeigt auf ein Team, eine Baustelle oder eine Person, die es auf dem Server nicht (mehr) gibt.
    const was = /team_id/.test(err.message) ? 'das Team' : /mitarbeiter_id/.test(err.message) ? 'eine Person' : /baustelle_id/.test(err.message) ? 'die Baustelle' : 'ein Stammdatensatz';
    return { text: `${was} dieser Meldung gibt es auf dem Server nicht mehr (z. B. nach einem Demo-Neustart). Meldung aussortiert — bitte Team neu wählen und nochmals melden.`, endgueltig: true };
  }
  if (err.code === '42703' || /column .* does not exist/.test(err.message)) {
    return { text: `Die Datenbank ist nicht auf dem neusten Stand (${err.message}). Migration ausführen.`, endgueltig: false };
  }
  if (err.code === '42501' || /row-level security/.test(err.message)) {
    return { text: 'Keine Berechtigung — bitte neu anmelden.', endgueltig: false };
  }
  return { text: err.message, endgueltig: false };
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
  return schonDa ? null : (e.message ?? 'Upload fehlgeschlagen');
}

export type LokaleMeldung = QueueEintrag;
export type LokalerAuftrag = QueueEintrag;

export interface LokalesAudio {
  client_uuid: string;
  blob: Blob;
}

/** Foto zu einer Meldung — id ist die spätere Zeile in `foto`, client_uuid die Meldung. */
export interface LokalesFoto {
  id: string;
  client_uuid: string;
  blob: Blob;
}

/** Eine Tagesmeldung samt Zeiteinträgen — ids werden auf dem Gerät vergeben. */
export interface MeldungPayload {
  id: string;
  team_id: string;
  datum: string;
  baustelle_id: string;
  normalfall: boolean;
  abweichung_typ: 'zusaetzlich' | 'warten' | 'kaputt' | null;
  wer_hats_gewollt: 'kunde' | 'chef' | 'niemand' | null;
  audio_sekunden: number | null;
  erfasst_von: string | null;
  /** Text der Sprachnotiz, wenn er schon beim Erfassen erstellt und vom Chefmonteur geprüft wurde (sonst nach dem Upload). */
  transkript?: string | null;
  transkript_quelle?: string | null;
  transkript_sprache?: string | null;
  eintraege: {
    id: string;
    mitarbeiter_id: string;
    normal_min: number;
    ueber_min: number;
    oev: boolean;
    km: number;
    baustelle_id: string;
    konto_nr: string;
  }[];
}

class LokaleDb extends Dexie {
  meldungen!: Table<LokaleMeldung, string>;
  audio!: Table<LokalesAudio, string>;
  auftraege!: Table<LokalerAuftrag, string>;
  fotos!: Table<LokalesFoto, string>;

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
  }
}

export const db = new LokaleDb();

function neuerEintrag(payload: Record<string, unknown>): QueueEintrag {
  return { client_uuid: crypto.randomUUID(), payload, erstellt: Date.now(), status: 'lokal' };
}

/** Tagesmeldung lokal ablegen. Gibt die client_uuid zurück. */
export async function enqueueMeldung(payload: MeldungPayload, audio?: Blob, fotos: Blob[] = []): Promise<string> {
  const e = neuerEintrag(payload as unknown as Record<string, unknown>);
  await db.meldungen.add(e);
  if (audio) await db.audio.add({ client_uuid: e.client_uuid, blob: audio });
  for (const blob of fotos) await db.fotos.add({ id: crypto.randomUUID(), client_uuid: e.client_uuid, blob });
  return e.client_uuid;
}

/** Zusatzauftrag lokal ablegen (Bauführer am Telefon — muss auch ohne Netz klappen). */
export async function enqueueZusatzauftrag(payload: Record<string, unknown>): Promise<string> {
  const e = neuerEintrag(payload);
  await db.auftraege.add(e);
  return e.client_uuid;
}

export async function offeneAnzahl(): Promise<number> {
  const [m, a] = await Promise.all([
    db.meldungen.where('status').equals('lokal').count(),
    db.auftraege.where('status').equals('lokal').count(),
  ]);
  return m + a;
}

/** Noch nicht gesendete Zusatzaufträge — für die «wird gesendet…»-Anzeige in der Liste. */
export async function offeneAuftraege(): Promise<LokalerAuftrag[]> {
  return db.auftraege.where('status').equals('lokal').sortBy('erstellt');
}

/** Noch nicht gesendete Tagesmeldungen (lokal). */
export async function offeneMeldungen(): Promise<LokaleMeldung[]> {
  return db.meldungen.where('status').equals('lokal').sortBy('erstellt');
}

async function flushAuftraege(client: SupabaseClient): Promise<FlushErgebnis> {
  const offene = await db.auftraege.where('status').equals('lokal').sortBy('erstellt');
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
        fehlerText = d.text;
        if (d.endgueltig) { await db.auftraege.update(e.client_uuid, { status: 'verworfen' }); verworfen += 1; } else fehler += 1;
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

/**
 * Meldung in drei idempotenten Schritten: Kopfzeile, Zeiteinträge, Sprachnotiz.
 * Bricht ein Schritt ab, wiederholt der nächste Flush ab dort — nichts wird doppelt.
 */
async function flushMeldungen(client: SupabaseClient): Promise<FlushErgebnis> {
  const offene = await db.meldungen.where('status').equals('lokal').sortBy('erstellt');
  let gesendet = 0;
  let fehler = 0;
  let verworfen = 0;
  let fehlerText: string | undefined;
  for (const e of offene) {
    const p = e.payload as unknown as Partial<MeldungPayload>;
    // Alt-Einträge aus frühen Tests (anderes Format) dürfen die Warteschlange nicht blockieren
    if (typeof p.id !== 'string' || !Array.isArray(p.eintraege)) {
      await db.meldungen.update(e.client_uuid, { status: 'verworfen' });
      verworfen += 1;
      continue;
    }
    try {
      const { eintraege, ...kopf } = p as MeldungPayload;
      const { error: e1 } = await client
        .from('tagesmeldung')
        .upsert({ ...kopf, client_uuid: e.client_uuid }, { onConflict: 'client_uuid', ignoreDuplicates: true });
      if (e1) {
        const d = fehlerDeuten(e1);
        fehlerText = d.text;
        if (d.endgueltig) { await db.meldungen.update(e.client_uuid, { status: 'verworfen' }); await db.audio.delete(e.client_uuid); verworfen += 1; } else fehler += 1;
        continue;
      }

      if (eintraege.length > 0) {
        const { error: e2 } = await client
          .from('zeiteintrag')
          .upsert(eintraege.map((z) => ({ ...z, tagesmeldung_id: p.id })), { onConflict: 'id', ignoreDuplicates: true });
        if (e2) {
          const d = fehlerDeuten(e2);
          fehlerText = d.text;
          // Kopf ist schon drin; die Zeiteinträge zeigen auf eine Person, die es nicht mehr gibt → Kopf wieder entfernen
          if (d.endgueltig) { await client.from('tagesmeldung').delete().eq('client_uuid', e.client_uuid); await db.meldungen.update(e.client_uuid, { status: 'verworfen' }); await db.audio.delete(e.client_uuid); verworfen += 1; } else fehler += 1;
          continue;
        }
      }

      const audio = await db.audio.get(e.client_uuid);
      if (audio) {
        const pfad = `audio/${e.client_uuid}.webm`;
        const e3 = await belegHochladen(client, pfad, audio.blob, audio.blob.type || 'audio/webm');
        if (e3) { fehler += 1; fehlerText = 'Sprachnotiz konnte nicht hochgeladen werden: ' + e3; continue; }
        // Der lokale Blob geht erst weg, wenn der Pfad an der Meldung steht — sonst wäre der Beleg verwaist.
        const { error: e3b } = await client.from('tagesmeldung').update({ audio_pfad: pfad }).eq('client_uuid', e.client_uuid);
        if (e3b) { fehler += 1; fehlerText = 'Sprachnotiz konnte nicht verknüpft werden: ' + fehlerDeuten(e3b).text; continue; }
        await db.audio.delete(e.client_uuid);
        // Text zur Aufnahme — läuft im Hintergrund; ein Fehler hier hält die Warteschlange nicht auf.
        // Text nur noch nachträglich erstellen, wenn er nicht schon geprüft mitkam (z. B. offline erfasst)
        if (!p.transkript) {
          try { void client.functions?.invoke('transkribieren', { body: { client_uuid: e.client_uuid } }).catch(() => undefined); } catch { /* kein Functions-Client (Test) */ }
        }
      }

      // Fotos: eins nach dem andern, jedes idempotent (Pfad und Zeile über die id) — bricht eins ab, kommt der Rest beim nächsten Mal
      const fotos = await db.fotos.where('client_uuid').equals(e.client_uuid).toArray();
      let fotoFehler: string | null = null;
      for (const f of fotos) {
        const pfad = `fotos/${e.client_uuid}/${f.id}.jpg`;
        const e4 = await belegHochladen(client, pfad, f.blob, 'image/jpeg');
        if (e4) { fotoFehler = 'Foto konnte nicht hochgeladen werden: ' + e4; break; }
        const { error: e5 } = await client.from('foto').upsert({ id: f.id, tagesmeldung_id: p.id, pfad, erstellt_von: p.erfasst_von }, { onConflict: 'id', ignoreDuplicates: true });
        if (e5) { fotoFehler = 'Foto: ' + e5.message; break; }
        await db.fotos.delete(f.id);
      }
      if (fotoFehler) { fehler += 1; fehlerText = fotoFehler; continue; }

      await db.meldungen.update(e.client_uuid, { status: 'gesendet' });
      gesendet += 1;
    } catch (err) {
      fehler += 1;
      fehlerText = err instanceof Error ? err.message : String(err);
    }
  }
  return { gesendet, fehler, verworfen, fehlerText };
}

/** Eine noch nicht gesendete Meldung samt Sprachnotiz vom Gerät entfernen (Ersetzen einer Doppelmeldung). */
export async function lokaleMeldungEntfernen(clientUuid: string): Promise<void> {
  await Promise.all([db.meldungen.delete(clientUuid), db.audio.delete(clientUuid), db.fotos.where('client_uuid').equals(clientUuid).delete()]);
}

/** Lokale Warteschlange komplett leeren — nach Demo-Neustart zeigen alte Einträge ins Leere. */
export async function lokaleWarteschlangeLeeren(): Promise<void> {
  await Promise.all([db.meldungen.clear(), db.audio.clear(), db.auftraege.clear(), db.fotos.clear()]);
}

/** Alle lokalen Einträge zum Server schieben. */
export async function flushNachSupabase(client: SupabaseClient): Promise<FlushErgebnis> {
  const m = await flushMeldungen(client);
  const a = await flushAuftraege(client);
  return {
    gesendet: m.gesendet + a.gesendet,
    fehler: m.fehler + a.fehler,
    verworfen: m.verworfen + a.verworfen,
    fehlerText: m.fehlerText ?? a.fehlerText,
  };
}

/** Beim App-Start registrieren: sendet bei Netz-Rückkehr automatisch. */
export function startAutoFlush(flush: () => Promise<unknown>): void {
  window.addEventListener('online', () => {
    void flush();
  });
  if (navigator.onLine) void flush();
}
