/**
 * Phase 4 — Kunden-Link (/b/:token, Edge Function «bestaetigung») und PDF (Edge Function «regierapport-pdf»),
 * gegen die LOKALE Supabase mit lokal laufenden Functions (`npx supabase functions serve --workdir tests/lokal`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
// @ts-expect-error — .mjs ohne Typen
import { ANON, F, PASSWORT, URL_LOKAL, konto, testdatenAnlegen } from '../lokal/testdaten.mjs';

const FN = `${URL_LOKAL}/functions/v1`;
const sql = (t: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: t, encoding: 'utf8' }).trim();
const holen = (token: string) => fetch(`${FN}/bestaetigung?token=${encodeURIComponent(token)}`, { headers: { apikey: ANON } });
const antworten = (body: unknown) => fetch(`${FN}/bestaetigung`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function anmelden(f: 'A' | 'B', rolle: string) {
  const c = createClient(URL_LOKAL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: konto(f, rolle), password: PASSWORT });
  if (error) throw error;
  return c;
}

beforeEach(async () => { await testdatenAnlegen(); }, 120_000);

describe('Kunden-Link: was er zeigt', () => {
  it('zeigt genau diesen einen Rapport, Betrag = Summe der Positionen', async () => {
    const r = await holen(F.A.token);
    const d = await r.json();
    expect(r.status).toBe(200);
    expect(d.nummer).toBe('A-1');
    expect(d.betrag_rappen).toBe(369919);
    expect(d.positionen.reduce((s: number, p: { betrag_rappen: number }) => s + p.betrag_rappen, 0)).toBe(369919);
    expect(JSON.stringify(d)).not.toMatch(/bbbbbbbb-|Baustelle B|Testbau B/);
  });

  it('erratene oder falsche Tokens zeigen nichts', async () => {
    for (const t of [crypto.randomUUID(), F.B.token.replace(/b$/, 'c'), '1', "' or 1=1 --", '', 'aaaaaaaa-0000-4000-8000-00000000aaa']) {
      const r = await holen(t);
      expect([400, 404, 500]).toContain(r.status);
      const text = await r.text();
      expect(text).not.toMatch(/betrag_rappen|positionen/);
    }
  });

  it('ungültiger Token (keine UUID) → 404 mit neutralem Text', async () => {
    const r = await holen('1');
    expect(r.status).toBe(404);
    expect(await r.text()).toMatch(/Link ist ungültig/);
  });

  it('Link zeigt nur Tarifklassen, keine Namen (Entscheid Amir, behoben 28.11.2026)', async () => {
    const d = await (await holen(F.A.token)).json();
    expect(JSON.stringify(d)).not.toMatch(/Chef A|Monteur A|Temp A/);
    expect(d.positionen.map((p: { bezeichnung: string }) => p.bezeichnung)).toEqual([
      'Gruppenleiter/in · 8.75 h', 'Gerüstmonteur/in · 17.50 h', 'Etappenzuschlag', 'Lieferwagen bis 3,5 t · 1.00 h', 'Materialmiete (9 % pro Monat)',
    ]);
    expect(d.positionen.map((p: { betrag_rappen: number }) => p.betrag_rappen)).toEqual([105875, 189000, 28000, 16500, 30544]);
  });

  it('Veralteter Kopf-Betrag: der Link rechnet aus den Zeilen, auf 5 Rappen (behoben 28.11.2026)', async () => {
    // Alter Stand aus der Zeit vor 0056 (Abbruch in RegieDetail.betragAktualisieren: Positionen neu, Kopf alt).
    // Heute verhindert die DB das — darum am Trigger vorbei (replica) nachstellen.
    sql(`set session_replication_role = replica; update regierapport set betrag_rappen = 339375 where id='${F.A.rapport}'; set session_replication_role = origin;`);
    expect(sql(`select betrag_rappen from regierapport where id='${F.A.rapport}';`)).toBe('339375');
    const d = await (await holen(F.A.token)).json();
    const summe = d.positionen.reduce((s: number, p: { betrag_rappen: number }) => s + p.betrag_rappen, 0);
    expect(summe).toBe(369919);
    expect(d.betrag_rappen).toBe(369920); // nicht der veraltete Kopf 339375
    expect(d.rundung_rappen).toBe(1);
  });

  it('auch ein Rapport, der gerade überarbeitet wird (Entwurf), zeigt über den alten Link Beträge', async () => {
    // Nach «Korrigieren» geht der Rapport zurück auf Entwurf, der Link bleibt gleich. Der Kunde sieht den Zwischenstand.
    sql(`update regierapport set status='entwurf' where id='${F.A.rapport}';`);
    const d = await (await holen(F.A.token)).json();
    expect(d.status).toBe('entwurf');
    expect(d.betrag_rappen).toBe(369920); // im Entwurf rechnet die DB neu: 3'699.19 → 3'699.20 — Befund «Link läuft nie ab» bleibt
  });
});

describe('Kunden-Link: was der Kunde tun kann', () => {
  it('Betrag lässt sich über die Antwort nicht ändern', async () => {
    const r = await antworten({ token: F.A.token, aktion: 'bestaetigt', betrag_rappen: 1, status: 'entwurf' });
    expect(r.status).toBe(200);
    expect(sql(`select betrag_rappen||'/'||status from regierapport where id='${F.A.rapport}';`)).toBe('369919/bestaetigt');
    expect(sql(`select sum(betrag_rappen) from regie_position where regierapport_id='${F.A.rapport}';`)).toBe('369919');
  });

  it('zweimal bestätigen ist harmlos, Zeitpunkt bleibt der erste', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    const erst = sql(`select bestaetigt_am from regierapport where id='${F.A.rapport}';`);
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await (await antworten({ token: F.A.token, aktion: 'bestaetigt' })).json();
    expect(r2.status).toBe('bestaetigt');
    expect(sql(`select bestaetigt_am from regierapport where id='${F.A.rapport}';`)).toBe(erst);
  });

  it('nach der Bestätigung kann der Kunde nicht mehr zurückfragen (Antwort sagt «bestätigt»)', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    const r = await (await antworten({ token: F.A.token, aktion: 'rueckfrage', kommentar: 'doch nicht' })).json();
    expect(r.status).toBe('bestaetigt');
    expect(sql(`select status from regierapport where id='${F.A.rapport}';`)).toBe('bestaetigt');
  });

  it('im Entwurf (nach «Korrigieren») kann der Kunde nicht bestätigen', async () => {
    sql(`update regierapport set status='entwurf' where id='${F.A.rapport}';`);
    const r = await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    expect(r.status).toBe(409);
    expect(sql(`select status from regierapport where id='${F.A.rapport}';`)).toBe('entwurf');
  });

  it('der Token von A bestätigt nie den Rapport von B', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    expect(sql(`select status from regierapport where id='${F.B.rapport}';`)).toBe('versendet');
  });

  it('nach der Bestätigung sind Betrag, Positionen und Stand gesperrt (behoben 28.11.2026)', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    const c = await anmelden('A', 'buero');
    const e1 = await c.from('regie_position').update({ betrag_rappen: 999999 }).eq('regierapport_id', F.A.rapport).eq('tarif_code', 'etappe');
    const e2 = await c.from('regierapport').update({ betrag_rappen: 1000 }).eq('id', F.A.rapport);
    const e3 = await c.from('regierapport').update({ status: 'entwurf' }).eq('id', F.A.rapport);
    const e4 = await c.from('regie_position').delete().eq('regierapport_id', F.A.rapport);
    expect([e1.error, e2.error, e3.error, e4.error].every(Boolean)).toBe(true);
    expect(sql(`select betrag_rappen||'/'||status from regierapport where id='${F.A.rapport}';`)).toBe('369919/bestaetigt');
    expect(sql(`select sum(betrag_rappen) from regie_position where regierapport_id='${F.A.rapport}';`)).toBe('369919');
  });

  it('der bestätigte Betrag wird festgehalten: am Rapport und im Zustellnachweis (behoben 28.11.2026)', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    expect(sql(`select bestaetigt_betrag_rappen from regierapport where id='${F.A.rapport}';`)).toBe('369919');
    const log = sql(`select coalesce(detail::text,'') from zustellung_log where regierapport_id='${F.A.rapport}' and ereignis='bestaetigt';`);
    expect(log).toMatch(/369919/);
  });
});

describe('PDF-Function: nur das eigene Büro', () => {
  const pdf = async (c: ReturnType<typeof createClient> | null, id: string) => {
    const token = c ? (await c.auth.getSession()).data.session?.access_token : ANON;
    return fetch(`${FN}/regierapport-pdf`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ regierapport_id: id }) });
  };

  it('Büro A bekommt kein PDF vom Rapport von B (404), Chefmonteur gar keins (403), ohne Anmeldung 401', async () => {
    expect((await pdf(await anmelden('A', 'buero'), F.B.rapport)).status).toBe(404);
    expect((await pdf(await anmelden('A', 'chef'), F.A.rapport)).status).toBe(403);
    expect((await pdf(null, F.A.rapport)).status).toBe(401);
  });

  it('Büro A bekommt sein eigenes PDF', async () => {
    const r = await pdf(await anmelden('A', 'buero'), F.A.rapport);
    const d = await r.json();
    expect(r.status, JSON.stringify(d)).toBe(200);
    expect(d.pfad).toBe(`rapporte/${F.A.rapport}.pdf`);
  });
});
