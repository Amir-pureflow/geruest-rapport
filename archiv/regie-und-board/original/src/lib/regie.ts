/**
 * Regierapport aus einer Tagesmeldung: Positionen vorrechnen (SGUV-Ansatz je Funktion)
 * und — erst auf ausdrücklichen Wunsch — als Entwurf anlegen. Nie doppelt pro Meldung.
 *
 * Anlegen läuft über die RPC `regierapport_anlegen` (Migration 0009): Kopf + Positionen in
 * EINER Transaktion, idempotent pro Meldung. Fehlt die RPC noch (Migration nicht eingespielt),
 * greift der bisherige Weg in zwei Schritten.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { minutenBetrag, tarifNachCode, RUECKFALL_ANSATZ_RAPPEN } from './tarif';

export interface EintragFuerRegie {
  normal_min: number;
  ueber_min: number;
  mitarbeiter: { name: string; funktion: string };
}

export interface RegiePosition {
  tarif_code: string;
  bezeichnung: string;
  menge_hundertstel: number;
  ansatz_rappen: number;
  betrag_rappen: number;
}

export function positionenAusEintraegen(eintraege: EintragFuerRegie[]): RegiePosition[] {
  return eintraege.map((e) => {
    const min = e.normal_min + e.ueber_min;
    let ansatz = RUECKFALL_ANSATZ_RAPPEN;
    try {
      ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
    } catch {
      /* unbekannte Funktion → Monteursansatz */
    }
    return {
      tarif_code: e.mitarbeiter.funktion,
      bezeichnung: `${e.mitarbeiter.name} · ${(min / 60).toFixed(1)} h`,
      menge_hundertstel: Math.round((min * 100) / 60),
      ansatz_rappen: ansatz,
      betrag_rappen: minutenBetrag(min, ansatz),
    };
  });
}

export function summe(positionen: RegiePosition[]): number {
  return positionen.reduce((s, p) => s + p.betrag_rappen, 0);
}

/** Gibt es zu dieser Meldung schon einen Rapport? Dann dessen id, sonst null. */
export async function vorhandenerRapport(client: SupabaseClient, meldungId: string): Promise<string | null> {
  const { data } = await client.from('regierapport').select('id').eq('tagesmeldung_id', meldungId).order('erstellt_am').limit(1);
  return data && data.length > 0 ? data[0].id : null;
}

/** PostgREST kennt die Funktion nicht: Migration 0009 fehlt (42883 = Postgres, PGRST202 = Schema-Cache). */
export function rpcFehlt(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42883' || err.code === 'PGRST202' || /could not find the function/i.test(err.message ?? '');
}

export interface AnlegenOpts {
  meldungId: string;
  baustelleId: string;
  zusatzauftragId: string | null;
  positionen: RegiePosition[];
}

/** Bisheriger Weg: erst Kopf, dann Positionen — zwei Schritte, kein Rollback dazwischen. */
async function regierapportAnlegenZweistufig(client: SupabaseClient, opts: AnlegenOpts): Promise<{ id: string } | { fehler: string }> {
  const schon = await vorhandenerRapport(client, opts.meldungId);
  if (schon) return { id: schon };
  const { data: r, error } = await client
    .from('regierapport')
    .insert({
      baustelle_id: opts.baustelleId,
      zusatzauftrag_id: opts.zusatzauftragId,
      tagesmeldung_id: opts.meldungId,
      betrag_rappen: summe(opts.positionen),
    })
    .select('id')
    .single();
  if (error || !r) return { fehler: error?.message ?? 'Rapport konnte nicht angelegt werden' };
  const { error: e2 } = await client
    .from('regie_position')
    .insert(opts.positionen.map((p) => ({ ...p, regierapport_id: r.id })));
  if (e2) return { fehler: e2.message };
  return { id: r.id };
}

/** Entwurf anlegen (idempotent: existiert schon einer, kommt dessen id zurück). */
export async function regierapportAnlegen(client: SupabaseClient, opts: AnlegenOpts): Promise<{ id: string } | { fehler: string }> {
  const { data, error } = await client.rpc('regierapport_anlegen', {
    p_meldung: opts.meldungId,
    p_baustelle: opts.baustelleId,
    p_zusatzauftrag: opts.zusatzauftragId,
    p_positionen: opts.positionen,
  });
  if (!error && typeof data === 'string' && data.length > 0) return { id: data };
  if (error && !rpcFehlt(error)) return { fehler: error.message };
  // RPC fehlt (oder gab nichts zurück) → bisheriger Weg
  return regierapportAnlegenZweistufig(client, opts);
}
