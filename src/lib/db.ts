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
  status: 'lokal' | 'gesendet';
}

export type LokaleMeldung = QueueEintrag;
export type LokalerAuftrag = QueueEintrag;

export interface LokalesAudio {
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
  }
}

export const db = new LokaleDb();

function neuerEintrag(payload: Record<string, unknown>): QueueEintrag {
  return { client_uuid: crypto.randomUUID(), payload, erstellt: Date.now(), status: 'lokal' };
}

/** Tagesmeldung lokal ablegen. Gibt die client_uuid zurück. */
export async function enqueueMeldung(payload: MeldungPayload, audio?: Blob): Promise<string> {
  const e = neuerEintrag(payload as unknown as Record<string, unknown>);
  await db.meldungen.add(e);
  if (audio) await db.audio.add({ client_uuid: e.client_uuid, blob: audio });
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

async function flushAuftraege(client: SupabaseClient): Promise<{ gesendet: number; fehler: number }> {
  const offene = await db.auftraege.where('status').equals('lokal').sortBy('erstellt');
  let gesendet = 0;
  for (const e of offene) {
    const { error } = await client
      .from('zusatzauftrag')
      .upsert({ ...e.payload, client_uuid: e.client_uuid }, { onConflict: 'client_uuid', ignoreDuplicates: true });
    if (error) return { gesendet, fehler: offene.length - gesendet };
    await db.auftraege.update(e.client_uuid, { status: 'gesendet' });
    gesendet += 1;
  }
  return { gesendet, fehler: 0 };
}

/**
 * Meldung in drei idempotenten Schritten: Kopfzeile, Zeiteinträge, Sprachnotiz.
 * Bricht ein Schritt ab, wiederholt der nächste Flush ab dort — nichts wird doppelt.
 */
async function flushMeldungen(client: SupabaseClient): Promise<{ gesendet: number; fehler: number }> {
  const offene = await db.meldungen.where('status').equals('lokal').sortBy('erstellt');
  let gesendet = 0;
  for (const e of offene) {
    const p = e.payload as unknown as MeldungPayload;
    const { eintraege, ...kopf } = p;
    const { error: e1 } = await client
      .from('tagesmeldung')
      .upsert({ ...kopf, client_uuid: e.client_uuid }, { onConflict: 'client_uuid', ignoreDuplicates: true });
    if (e1) return { gesendet, fehler: offene.length - gesendet };

    if (eintraege.length > 0) {
      const { error: e2 } = await client
        .from('zeiteintrag')
        .upsert(eintraege.map((z) => ({ ...z, tagesmeldung_id: p.id })), { onConflict: 'id', ignoreDuplicates: true });
      if (e2) return { gesendet, fehler: offene.length - gesendet };
    }

    const audio = await db.audio.get(e.client_uuid);
    if (audio) {
      const pfad = `audio/${e.client_uuid}.webm`;
      const { error: e3 } = await client.storage.from('anhaenge').upload(pfad, audio.blob, { upsert: true, contentType: audio.blob.type || 'audio/webm' });
      if (e3) return { gesendet, fehler: offene.length - gesendet };
      await client.from('tagesmeldung').update({ audio_pfad: pfad }).eq('client_uuid', e.client_uuid);
      await db.audio.delete(e.client_uuid);
    }

    await db.meldungen.update(e.client_uuid, { status: 'gesendet' });
    gesendet += 1;
  }
  return { gesendet, fehler: 0 };
}

/** Alle lokalen Einträge zum Server schieben. */
export async function flushNachSupabase(
  client: SupabaseClient,
): Promise<{ gesendet: number; fehler: number }> {
  const m = await flushMeldungen(client);
  const a = await flushAuftraege(client);
  return { gesendet: m.gesendet + a.gesendet, fehler: m.fehler + a.fehler };
}

/** Beim App-Start registrieren: sendet bei Netz-Rückkehr automatisch. */
export function startAutoFlush(flush: () => Promise<unknown>): void {
  window.addEventListener('online', () => {
    void flush();
  });
  if (navigator.onLine) void flush();
}
