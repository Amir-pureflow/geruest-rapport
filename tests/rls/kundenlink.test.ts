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

  it.fails('BEKANNTER FEHLER (Entscheid Amir: Kunde soll keine Namen sehen): der Link zeigt Namen und Stunden einzelner Mitarbeitender — das PDF zeigt bewusst nur Tarifklassen', async () => {
    const d = await (await holen(F.A.token)).json();
    expect(JSON.stringify(d.positionen)).not.toMatch(/Chef A|Monteur A|Temp A/);
  });

  it.fails('BEKANNTER FEHLER: Kopf-Betrag und Positionen können auseinanderlaufen — der Link zeigt beides ungeprüft', async () => {
    // Nachstellen, was RegieDetail.betragAktualisieren bei einem Abbruch hinterlässt: Positionen neu, Kopf alt
    sql(`update regierapport set betrag_rappen = 339375 where id='${F.A.rapport}';`);
    const d = await (await holen(F.A.token)).json();
    const summe = d.positionen.reduce((s: number, p: { betrag_rappen: number }) => s + p.betrag_rappen, 0);
    expect(d.betrag_rappen).toBe(summe); // 339375 ≠ 369919
  });

  it('auch ein Rapport, der gerade überarbeitet wird (Entwurf), zeigt über den alten Link Beträge', async () => {
    // Nach «Korrigieren» geht der Rapport zurück auf Entwurf, der Link bleibt gleich. Der Kunde sieht den Zwischenstand.
    sql(`update regierapport set status='entwurf' where id='${F.A.rapport}';`);
    const d = await (await holen(F.A.token)).json();
    expect(d.status).toBe('entwurf');
    expect(d.betrag_rappen).toBe(369919); // heute so — Befund, siehe Bericht
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

  it.fails('BEKANNTER FEHLER: nach der Bestätigung kann das Büro Beträge und Positionen noch ändern', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
    const c = await anmelden('A', 'buero');
    await c.from('regie_position').update({ betrag_rappen: 999999 }).eq('regierapport_id', F.A.rapport).eq('tarif_code', 'etappe');
    await c.from('regierapport').update({ betrag_rappen: 1000 }).eq('id', F.A.rapport);
    // Richtig wäre: bestätigt = eingefroren (oder mindestens festgehalten, was bestätigt wurde)
    expect(sql(`select betrag_rappen from regierapport where id='${F.A.rapport}';`)).toBe('369919');
  });

  it.fails('BEKANNTER FEHLER: es wird nirgends festgehalten, WELCHER Betrag bestätigt wurde', async () => {
    await antworten({ token: F.A.token, aktion: 'bestaetigt' });
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
