/**
 * Regierapport aus einer Tagesmeldung: Positionen vorrechnen (SGUV-Ansatz je Funktion)
 * und — erst auf ausdrücklichen Wunsch — als Entwurf anlegen. Nie doppelt pro Meldung.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { minutenBetrag, tarifNachCode } from './tarif';

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

const MONTEUR_ANSATZ = 10800; // Rückfall Gerüstmonteur/in, falls die Funktion keinen Tarif hat

export function positionenAusEintraegen(eintraege: EintragFuerRegie[]): RegiePosition[] {
  return eintraege.map((e) => {
    const min = e.normal_min + e.ueber_min;
    let ansatz = MONTEUR_ANSATZ;
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

/** Entwurf anlegen (idempotent: existiert schon einer, kommt dessen id zurück). */
export async function regierapportAnlegen(
  client: SupabaseClient,
  opts: { meldungId: string; baustelleId: string; zusatzauftragId: string | null; positionen: RegiePosition[] },
): Promise<{ id: string } | { fehler: string }> {
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
