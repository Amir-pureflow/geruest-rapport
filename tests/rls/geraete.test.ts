/**
 * Phase 5 — Mehrere Geräte und Funkloch, mit der ECHTEN Warteschlange der App (src/lib/db.ts, Dexie auf fake-indexeddb)
 * gegen die LOKALE Supabase. «Ohne Netz» = ein Client, dessen fetch scheitert wie im Funkloch.
 * Übersetzung/Spracherkennung: die Anfrage an «transkribieren» wird abgefangen (Ersatz), es geht nichts hinaus.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { db, enqueueMeldung, flushNachSupabase, offeneAnzahl, type MeldungPayload } from '../../src/lib/db';
import { zugangMerken } from '../../src/lib/zugang';
// @ts-expect-error — .mjs ohne Typen
import { ANON, F, PASSWORT, URL_LOKAL, konto, testdatenAnlegen } from '../lokal/testdaten.mjs';

const sql = (t: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: t, encoding: 'utf8' }).trim();
const transkriptAufrufe: string[] = [];

/** fetch mit Ersatz für die kostenpflichtige Transkription; `offline` lässt alles scheitern wie im Funkloch. */
function geraeteFetch(offline: { an: boolean }): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (offline.an) throw new TypeError('Failed to fetch');
    if (url.includes('/functions/v1/transkribieren')) {
      transkriptAufrufe.push(url);
      return new Response(JSON.stringify({ ok: true, ersatz: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fetch(input, init);
  };
}

async function geraet(f: 'A' | 'B', rolle: string, offline = { an: false }): Promise<{ c: SupabaseClient; user: string; offline: { an: boolean } }> {
  const c = createClient(URL_LOKAL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: geraeteFetch(offline) } });
  // Angemeldet wird mit Netz (das Gerät bleibt danach angemeldet, Regel #4) — erst dann gilt `offline`
  const nachher = offline.an;
  offline.an = false;
  const { data, error } = await c.auth.signInWithPassword({ email: konto(f, rolle), password: PASSWORT });
  offline.an = nachher;
  if (error) throw error;
  return { c, user: data.user.id, offline };
}

const gestern = (() => { const x = new Date(); x.setDate(x.getDate() - 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();

/** Tagesmeldung wie das Teamgerät sie baut: 7:00–9:00 | 9:15–12:00 | 13:00–17:00 = 525 Min. (504 + 21) je Person. */
function meldung(team: string, baustelle: string, leute: string[], datum = gestern): MeldungPayload {
  return {
    id: crypto.randomUUID(), team_id: team, datum, baustelle_id: baustelle, normalfall: true, abweichung_typ: null,
    wer_hats_gewollt: null, audio_sekunden: null, erfasst_von: null,
    eintraege: leute.map((m) => ({
      id: crypto.randomUUID(), mitarbeiter_id: m, normal_min: 504, ueber_min: 21, oev: false, km: 0, baustelle_id: baustelle, konto_nr: '900001',
      von_min: 420, bis_min: 540, von2_min: 555, bis2_min: 720, von3_min: 780, bis3_min: 1020,
    })),
  };
}

beforeEach(async () => {
  await testdatenAnlegen();
  // Die vorbereitete Meldung von gestern weg — hier meldet das Gerät selbst
  sql(`delete from zeiteintrag where firma_id in ('${F.A.firma}','${F.B.firma}'); delete from foto where tagesmeldung_id in (select id from tagesmeldung where firma_id in ('${F.A.firma}','${F.B.firma}')); update regierapport set tagesmeldung_id=null where firma_id in ('${F.A.firma}','${F.B.firma}'); delete from tagesmeldung where firma_id in ('${F.A.firma}','${F.B.firma}');`);
  await db.meldungen.clear();
  await db.table('audio').clear().catch(() => undefined);
  await db.table('fotos').clear().catch(() => undefined);
}, 120_000);

describe('Funkloch auf dem Teamgerät', () => {
  it('Meldung ohne Netz → App zu → Büro ändert etwas → Netz da: alles kommt an, richtiger Tag, richtige Zeiten', async () => {
    const g = await geraet('A', 'chef', { an: false });
    zugangMerken({ user: g.user, firma: F.A.firma, name: F.A.name });
    g.offline.an = true;
    const getippt = Date.now();
    const p = meldung(F.A.team, F.A.baustelle, [F.A.chef, F.A.monteur, F.A.monteur2]);
    await enqueueMeldung(p, undefined, [new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })]);
    const r1 = await flushNachSupabase(g.c);
    expect(r1.gesendet).toBe(0);
    expect(await offeneAnzahl()).toBe(1);

    // App schliessen und wieder öffnen (IndexedDB bleibt)
    db.close();
    await db.open();
    expect(await offeneAnzahl()).toBe(1);

    // Büro ändert inzwischen: Monteur A aus dem Team genommen, Baustelle umbenannt, Plan gekürzt
    const buero = await geraet('A', 'buero');
    await buero.c.from('team_mitglied').update({ bis: gestern }).eq('mitarbeiter_id', F.A.monteur);
    await buero.c.from('baustelle').update({ bezeichnung: 'Baustelle A (neu)' }).eq('id', F.A.baustelle);

    // Netz wieder da (eine Weile später)
    await new Promise((r) => setTimeout(r, 1500));
    g.offline.an = false;
    const r2 = await flushNachSupabase(g.c);
    expect(r2.gesendet).toBe(1);
    expect(await offeneAnzahl()).toBe(0);

    // Auf dem Server: der Tag des Tippens, die getippten Zeiten, alle drei Personen (auch der aus dem Team genommene)
    expect(sql(`select datum from tagesmeldung where id='${p.id}';`)).toBe(gestern);
    expect(sql(`select count(*)||'/'||sum(normal_min+ueber_min) from zeiteintrag where tagesmeldung_id='${p.id}';`)).toBe('3/1575');
    expect(sql(`select string_agg(distinct von_min||'-'||bis_min||','||von2_min||'-'||bis2_min||','||von3_min||'-'||bis3_min, ';') from zeiteintrag where tagesmeldung_id='${p.id}';`)).toBe('420-540,555-720,780-1020');
    expect(sql(`select count(*) from foto where tagesmeldung_id='${p.id}';`)).toBe('1');
    void getippt;
  });

  it.fails('BEKANNTER FEHLER: «gemeldet um» ist die Zeit des Eintreffens, nicht des Tippens (Tagesübersicht zeigt erfasst_am)', async () => {
    const g = await geraet('A', 'chef', { an: true });
    zugangMerken({ user: g.user, firma: F.A.firma, name: F.A.name });
    const getippt = Date.now();
    const p = meldung(F.A.team, F.A.baustelle, [F.A.chef]);
    await enqueueMeldung(p);
    await flushNachSupabase(g.c);
    await new Promise((r) => setTimeout(r, 4000)); // Funkloch dauert 4 s (in echt: über Nacht)
    g.offline.an = false;
    await flushNachSupabase(g.c);
    const ankunft = Number(sql(`select (extract(epoch from erfasst_am)*1000)::bigint from tagesmeldung where id='${p.id}';`));
    expect(ankunft).toBeGreaterThan(0); // die Meldung ist angekommen
    expect(Math.abs(ankunft - getippt)).toBeLessThan(1000); // heute: ~4 s daneben (Zeit des Eintreffens)
  });

  it('nochmals senden nach abgebrochener Antwort erzeugt keine doppelten Stunden', async () => {
    const g = await geraet('A', 'chef');
    zugangMerken({ user: g.user, firma: F.A.firma, name: F.A.name });
    const p = meldung(F.A.team, F.A.baustelle, [F.A.chef, F.A.monteur]);
    const uuid = await enqueueMeldung(p);
    await flushNachSupabase(g.c);
    // so tun, als wäre die Antwort nie angekommen: Eintrag wieder «lokal», dann nochmals senden
    await db.meldungen.update(uuid, { status: 'lokal' });
    await flushNachSupabase(g.c);
    expect(sql(`select count(*) from tagesmeldung where team_id='${F.A.team}' and datum='${gestern}';`)).toBe('1');
    expect(sql(`select count(*) from zeiteintrag where tagesmeldung_id='${p.id}';`)).toBe('2');
  });

  it('Büro löscht offline eine Person ganz: ihre Zeile bleibt mit Grund auf dem Gerät, die anderen kommen an', async () => {
    const g = await geraet('A', 'chef', { an: true });
    zugangMerken({ user: g.user, firma: F.A.firma, name: F.A.name });
    const p = meldung(F.A.team, F.A.baustelle, [F.A.chef, F.A.monteur2]);
    const uuid = await enqueueMeldung(p);
    await flushNachSupabase(g.c);
    sql(`delete from team_mitglied where mitarbeiter_id='${F.A.monteur2}'; delete from mitarbeiter where id='${F.A.monteur2}';`);
    g.offline.an = false;
    await flushNachSupabase(g.c);
    expect(sql(`select count(*) from zeiteintrag where tagesmeldung_id='${p.id}';`)).toBe('1');
    const e = await db.meldungen.get(uuid);
    expect(e?.zeilenFehler?.map((z) => z.mitarbeiter_id)).toEqual([F.A.monteur2]);
  });

  it('eine Meldung, die mit Firma A erfasst wurde, geht nach einem Firmenwechsel auf dem Gerät nicht unter Firma B hinaus', async () => {
    const a = await geraet('A', 'chef', { an: true });
    zugangMerken({ user: a.user, firma: F.A.firma, name: F.A.name });
    await enqueueMeldung(meldung(F.A.team, F.A.baustelle, [F.A.chef]));
    const b = await geraet('B', 'chef');
    zugangMerken({ user: b.user, firma: F.B.firma, name: F.B.name });
    const r = await flushNachSupabase(b.c);
    expect(r.gesendet).toBe(0);
    expect(sql(`select count(*) from tagesmeldung where firma_id='${F.B.firma}';`)).toBe('0');
  });
});

describe('Zwei Geräte gleichzeitig', () => {
  // Entscheid Amir 28.11.2026: je Team, Tag und Baustelle nur EINE Meldung — eine zweite ersetzt die erste.
  it.fails('BEKANNTER FEHLER: zwei Geräte melden dasselbe Team am selben Tag auf derselben Baustelle — beide zählen, Stunden doppelt', async () => {
    // Gerät 1 = Chefmonteur, Gerät 2 = Büro-Zugang im Teamgerät («Erfassung (Test)»). Je 3 × 525 Min.
    const g1 = await geraet('A', 'chef');
    const g2 = await geraet('A', 'buero');
    await g1.c.from('tagesmeldung').insert({ id: crypto.randomUUID(), client_uuid: crypto.randomUUID(), team_id: F.A.team, datum: gestern, baustelle_id: F.A.baustelle, normalfall: true });
    await g2.c.from('tagesmeldung').insert({ id: crypto.randomUUID(), client_uuid: crypto.randomUUID(), team_id: F.A.team, datum: gestern, baustelle_id: F.A.baustelle, normalfall: true });
    // Richtig wäre: die zweite Meldung wird erkannt (abgelehnt oder als «ersetzt» markiert) → 1 Meldung. Heute: 2.
    expect(sql(`select count(*) from tagesmeldung where team_id='${F.A.team}' and datum='${gestern}' and baustelle_id='${F.A.baustelle}';`)).toBe('1');
  });

  it.fails('BEKANNTER FEHLER: dieselbe Person in den Meldungen zweier Teams am selben Tag — Stunden doppelt', async () => {
    const team2 = crypto.randomUUID();
    sql(`insert into team (id, bezeichnung, aktiv, firma_id) values ('${team2}', 'Team A2', true, '${F.A.firma}');`);
    const g = await geraet('A', 'buero');
    const m1 = crypto.randomUUID(), m2 = crypto.randomUUID();
    await g.c.from('tagesmeldung').insert([
      { id: m1, client_uuid: crypto.randomUUID(), team_id: F.A.team, datum: gestern, baustelle_id: F.A.baustelle, normalfall: true },
      { id: m2, client_uuid: crypto.randomUUID(), team_id: team2, datum: gestern, baustelle_id: F.A.baustelle, normalfall: true },
    ]);
    await g.c.from('zeiteintrag').insert({ tagesmeldung_id: m1, mitarbeiter_id: F.A.monteur, normal_min: 504, ueber_min: 21 });
    await g.c.from('zeiteintrag').insert({ tagesmeldung_id: m2, mitarbeiter_id: F.A.monteur, normal_min: 504, ueber_min: 21 });
    // Richtig wären höchstens 525 Min. an einem Tag — heute stehen 2 × 525 = 1050 Min. (17.50 h) da
    expect(sql(`select coalesce(sum(z.normal_min+z.ueber_min),0) from zeiteintrag z join tagesmeldung t on t.id=z.tagesmeldung_id where z.mitarbeiter_id='${F.A.monteur}' and t.datum='${gestern}';`)).toBe('525');
  });

  it('Büro versetzt eine Person, während das Teamgerät meldet: Plan und Meldung kommen beide an, nichts geht verloren', async () => {
    const chef = await geraet('A', 'chef');
    zugangMerken({ user: chef.user, firma: F.A.firma, name: F.A.name });
    const buero = await geraet('A', 'buero');
    const team2 = crypto.randomUUID();
    sql(`insert into team (id, bezeichnung, aktiv, firma_id) values ('${team2}', 'Team A2', true, '${F.A.firma}');`);
    const p = meldung(F.A.team, F.A.baustelle, [F.A.chef, F.A.monteur]);
    await enqueueMeldung(p);
    const [r, versetzt] = await Promise.all([
      flushNachSupabase(chef.c),
      buero.c.from('einsatz_person').insert({ mitarbeiter_id: F.A.monteur, datum: gestern, team_id: team2 }),
    ]);
    expect(r.gesendet).toBe(1);
    expect(versetzt.error).toBeNull();
    expect(sql(`select count(*) from zeiteintrag where tagesmeldung_id='${p.id}';`)).toBe('2');
    expect(sql(`select count(*) from einsatz_person where mitarbeiter_id='${F.A.monteur}' and datum='${gestern}';`)).toBe('1');
  });
});
