import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { positionenAusEintraegen, summe, regierapportAnlegen, rpcFehlt, type RegiePosition } from './regie';
import { RUECKFALL_ANSATZ_RAPPEN, tarifNachCode } from './tarif';

describe('positionenAusEintraegen — Minuten → Hundertstel → Rappen', () => {
  it('2 h Monteur: 200 Hundertstel, 108.– Ansatz, Fr. 216.00', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 120, ueber_min: 0, mitarbeiter: { name: 'Marco Müller', funktion: 'monteur' } }]);
    expect(p.tarif_code).toBe('monteur');
    expect(p.menge_hundertstel).toBe(200);
    expect(p.ansatz_rappen).toBe(tarifNachCode('monteur').ansatz_rappen);
    expect(p.betrag_rappen).toBe(21600);
    expect(p.bezeichnung).toBe('Marco Müller · 2.0 h');
  });

  it('Normal- und Überstunden werden addiert: 480 + 90 Min = 9.5 h = 950 Hundertstel', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 480, ueber_min: 90, mitarbeiter: { name: 'A', funktion: 'monteur' } }]);
    expect(p.menge_hundertstel).toBe(950);
    expect(p.betrag_rappen).toBe(Math.round((570 * 10800) / 60));
    expect(p.bezeichnung).toContain('9.5 h');
  });

  it('krumme Minuten runden auf ganze Hundertstel und ganze Rappen', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 50, ueber_min: 0, mitarbeiter: { name: 'A', funktion: 'monteur' } }]);
    expect(p.menge_hundertstel).toBe(83); // 83.33…
    expect(Number.isInteger(p.betrag_rappen)).toBe(true);
    expect(p.betrag_rappen).toBe(9000); // 50/60 × 108.–
  });

  it('unbekannte Funktion → Rückfallansatz Gerüstmonteur/in (10800), Code bleibt erhalten', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 60, ueber_min: 0, mitarbeiter: { name: 'X', funktion: 'gibt_es_nicht' } }]);
    expect(p.tarif_code).toBe('gibt_es_nicht');
    expect(p.ansatz_rappen).toBe(RUECKFALL_ANSATZ_RAPPEN);
    expect(RUECKFALL_ANSATZ_RAPPEN).toBe(10800);
    expect(p.betrag_rappen).toBe(10800);
  });

  it('Bauführer hat einen eigenen (höheren) Ansatz', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 60, ueber_min: 0, mitarbeiter: { name: 'B', funktion: 'bauf' } }]);
    expect(p.ansatz_rappen).toBe(tarifNachCode('bauf').ansatz_rappen);
    expect(p.ansatz_rappen).toBeGreaterThan(RUECKFALL_ANSATZ_RAPPEN);
  });

  it('0 Minuten ergeben eine Nullposition, keinen Fehler', () => {
    const [p] = positionenAusEintraegen([{ normal_min: 0, ueber_min: 0, mitarbeiter: { name: 'A', funktion: 'monteur' } }]);
    expect(p.menge_hundertstel).toBe(0);
    expect(p.betrag_rappen).toBe(0);
  });

  it('Summe ist die Rappensumme aller Positionen — der Modellfall 2 × 2 h = Fr. 432.00', () => {
    const pos = positionenAusEintraegen([
      { normal_min: 120, ueber_min: 0, mitarbeiter: { name: 'A', funktion: 'monteur' } },
      { normal_min: 120, ueber_min: 0, mitarbeiter: { name: 'B', funktion: 'monteur' } },
    ]);
    expect(summe(pos)).toBe(43200);
    expect(summe([])).toBe(0);
  });
});

// ── regierapportAnlegen: RPC zuerst, Rückfall auf zwei Schritte ────────────────

interface Aufruf { was: string; args?: unknown }

function fakeClient(opts: { rpc: { data: unknown; error: { code?: string; message: string } | null } }) {
  const aufrufe: Aufruf[] = [];
  const ok = (was: string, args?: unknown) => { aufrufe.push({ was, args }); return Promise.resolve({ data: null, error: null }); };
  const client = {
    rpc: (name: string, args: unknown) => { aufrufe.push({ was: `rpc:${name}`, args }); return Promise.resolve(opts.rpc); },
    from: (tabelle: string) => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => { aufrufe.push({ was: `${tabelle}.select` }); return Promise.resolve({ data: [], error: null }); } }) }) }),
      insert: (rows: unknown) => ({
        select: () => ({ single: () => { aufrufe.push({ was: `${tabelle}.insert`, args: rows }); return Promise.resolve({ data: { id: 'neu-1' }, error: null }); } }),
        then: (res: (v: unknown) => void) => ok(`${tabelle}.insert`, rows).then(res),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, aufrufe };
}

const positionen: RegiePosition[] = [
  { tarif_code: 'monteur', bezeichnung: 'A · 2.0 h', menge_hundertstel: 200, ansatz_rappen: 10800, betrag_rappen: 21600 },
];
const opts = { meldungId: 'm1', baustelleId: 'b1', zusatzauftragId: null, positionen };

describe('regierapportAnlegen', () => {
  it('nimmt die id aus der RPC und fasst die Tabellen nicht an', async () => {
    const { client, aufrufe } = fakeClient({ rpc: { data: 'rid-42', error: null } });
    const erg = await regierapportAnlegen(client, opts);
    expect(erg).toEqual({ id: 'rid-42' });
    expect(aufrufe.map((a) => a.was)).toEqual(['rpc:regierapport_anlegen']);
    expect(aufrufe[0].args).toMatchObject({ p_meldung: 'm1', p_baustelle: 'b1', p_zusatzauftrag: null, p_positionen: positionen });
  });

  it('fehlt die RPC (PGRST202), geht es den bisherigen Weg: Kopf, dann Positionen', async () => {
    const { client, aufrufe } = fakeClient({ rpc: { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.regierapport_anlegen' } } });
    const erg = await regierapportAnlegen(client, opts);
    expect(erg).toEqual({ id: 'neu-1' });
    expect(aufrufe.map((a) => a.was)).toEqual(['rpc:regierapport_anlegen', 'regierapport.select', 'regierapport.insert', 'regie_position.insert']);
    expect(aufrufe[2].args).toMatchObject({ tagesmeldung_id: 'm1', betrag_rappen: 21600 });
  });

  it('42883 (Postgres: Funktion unbekannt) zählt ebenfalls als «RPC fehlt»', async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { code: '42883', message: 'function regierapport_anlegen(...) does not exist' } } });
    const erg = await regierapportAnlegen(client, opts);
    expect(erg).toEqual({ id: 'neu-1' });
  });

  it('ein anderer RPC-Fehler wird gemeldet, nicht umgangen', async () => {
    const { client, aufrufe } = fakeClient({ rpc: { data: null, error: { code: 'P0001', message: 'regierapport_anlegen: p_baustelle fehlt' } } });
    const erg = await regierapportAnlegen(client, opts);
    expect(erg).toEqual({ fehler: 'regierapport_anlegen: p_baustelle fehlt' });
    expect(aufrufe).toHaveLength(1);
  });

  it('rpcFehlt erkennt nur die beiden Codes bzw. den PostgREST-Text', () => {
    expect(rpcFehlt({ code: '42883', message: '' })).toBe(true);
    expect(rpcFehlt({ code: 'PGRST202', message: '' })).toBe(true);
    expect(rpcFehlt({ message: 'Could not find the function public.x in the schema cache' })).toBe(true);
    expect(rpcFehlt({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(rpcFehlt(null)).toBe(false);
  });
});
