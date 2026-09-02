/**
 * Offline-Warteschlange (CLAUDE.md #4/#5):
 * Jede Erfassung schreibt ZUERST hierhin — nie direkt ins Netz.
 * Gesendet wird, sobald Verbindung da ist; der Server dedupliziert
 * über client_uuid (unique), darum ist mehrfaches Senden harmlos.
 *
 * Zwei Warteschlangen: Tagesmeldungen (Teamgerät) und Zusatzaufträge (Bauführer).
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
export async function enqueueMeldung(
  payload: Record<string, unknown>,
  audio?: Blob,
): Promise<string> {
  const e = neuerEintrag(payload);
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

async function flushQueue(
  client: SupabaseClient,
  table: Table<QueueEintrag, string>,
  zielTabelle: string,
): Promise<{ gesendet: number; fehler: number }> {
  const offene = await table.where('status').equals('lokal').sortBy('erstellt');
  let gesendet = 0;
  for (const e of offene) {
    const { error } = await client
      .from(zielTabelle)
      .upsert(
        { ...e.payload, client_uuid: e.client_uuid },
        { onConflict: 'client_uuid', ignoreDuplicates: true },
      );
    if (error) return { gesendet, fehler: offene.length - gesendet }; // Reihenfolge wahren; nächster Flush versucht es erneut
    await table.update(e.client_uuid, { status: 'gesendet' });
    gesendet += 1;
  }
  return { gesendet, fehler: 0 };
}

/** Alle lokalen Einträge zum Server schieben. Audio-Upload folgt in Phase 2 (Storage). */
export async function flushNachSupabase(
  client: SupabaseClient,
): Promise<{ gesendet: number; fehler: number }> {
  const m = await flushQueue(client, db.meldungen, 'tagesmeldung');
  const a = await flushQueue(client, db.auftraege, 'zusatzauftrag');
  return { gesendet: m.gesendet + a.gesendet, fehler: m.fehler + a.fehler };
}

/** Beim App-Start registrieren: sendet bei Netz-Rückkehr automatisch. */
export function startAutoFlush(flush: () => Promise<unknown>): void {
  window.addEventListener('online', () => {
    void flush();
  });
  if (navigator.onLine) void flush();
}
