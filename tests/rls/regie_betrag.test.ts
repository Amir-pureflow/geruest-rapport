/**
 * Reparatur 1 (Migration 0056): Regie-Betrag aus den Zeilen, auf 5 Rappen, Positionen nur im Entwurf,
 * Einmal-Positionen nur einmal, «bestätigt» nur vom Kunden-Stand und danach gesperrt.
 * Gegen die LOKALE Supabase, angemeldet als Büro A — so wie die App schreibt.
 *
 * Handrechnung Testrapport A (8.75 h Gruppenleiter, 2 × 8.75 h Monteur, Lieferwagen 1 h, Etappe, Miete 9 %):
 *   1'058.75 + 945.00 + 945.00 + 165.00 + 280.00 = 3'393.75 · Miete 9 % = 305.44 · Summe 3'699.19 → Total 3'699.20
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import tarife from '../../fixtures/tarife_sguv_2026.json';
// @ts-expect-error — .mjs ohne Typen
import { ANON, F, PASSWORT, URL_LOKAL, konto, testdatenAnlegen } from '../lokal/testdaten.mjs';

const sql = (t: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: t, encoding: 'utf8' }).trim();
const kopf = () => sql(`select betrag_rappen from regierapport where id='${F.A.rapport}';`);
const zeile = (code: string) => sql(`select count(*)||'/'||coalesce(sum(betrag_rappen),0) from regie_position where regierapport_id='${F.A.rapport}' and tarif_code='${code}';`);

async function buero() {
  const c = createClient(URL_LOKAL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: konto('A', 'buero'), password: PASSWORT });
  if (error) throw error;
  return c;
}

beforeEach(async () => {
  await testdatenAnlegen();
  // Testrapport zurück in den Entwurf (wie «Korrigieren») — ab hier gilt die DB-Rechnung
  sql(`update regierapport set status='entwurf' where id='${F.A.rapport}';`);
}, 120_000);

describe('Betrag im Entwurf: immer aus den Zeilen, auf 5 Rappen', () => {
  it('zurück auf Entwurf: Kopf = Summe der Zeilen auf 5 Rappen (3699.19 → 3699.20)', () => {
    expect(kopf()).toBe('369920');
  });

  it('der Browser kann keinen anderen Betrag in den Kopf schreiben', async () => {
    const c = await buero();
    const { error } = await c.from('regierapport').update({ betrag_rappen: 1 }).eq('id', F.A.rapport);
    expect(error).toBeNull();
    expect(kopf()).toBe('369920');
  });

  it('Etappe weg: Miete und Kopf rechnen sich in derselben Änderung nach', async () => {
    // 3'393.75 − 280.00 = 3'113.75 · Miete 9 % = 280.2375 → 280.24 · Summe 3'393.99 → Total 3'394.00
    const c = await buero();
    const { error } = await c.from('regie_position').delete().eq('regierapport_id', F.A.rapport).eq('tarif_code', 'etappe');
    expect(error).toBeNull();
    expect(zeile('materialmiete')).toBe('1/28024');
    expect(kopf()).toBe('339400');
  });

  it('Miete mit falschem Betrag eingefügt: die DB setzt die richtigen 9 %', async () => {
    const c = await buero();
    await c.from('regie_position').delete().eq('regierapport_id', F.A.rapport).eq('tarif_code', 'materialmiete');
    expect(kopf()).toBe('339375'); // ohne Miete: 3'393.75 (schon auf 5 Rappen)
    const { error } = await c.from('regie_position').insert({ regierapport_id: F.A.rapport, tarif_code: 'materialmiete', bezeichnung: 'Materialmiete 9 %', menge_hundertstel: 100, ansatz_rappen: 1, betrag_rappen: 1 });
    expect(error).toBeNull();
    expect(zeile('materialmiete')).toBe('1/30544');
    expect(kopf()).toBe('369920');
  });

  it('Stunden ändern: 8.75 h → 9.25 h Gruppenleiter = +60.50 → Miete und Total folgen', async () => {
    // Gruppenleiter 9.25 × 121.00 = 1'119.25 · Zwischensumme 3'454.25 · Miete 310.8825 → 310.88 · 3'765.13 → 3'765.15
    const c = await buero();
    const { error } = await c.from('regie_position').update({ menge_hundertstel: 925, betrag_rappen: 111925 }).eq('regierapport_id', F.A.rapport).eq('tarif_code', 'gruppe');
    expect(error).toBeNull();
    expect(zeile('materialmiete')).toBe('1/31088');
    expect(kopf()).toBe('376515');
  });

  it('Doppelklick: Etappe, Lieferwagen und Miete gibt es je höchstens einmal', async () => {
    const c = await buero();
    const zweimal = await Promise.all([1, 2].map(() =>
      c.from('regie_position').insert({ regierapport_id: F.A.rapport, tarif_code: 'etappe', bezeichnung: 'Etappenzuschlag', menge_hundertstel: 100, ansatz_rappen: 28000, betrag_rappen: 28000 })));
    expect(zweimal.every((r) => r.error)).toBe(true); // Etappe ist schon da
    expect(zeile('etappe')).toBe('1/28000');
    expect(zeile('lieferwagen_35')).toBe('1/16500');
    expect(kopf()).toBe('369920');
  });

  it('der Satz 9 % in der Datenbank stimmt mit der Tarifliste überein', () => {
    expect(tarife.zuschlaege.materialmiete_prozent).toBe(9);
    expect(sql(`select prosrc ~ 'basis \\* 9 / 100' from pg_proc where proname='regie_betrag_nachfuehren';`)).toBe('t');
  });

  it('5-Rappen-Rundung in der DB wie in der App: 369919→369920, 95593→95595, 1202→1200, 1203→1205', () => {
    expect(sql(`select string_agg(regie_rund5(x)::text, ',' order by o) from unnest(array[369919,95593,1202,1203,2,0]) with ordinality t(x,o);`)).toBe('369920,95595,1200,1205,0,0');
  });
});

describe('Ausserhalb des Entwurfs', () => {
  it('versendet: Positionen gesperrt, Kopf bleibt', async () => {
    sql(`update regierapport set status='versendet' where id='${F.A.rapport}';`);
    const c = await buero();
    const e1 = await c.from('regie_position').update({ betrag_rappen: 1 }).eq('regierapport_id', F.A.rapport).eq('tarif_code', 'etappe');
    const e2 = await c.from('regie_position').insert({ regierapport_id: F.A.rapport, tarif_code: 'monteur', bezeichnung: 'X', menge_hundertstel: 100, ansatz_rappen: 10800, betrag_rappen: 10800 });
    const e3 = await c.from('regierapport').update({ betrag_rappen: 5 }).eq('id', F.A.rapport);
    expect(e1.error?.message).toMatch(/nicht mehr im Entwurf/);
    expect(e2.error?.message).toMatch(/nicht mehr im Entwurf/);
    expect(e3.error).toBeNull(); // Schreiben geht durch, der Betrag bleibt aber
    expect(kopf()).toBe('369920');
    expect(zeile('etappe')).toBe('1/28000');
  });

  it('das Büro kann einen Entwurf nicht selbst auf «bestätigt» setzen', async () => {
    const c = await buero();
    const { error } = await c.from('regierapport').update({ status: 'bestaetigt' }).eq('id', F.A.rapport);
    expect(error?.message).toMatch(/beim Kunden/);
    expect(sql(`select status from regierapport where id='${F.A.rapport}';`)).toBe('entwurf');
  });

  it('bestätigt: Betrag wird festgehalten; Löschen, Zurücknehmen und Ändern sind gesperrt', async () => {
    sql(`update regierapport set status='versendet' where id='${F.A.rapport}';`);
    sql(`update regierapport set status='bestaetigt' where id='${F.A.rapport}';`);
    expect(sql(`select bestaetigt_betrag_rappen||'/'||(bestaetigt_am is not null) from regierapport where id='${F.A.rapport}';`)).toBe('369920/true');
    const c = await buero();
    const versuche = await Promise.all([
      c.from('regierapport').update({ status: 'entwurf' }).eq('id', F.A.rapport),
      c.from('regierapport').update({ bestaetigt_betrag_rappen: 1 }).eq('id', F.A.rapport),
      c.from('regie_position').delete().eq('regierapport_id', F.A.rapport),
    ]);
    expect(versuche.every((r) => r.error)).toBe(true);
    // psql meldet den Fehler, endet aber mit 0 — darum danach nachsehen, ob der Rapport noch da ist
    sql(`delete from regierapport where id='${F.A.rapport}';`);
    expect(sql(`select status||'/'||betrag_rappen from regierapport where id='${F.A.rapport}';`)).toBe('bestaetigt/369920');
  });

  it('Entwurf verwerfen geht weiterhin (Positionen und Kopf löschen)', async () => {
    const c = await buero();
    const e1 = await c.from('regie_position').delete().eq('regierapport_id', F.A.rapport);
    const e2 = await c.from('regierapport').delete().eq('id', F.A.rapport);
    expect([e1.error, e2.error]).toEqual([null, null]);
    expect(sql(`select count(*) from regierapport where id='${F.A.rapport}';`)).toBe('0');
  });
});

describe('Anlegen über die App (RPC regierapport_anlegen)', () => {
  it('neuer Rapport aus der Meldung: Kopf sofort auf 5 Rappen', async () => {
    sql(`set session_replication_role = replica; delete from regie_position where regierapport_id='${F.A.rapport}'; delete from zustellung_log where regierapport_id='${F.A.rapport}'; delete from regierapport where id='${F.A.rapport}'; set session_replication_role = origin;`);
    const c = await buero();
    // 50 Min. Monteur = 0.83 × 108.00 = 89.64 → Total 89.65
    const { data, error } = await c.rpc('regierapport_anlegen', {
      p_meldung: F.A.meldung, p_baustelle: F.A.baustelle, p_zusatzauftrag: null,
      p_positionen: [{ tarif_code: 'monteur', bezeichnung: 'Monteur A Test · 0.83 h', menge_hundertstel: 83, ansatz_rappen: 10800, betrag_rappen: 8964 }],
    });
    expect(error).toBeNull();
    expect(sql(`select betrag_rappen from regierapport where id='${data}';`)).toBe('8965');
  });
});
