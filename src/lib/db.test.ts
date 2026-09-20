/**
 * Offline-Warteschlange: Idempotenz und Fehlerdeutung mit einem Fake-Supabase-Client.
 * IndexedDB kommt aus fake-indexeddb (Dexie läuft damit in Node).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, enqueueMeldung, flushNachSupabase, lokaleWarteschlangeLeeren, offeneMeldungen, type MeldungPayload } from './db';

type DbFehler = { code?: string; message: string } | null;
interface Aufruf { tabelle: string; op: string; rows: unknown }

interface FakeOpts {
  /** Fehler je (Tabelle, Operation) — wird bei jedem Aufruf gefragt, kann also zählen. */
  fehler?: (tabelle: string, op: string) => DbFehler;
  /** Fehler des Storage-Uploads je Pfad. */
  upload?: (pfad: string) => { message: string; statusCode?: string } | null;
}

function fakeClient(opts: FakeOpts = {}) {
  const aufrufe: Aufruf[] = [];
  const uploads: string[] = [];
  const antwort = (tabelle: string, op: string, rows: unknown) => {
    aufrufe.push({ tabelle, op, rows });
    return Promise.resolve({ data: null, error: opts.fehler?.(tabelle, op) ?? null });
  };
  const client = {
    from: (tabelle: string) => ({
      upsert: (rows: unknown) => antwort(tabelle, 'upsert', rows),
      insert: (rows: unknown) => antwort(tabelle, 'insert', rows),
      update: (rows: unknown) => ({ eq: () => antwort(tabelle, 'update', rows) }),
      delete: () => ({ eq: () => antwort(tabelle, 'delete', null) }),
    }),
    storage: {
      from: () => ({
        upload: (pfad: string, _blob: Blob, o: { upsert?: boolean }) => {
          expect(o.upsert).toBe(false); // Belege werden nie überschrieben (CLAUDE.md #8, Policies 0009)
          uploads.push(pfad);
          return Promise.resolve({ data: null, error: opts.upload?.(pfad) ?? null });
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, aufrufe, uploads };
}

function meldung(n: number): MeldungPayload {
  const id = `m-${n}`;
  return {
    id,
    team_id: 't1',
    datum: '2026-09-09',
    baustelle_id: 'b1',
    normalfall: true,
    abweichung_typ: null,
    wer_hats_gewollt: null,
    audio_sekunden: null,
    erfasst_von: 'u1',
    eintraege: [
      { id: `${id}-z1`, mitarbeiter_id: 'p1', normal_min: 480, ueber_min: 0, oev: false, km: 12, baustelle_id: 'b1', konto_nr: '903673' },
      { id: `${id}-z2`, mitarbeiter_id: 'p2', normal_min: 480, ueber_min: 30, oev: true, km: 0, baustelle_id: 'b1', konto_nr: '903673' },
    ],
  };
}

beforeEach(async () => {
  await lokaleWarteschlangeLeeren();
});

describe('flushNachSupabase — Idempotenz', () => {
  it('zweimal flushen sendet jede Meldung genau einmal', async () => {
    await enqueueMeldung(meldung(1));
    await enqueueMeldung(meldung(2));
    const { client, aufrufe } = fakeClient();

    const erst = await flushNachSupabase(client);
    expect(erst).toMatchObject({ gesendet: 2, fehler: 0, verworfen: 0 });
    expect(await offeneMeldungen()).toHaveLength(0);

    const zweit = await flushNachSupabase(client);
    expect(zweit).toMatchObject({ gesendet: 0, fehler: 0, verworfen: 0 });

    const koepfe = aufrufe.filter((a) => a.tabelle === 'tagesmeldung' && a.op === 'upsert');
    expect(koepfe).toHaveLength(2);
    const zeiten = aufrufe.filter((a) => a.tabelle === 'zeiteintrag' && a.op === 'upsert');
    expect(zeiten).toHaveLength(2);
    // Zeiteinträge tragen die id der Meldung, die das Gerät vergeben hat
    expect((zeiten[0].rows as { tagesmeldung_id: string }[])[0].tagesmeldung_id).toBe('m-1');
    // client_uuid der Queue landet als Idempotenzschlüssel im Kopf
    expect(koepfe[0].rows).toHaveProperty('client_uuid');
  });

  it('Zeiten von–bis gehen mit, wenn sie im Eintrag stehen (Migration 0016)', async () => {
    const m = meldung(3);
    m.eintraege[0] = { ...m.eintraege[0], von_min: 420, bis_min: 720, von2_min: 780, bis2_min: 1020 };
    await enqueueMeldung(m);
    const { client, aufrufe } = fakeClient();
    await flushNachSupabase(client);
    const zeiten = aufrufe.find((a) => a.tabelle === 'zeiteintrag' && a.op === 'upsert')!.rows as Record<string, unknown>[];
    expect(zeiten[0]).toMatchObject({ von_min: 420, bis_min: 720, von2_min: 780, bis2_min: 1020 });
    // ohne Zeiten bleiben die Spalten weg — die Stundenzahl-Meldung ist auch vor der Migration gültig
    expect(zeiten[1]).not.toHaveProperty('von_min');
  });
});

describe('flushNachSupabase — Fehlerdeutung', () => {
  it('Fremdschlüssel (23503) → Meldung wird aussortiert und nie mehr gesendet', async () => {
    await enqueueMeldung(meldung(1));
    const { client, aufrufe } = fakeClient({
      fehler: (t, op) => (t === 'tagesmeldung' && op === 'upsert' ? { code: '23503', message: 'insert or update on table "tagesmeldung" violates foreign key constraint "tagesmeldung_team_id_fkey"' } : null),
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 0, verworfen: 1 });
    expect(erg.fehlerText).toContain('das Team');
    expect(erg.fehlerText).toContain('aussortiert');
    expect((await db.meldungen.toArray())[0].status).toBe('verworfen');

    const nochmals = await flushNachSupabase(client);
    expect(nochmals).toMatchObject({ gesendet: 0, fehler: 0, verworfen: 0 });
    expect(aufrufe.filter((a) => a.tabelle === 'tagesmeldung')).toHaveLength(1);
  });

  it('Fremdschlüssel bei den Zeiteinträgen → Kopf wird wieder entfernt, Meldung aussortiert', async () => {
    await enqueueMeldung(meldung(1));
    const { client, aufrufe } = fakeClient({
      fehler: (t, op) => (t === 'zeiteintrag' && op === 'upsert' ? { code: '23503', message: 'violates foreign key constraint "zeiteintrag_mitarbeiter_id_fkey"' } : null),
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ verworfen: 1 });
    expect(erg.fehlerText).toContain('eine Person');
    expect(aufrufe.some((a) => a.tabelle === 'tagesmeldung' && a.op === 'delete')).toBe(true);
  });

  it('Keine Berechtigung (42501) → Fehler mit Login-Text, Meldung bleibt lokal und kommt später durch', async () => {
    await enqueueMeldung(meldung(1));
    let sperren = true;
    const { client } = fakeClient({
      fehler: (t) => (sperren && t === 'tagesmeldung' ? { code: '42501', message: 'new row violates row-level security policy for table "tagesmeldung"' } : null),
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 1, verworfen: 0 });
    expect(erg.fehlerText).toBe('Keine Berechtigung — bitte neu anmelden.');
    expect(await offeneMeldungen()).toHaveLength(1);

    sperren = false;
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1, fehler: 0 });
    expect(await offeneMeldungen()).toHaveLength(0);
  });

  it('Alt-Einträge ohne id/eintraege blockieren die Warteschlange nicht', async () => {
    await db.meldungen.add({ client_uuid: 'alt-1', payload: { team: 'x' }, erstellt: Date.now(), status: 'lokal' });
    await enqueueMeldung(meldung(2));
    const { client } = fakeClient();
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1, verworfen: 1 });
  });
});

describe('flushNachSupabase — Sprachnotiz (Beleg)', () => {
  const blob = () => new Blob(['audio'], { type: 'audio/webm' });

  it('lokaler Blob bleibt, wenn die Verknüpfung an der Meldung scheitert — beim nächsten Flush klappt es', async () => {
    const cu = await enqueueMeldung(meldung(1), blob());
    let verknuepfungKaputt = true;
    const { client, aufrufe, uploads } = fakeClient({
      fehler: (t, op) => (verknuepfungKaputt && t === 'tagesmeldung' && op === 'update' ? { message: 'network' } : null),
      // zweiter Anlauf: Datei liegt schon im Bucket → gilt als Erfolg
      upload: (pfad) => (uploads.includes(pfad) ? { message: 'The resource already exists', statusCode: '409' } : null),
    });

    const erst = await flushNachSupabase(client);
    expect(erst).toMatchObject({ gesendet: 0, fehler: 1 });
    expect(erst.fehlerText).toContain('Sprachnotiz konnte nicht verknüpft werden');
    expect(await db.audio.get(cu)).toBeDefined();
    expect(await offeneMeldungen()).toHaveLength(1);

    verknuepfungKaputt = false;
    const zweit = await flushNachSupabase(client);
    expect(zweit).toMatchObject({ gesendet: 1, fehler: 0 });
    expect(await db.audio.get(cu)).toBeUndefined();
    expect(uploads).toEqual([`audio/${cu}.webm`, `audio/${cu}.webm`]);
    const updates = aufrufe.filter((a) => a.tabelle === 'tagesmeldung' && a.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].rows).toEqual({ audio_pfad: `audio/${cu}.webm` });
  });

  it('Upload-Fehler (nicht «existiert schon») zählt als Fehler, Blob bleibt', async () => {
    const cu = await enqueueMeldung(meldung(1), blob());
    const { client } = fakeClient({ upload: () => ({ message: 'Payload too large', statusCode: '413' }) });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 1 });
    expect(erg.fehlerText).toContain('Sprachnotiz konnte nicht hochgeladen werden');
    expect(await db.audio.get(cu)).toBeDefined();
  });
});
