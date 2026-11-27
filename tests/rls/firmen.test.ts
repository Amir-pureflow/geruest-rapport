/**
 * Phase 4 — Trennung zwischen Firmen, gegen die LOKALE Supabase mit den echten RLS-Regeln (alle Migrationen 0001–0055).
 * Vorher: `npx supabase start --workdir tests/lokal` und `node tests/lokal/testdaten.mjs`.
 *
 * Idee: Alle Kennungen von Firma B beginnen mit «bbbbbbbb-», die Texte enthalten «Firma B»-Wörter. Firma A liest jede
 * Tabelle und Sicht, die die API anbietet — nirgends darf etwas von B auftauchen.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
// @ts-expect-error — .mjs ohne Typen
import { ANON, F, PASSWORT, URL_LOKAL, konto, testdatenAnlegen } from '../lokal/testdaten.mjs';

const SPUREN_B = [/bbbbbbbb-/, /Testbau B/, /Geheimer Text B/, /Kunde B AG/, /Baustelle B/, /testbau-b\.test/];

function sql(text: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: text, encoding: 'utf8' });
}

async function anmelden(f: 'A' | 'B', rolle: 'buero' | 'chef' | 'monteur'): Promise<SupabaseClient> {
  const c = createClient(URL_LOKAL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: konto(f, rolle), password: PASSWORT });
  if (error) throw error;
  return c;
}

/** Alle Tabellen und Sichten im Schema public, die die Rolle «authenticated» lesen darf. */
const quellen = (): string[] =>
  sql(`select table_name from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and privilege_type='SELECT' group by table_name order by 1;`)
    .trim().split('\n').filter(Boolean);

let buero: Record<'A' | 'B', SupabaseClient>;
let chefA: SupabaseClient;
let monteurA: SupabaseClient;
let anon: SupabaseClient;

beforeAll(async () => {
  await testdatenAnlegen();
  buero = { A: await anmelden('A', 'buero'), B: await anmelden('B', 'buero') };
  chefA = await anmelden('A', 'chef');
  monteurA = await anmelden('A', 'monteur');
  anon = createClient(URL_LOKAL, ANON, { auth: { persistSession: false } });
}, 120_000);

describe('Lesen: Firma A sieht nichts von Firma B', () => {
  it('jede Tabelle und Sicht, je Rolle (Büro, Chefmonteur, Monteur)', async () => {
    const lecks: string[] = [];
    const geprueft: string[] = [];
    for (const [rolle, c] of [['buero', buero.A], ['chef', chefA], ['monteur', monteurA]] as const) {
      for (const t of quellen()) {
        const { data, error } = await c.from(t).select('*').limit(5000);
        if (error) continue; // Rolle darf die Quelle gar nicht lesen — auch gut
        geprueft.push(`${rolle}:${t}`);
        const text = JSON.stringify(data);
        if (SPUREN_B.some((r) => r.test(text))) lecks.push(`${rolle} liest in «${t}» Daten von Firma B`);
      }
    }
    expect(geprueft.length).toBeGreaterThan(20);
    expect(lecks).toEqual([]);
  });

  it('Gegenprobe: Firma A sieht ihre eigenen Daten (sonst wäre der Test oben wertlos)', async () => {
    const { data } = await buero.A.from('tagesmeldung').select('id');
    expect(data?.map((x) => x.id)).toContain(F.A.meldung);
    const { data: r } = await buero.A.from('regierapport').select('id');
    expect(r?.map((x) => x.id)).toContain(F.A.rapport);
  });

  it('Direkte Abfrage nach der Kennung von B liefert nichts', async () => {
    for (const [t, id] of [['tagesmeldung', F.B.meldung], ['regierapport', F.B.rapport], ['mitarbeiter', F.B.chef], ['baustelle', F.B.baustelle], ['kunde', F.B.kunde], ['team', F.B.team], ['firma', F.B.firma]] as const) {
      const { data } = await buero.A.from(t).select('*').eq('id', id);
      expect(data ?? [], `${t}`).toEqual([]);
    }
  });

  it('Ohne Anmeldung (nur der öffentliche Schlüssel aus dem JavaScript) ist nichts lesbar', async () => {
    const lecks: string[] = [];
    for (const t of quellen()) {
      const { data } = await anon.from(t).select('*').limit(50);
      // Summen-Sichten (z. B. regie_kennzahlen) liefern immer eine Zeile — zulässig, solange alles 0 ist
      const nurNullen = (data ?? []).every((z) => Object.values(z).every((v) => v === 0 || v === null));
      if (data && data.length > 0 && !nurNullen) lecks.push(`${t}: ${data.length} Zeilen`);
    }
    expect(lecks).toEqual([]);
  });

  it('Regie-Kennzahlen zählen nur die eigene Firma (A: 3\'699.19 beim Kunden, nicht A + B)', async () => {
    const { data } = await buero.A.from('regie_kennzahlen').select('beim_kunden_anzahl,beim_kunden_rappen');
    expect(data).toEqual([{ beim_kunden_anzahl: 1, beim_kunden_rappen: 369919 }]);
  });

  it('Regie-Beträge: Chefmonteur und Monteur lesen keine Regierapporte und Positionen (0048)', async () => {
    for (const c of [chefA, monteurA]) {
      const { data: r } = await c.from('regierapport').select('id,betrag_rappen');
      const { data: p } = await c.from('regie_position').select('*');
      expect(r ?? []).toEqual([]);
      expect(p ?? []).toEqual([]);
    }
  });
});

describe('Schreiben: Firma A kann Firma B nichts antun', () => {
  it('Update und Löschen auf Zeilen von B ändern nichts', async () => {
    await buero.A.from('zeiteintrag').update({ normal_min: 1 }).eq('tagesmeldung_id', F.B.meldung);
    await buero.A.from('regierapport').update({ betrag_rappen: 1, status: 'entwurf' }).eq('id', F.B.rapport);
    await buero.A.from('regie_position').delete().eq('regierapport_id', F.B.rapport);
    await buero.A.from('mitarbeiter').update({ name: 'gehackt' }).eq('id', F.B.chef);
    expect(sql(`select sum(normal_min) from zeiteintrag where tagesmeldung_id='${F.B.meldung}';`).trim()).toBe('1512');
    expect(sql(`select betrag_rappen||status from regierapport where id='${F.B.rapport}';`).trim()).toBe('369919versendet');
    expect(sql(`select count(*) from regie_position where regierapport_id='${F.B.rapport}';`).trim()).toBe('6');
    expect(sql(`select name from mitarbeiter where id='${F.B.chef}';`).trim()).toBe('Chef B Test');
  });

  it('Einfügen mit fremder firma_id oder mit Bezug auf B wird abgelehnt', async () => {
    const r1 = await buero.A.from('baustelle').insert({ konto_nr: '777777', bezeichnung: 'Fremd', firma_id: F.B.firma });
    const r2 = await buero.A.from('tagesmeldung').insert({ client_uuid: crypto.randomUUID(), datum: '2026-11-20', team_id: F.B.team, baustelle_id: F.B.baustelle });
    const r3 = await buero.A.from('zeiteintrag').insert({ tagesmeldung_id: F.B.meldung, mitarbeiter_id: F.A.chef, normal_min: 60, ueber_min: 0 });
    const r4 = await buero.A.from('regie_position').insert({ regierapport_id: F.B.rapport, tarif_code: 'monteur', bezeichnung: 'x', menge_hundertstel: 100, ansatz_rappen: 1, betrag_rappen: 1 });
    expect([r1.error, r2.error, r3.error, r4.error].map((e) => !!e)).toEqual([true, true, true, true]);
    expect(sql(`select count(*) from baustelle where konto_nr='777777';`).trim()).toBe('0');
  });

  it('Freigeben/Korrigieren per Funktion nur in der eigenen Firma', async () => {
    const zeile = sql(`select id from zeiteintrag where tagesmeldung_id='${F.B.meldung}' and status='offen' limit 1;`).trim();
    const f1 = await buero.A.rpc('zeit_freigeben', { p_ids: [zeile] }).then((r) => r, (e) => ({ error: e }));
    expect(sql(`select status from zeiteintrag where id='${zeile}';`).trim()).toBe('offen');
    void f1;
  });

  it('Chefmonteur A darf nicht freigeben und keine Regie-Beträge schreiben', async () => {
    const zeile = sql(`select id from zeiteintrag where tagesmeldung_id='${F.A.meldung}' and status='offen' limit 1;`).trim();
    await chefA.from('zeiteintrag').update({ status: 'freigegeben' }).eq('id', zeile);
    await chefA.from('regierapport').update({ betrag_rappen: 1 }).eq('id', F.A.rapport);
    expect(sql(`select status from zeiteintrag where id='${zeile}';`).trim()).toBe('offen');
    expect(sql(`select betrag_rappen from regierapport where id='${F.A.rapport}';`).trim()).toBe('369919');
  });
});

describe('Dateien im Speicher', () => {
  it('Firma A kann das Foto von B nicht herunterladen, nicht signieren, nicht auflisten', async () => {
    const pfad = `fotos/${F.B.meldungUuid}/foto-B.jpg`;
    const dl = await buero.A.storage.from('anhaenge').download(pfad);
    const sig = await buero.A.storage.from('anhaenge').createSignedUrl(pfad, 60);
    const ls = await buero.A.storage.from('anhaenge').list(`fotos/${F.B.meldungUuid}`);
    expect(dl.data).toBeNull();
    expect(sig.data?.signedUrl ?? null).toBeNull();
    expect(ls.data ?? []).toEqual([]);
  });

  it('Gegenprobe: Firma A lädt ihr eigenes Foto', async () => {
    const dl = await buero.A.storage.from('anhaenge').download(`fotos/${F.A.meldungUuid}/foto-A.jpg`);
    expect(dl.data).not.toBeNull();
  });

  it('Firma A kann kein Foto in den Ordner von B hochladen', async () => {
    const up = await buero.A.storage.from('anhaenge').upload(`fotos/${F.B.meldungUuid}/eingeschleust.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
    expect(up.error).not.toBeNull();
  });
});
