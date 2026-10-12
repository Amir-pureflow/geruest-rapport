/**
 * Offline-Warteschlange: Idempotenz und Fehlerdeutung mit einem Fake-Supabase-Client.
 * IndexedDB kommt aus fake-indexeddb (Dexie läuft damit in Node).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  db, enqueueMeldung, aktualisiereMeldung, flushNachSupabase, lokaleWarteschlangeLeeren, offeneMeldungen, offeneAnzahl, warteStand,
  zeilenAuslassen, nochmalsVersuchen, meldungBeiseitelegen, firmaWarteschlangeLeeren, warteschlangeZuordnen, problemText, type MeldungPayload,
} from './db';
import { gehoertZu, zugangMerken, zugangVergessen } from './zugang';

type DbFehler = { code?: string; message: string } | null;
interface Aufruf { tabelle: string; op: string; rows: unknown }

interface FakeOpts {
  /** Fehler je (Tabelle, Operation) — wird bei jedem Aufruf gefragt, kann also zählen. `rows` = was gesendet wurde. */
  fehler?: (tabelle: string, op: string, rows: unknown) => DbFehler;
  /** Fehler des Storage-Uploads je Pfad. */
  upload?: (pfad: string) => { message: string; statusCode?: string } | null;
  /** Angemeldeter Benutzer (Sitzung) — ohne: keine Sitzung, dann gehen nur Alt-Einträge ohne Firma. */
  user?: () => string | null;
  /** Vor jeder Antwort warten — stellt ein langsames Netz nach. */
  warten?: (tabelle: string, op: string) => Promise<void>;
}

function fakeClient(opts: FakeOpts = {}) {
  const aufrufe: Aufruf[] = [];
  const uploads: string[] = [];
  const antwort = async (tabelle: string, op: string, rows: unknown) => {
    aufrufe.push({ tabelle, op, rows });
    await opts.warten?.(tabelle, op);
    return { data: null, error: opts.fehler?.(tabelle, op, rows) ?? null };
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: opts.user?.() ? { user: { id: opts.user() } } : null } }) },
    from: (tabelle: string) => ({
      upsert: (rows: unknown) => antwort(tabelle, 'upsert', rows),
      insert: (rows: unknown) => antwort(tabelle, 'insert', rows),
      // `.select()` nach dem Ändern: die geänderten Zeilen (hier eine, solange kein Fehler kommt)
      update: (rows: unknown) => ({
        eq: () => {
          const p = antwort(tabelle, 'update', rows);
          return Object.assign(p, { select: () => p.then((r) => ({ ...r, data: r.error ? null : [{ id: 'k' }] })) });
        },
      }),
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

const ton = () => new Blob(['audio'], { type: 'audio/webm' });

beforeEach(async () => {
  await lokaleWarteschlangeLeeren();
  zugangVergessen();
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
    // ohne Pausen-Abzug keine dritte Spanne — die Meldung kommt auch vor Migration 0029 durch
    expect(zeiten[0]).not.toHaveProperty('von3_min');
  });

  it('dritte Spanne vor Migration 0029: nur diese Meldung wartet, die andern gehen durch', async () => {
    const mitPause = meldung(4);
    mitPause.eintraege[0] = { ...mitPause.eintraege[0], von_min: 420, bis_min: 540, von2_min: 570, bis2_min: 720, von3_min: 780, bis3_min: 1020 };
    await enqueueMeldung(mitPause);
    await enqueueMeldung(meldung(5));
    let migriert = false;
    const { client } = fakeClient({
      fehler: (t, op, rows) =>
        !migriert && t === 'zeiteintrag' && op === 'upsert' && (rows as Record<string, unknown>[]).some((r) => 'von3_min' in r)
          ? { code: 'PGRST204', message: "Could not find the 'von3_min' column of 'zeiteintrag' in the schema cache" }
          : null,
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 1, fehler: 1, verworfen: 0 });
    expect(erg.fehlerText).toContain('Migration 0029');
    expect(await offeneMeldungen()).toHaveLength(1);

    migriert = true;
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1, fehler: 0 });
    expect(await offeneMeldungen()).toHaveLength(0);
  });
});

describe('flushNachSupabase — Fehlerdeutung', () => {
  it('Fremdschlüssel am Kopf (23503) → nichts verworfen: Meldung und Sprachnotiz bleiben, der Chefmonteur sieht den Grund', async () => {
    const cu = await enqueueMeldung(meldung(1), ton());
    let teamWeg = true;
    const { client, aufrufe } = fakeClient({
      fehler: (t, op) => (teamWeg && t === 'tagesmeldung' && op === 'upsert' ? { code: '23503', message: 'insert or update on table "tagesmeldung" violates foreign key constraint "tagesmeldung_team_id_fkey"' } : null),
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 0, verworfen: 0, haengend: 1 });
    expect(erg.fehlerText).toContain('Das Team');
    expect(erg.fehlerText).toContain('Büro anrufen');
    const e = await db.meldungen.get(cu);
    expect(e?.status).toBe('lokal');
    expect(e?.kopfFehler).toContain('Das Team');
    expect(await db.audio.get(cu)).toBeDefined(); // Beleg bleibt (CLAUDE.md #8)

    // Nicht blind jede Minute wiederholen — erst, wenn der Chefmonteur «Nochmals versuchen» tippt
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 0, haengend: 1 });
    expect(aufrufe.filter((a) => a.tabelle === 'tagesmeldung' && a.op === 'upsert')).toHaveLength(1);
    expect((await warteStand()).probleme).toMatchObject([{ client_uuid: cu, art: 'kopf' }]);

    teamWeg = false; // das Büro hat das Team wieder angelegt
    await nochmalsVersuchen(cu);
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1, haengend: 0 });
  });

  it('Beiseitelegen: wird nicht mehr gesendet, Sprachnotiz bleibt auf dem Gerät', async () => {
    const cu = await enqueueMeldung(meldung(1), ton());
    const { client } = fakeClient({ fehler: (t, op) => (t === 'tagesmeldung' && op === 'upsert' ? { code: '23503', message: 'violates foreign key constraint "tagesmeldung_baustelle_id_fkey"' } : null) });
    await flushNachSupabase(client);
    await meldungBeiseitelegen(cu);
    expect((await db.meldungen.get(cu))?.status).toBe('beiseite');
    expect(await db.audio.get(cu)).toBeDefined();
    expect(await offeneAnzahl()).toBe(0);
  });

  it('Fremdschlüssel bei einer Zeile → die anderen Zeilen und die Sprachnotiz gehen hinaus, die eine wartet mit Grund', async () => {
    const cu = await enqueueMeldung(meldung(1), ton(), [], { p1: 'Marco Rossi', p2: 'Luan Berisha' });
    const fk = { code: '23503', message: 'insert or update on table "zeiteintrag" violates foreign key constraint "zeiteintrag_mitarbeiter_id_fkey"' };
    const { client, aufrufe, uploads } = fakeClient({
      fehler: (t, op, rows) => (t === 'zeiteintrag' && op === 'upsert' && (rows as { mitarbeiter_id: string }[]).some((r) => r.mitarbeiter_id === 'p2') ? fk : null),
    });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, verworfen: 0, haengend: 1 });
    expect(erg.fehlerText).toBe('1 Zeile konnte nicht gesendet werden: Luan Berisha — diese Person gibt es auf dem Server nicht mehr. Bitte Büro anrufen.');
    // Nichts auf dem Server gelöscht; die Zeile von p1 ist drin, die Sprachnotiz auch
    expect(aufrufe.some((a) => a.op === 'delete')).toBe(false);
    const einzeln = aufrufe
      .filter((a) => a.tabelle === 'zeiteintrag' && (a.rows as unknown[]).length === 1)
      .map((a) => (a.rows as { mitarbeiter_id: string }[])[0].mitarbeiter_id);
    expect(einzeln).toEqual(['p1', 'p2']);
    expect(uploads).toEqual([`audio/${cu}.webm`]);
    const e = await db.meldungen.get(cu);
    expect(e?.status).toBe('lokal');
    expect(e?.zeilenFehler).toMatchObject([{ mitarbeiter_id: 'p2' }]);
    expect((await warteStand()).probleme).toMatchObject([{ client_uuid: cu, art: 'zeilen', namen: ['Luan Berisha'] }]);

    // «Ohne diese Person abschliessen»: der Rest gilt als gesendet, die Zeile bleibt im Eintrag stehen
    await zeilenAuslassen(cu);
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1, haengend: 0 });
    const fertig = await db.meldungen.get(cu);
    expect(fertig?.status).toBe('gesendet');
    expect(fertig?.ausgelassen).toMatchObject([{ mitarbeiter_id: 'p2' }]);
    expect((fertig?.payload as unknown as MeldungPayload).eintraege).toHaveLength(2);
  });

  it('problemText ohne Namen: «eine Person»', () => {
    expect(problemText({ zeilenFehler: [{ id: 'z', mitarbeiter_id: 'x', grund: 'diese Person gibt es auf dem Server nicht mehr' }] })).toContain('eine Person — diese Person');
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

  it('Netzfehler (Zeitüberschreitung) → Meldung wartet weiter, mit verständlichem Grund', async () => {
    const cu = await enqueueMeldung(meldung(1));
    const { client } = fakeClient({ fehler: (t) => (t === 'tagesmeldung' ? { message: 'AbortError: Failed to fetch (Zeitüberschreitung)' } : null) });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 1, verworfen: 0 });
    expect(erg.fehlerText).toContain('Keine Verbindung');
    expect((await db.meldungen.get(cu))?.status).toBe('lokal');
    expect((await warteStand()).fehlerText).toContain('Keine Verbindung');
  });
});

describe('flushNachSupabase — Sprachnotiz (Beleg)', () => {
  it('lokaler Blob bleibt, wenn die Verknüpfung an der Meldung scheitert — beim nächsten Flush klappt es', async () => {
    const cu = await enqueueMeldung(meldung(1), ton());
    let verknuepfungKaputt = true;
    const { client, aufrufe, uploads } = fakeClient({
      fehler: (t, op) => (verknuepfungKaputt && t === 'tagesmeldung' && op === 'update' ? { message: 'Datenbank nicht erreichbar' } : null),
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
    const cu = await enqueueMeldung(meldung(1), ton());
    const { client } = fakeClient({ upload: () => ({ message: 'Payload too large', statusCode: '413' }) });
    const erg = await flushNachSupabase(client);
    expect(erg).toMatchObject({ gesendet: 0, fehler: 1 });
    expect(erg.fehlerText).toContain('Sprachnotiz konnte nicht hochgeladen werden');
    expect(await db.audio.get(cu)).toBeDefined();
  });
});

describe('aktualisiereMeldung — Wiederholung legt keine zweite Meldung an (Fehler 03.10.2026)', () => {
  it('neue Fassung behält Kopf- und Eintrags-Kennungen, die alte bleibt als «ersetzt» samt Belegen liegen', async () => {
    const cu = await enqueueMeldung(meldung(1), ton());
    const original = (await db.meldungen.get(cu))!.payload as unknown as MeldungPayload;

    // Zweiter Druck: andere Stunden, aber dieselbe Meldung
    const zweiterVersuch: MeldungPayload = {
      ...meldung(1),
      id: 'ganz-neue-id',
      eintraege: original.eintraege.map((z) => ({ ...z, id: 'neue-' + z.id, normal_min: 300 })),
    };
    const r = await aktualisiereMeldung(cu, zweiterVersuch, ton());
    expect(r.art).toBe('aktualisiert');
    const neu = r.art === 'aktualisiert' ? r.uuid : '';

    expect(await offeneMeldungen()).toHaveLength(1); // keine Dublette
    const jetzt = (await db.meldungen.get(neu))!.payload as unknown as MeldungPayload;
    expect(jetzt.id).toBe(original.id);                               // Kopf behält seine Kennung
    expect(jetzt.eintraege.map((z) => z.id)).toEqual(original.eintraege.map((z) => z.id));
    expect(jetzt.eintraege[0].normal_min).toBe(300);                  // die neuen Stunden gelten
    expect((await db.meldungen.get(cu))?.status).toBe('ersetzt');
    expect(await db.audio.get(cu)).toBeDefined();                     // nichts gelöscht (CLAUDE.md #8)
  });

  it('gesendete Meldungen werden nicht angefasst — dann gehört der nächste Druck zu einer neuen', async () => {
    const cu = await enqueueMeldung(meldung(1));
    await db.meldungen.update(cu, { status: 'gesendet' });
    expect(await aktualisiereMeldung(cu, meldung(1))).toEqual({ art: 'neu' });
  });

  it('lehnt der Server den Kopf mit Fehlercode ab, war nichts unterwegs — ändern geht weiter', async () => {
    const cu = await enqueueMeldung(meldung(1));
    const { client } = fakeClient({ fehler: (t) => (t === 'tagesmeldung' ? { code: '42501', message: 'new row violates row-level security policy' } : null) });
    await flushNachSupabase(client);
    expect((await db.meldungen.get(cu))?.versucht).toBe(false);
    expect((await aktualisiereMeldung(cu, meldung(1))).art).toBe('aktualisiert');
  });

  it('kam auf den Kopf keine Antwort (Zeitüberschreitung), kann er auf dem Server sein — dann nicht mehr ändern', async () => {
    const cu = await enqueueMeldung(meldung(1));
    const { client } = fakeClient({ fehler: (t) => (t === 'tagesmeldung' ? { code: '', message: 'AbortError: Failed to fetch (Zeitüberschreitung nach 45 s)' } : null) });
    await flushNachSupabase(client);
    expect((await db.meldungen.get(cu))?.versucht).toBe(true);
    expect(await aktualisiereMeldung(cu, meldung(1))).toEqual({ art: 'unterwegs' });
  });

  it('schon unterwegs (ein Sendeversuch lief): weder ändern noch eine zweite anlegen', async () => {
    const cu = await enqueueMeldung(meldung(1));
    const { client } = fakeClient({ fehler: (t) => (t === 'zeiteintrag' ? { message: 'Failed to fetch' } : null) });
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 0, fehler: 1 });
    expect(await aktualisiereMeldung(cu, meldung(1))).toEqual({ art: 'unterwegs' });
    expect(await offeneMeldungen()).toHaveLength(1);
  });
});

describe('Nie zwei Durchgänge gleichzeitig (13.10.2026)', () => {
  it('Hintergrund, Startseite und «Tag melden» gleichzeitig: jede Meldung geht genau einmal hinaus', async () => {
    await enqueueMeldung(meldung(1));
    await enqueueMeldung(meldung(2));
    const { client, aufrufe } = fakeClient({ warten: () => new Promise((r) => setTimeout(r, 2)) });
    const erst = flushNachSupabase(client);
    await new Promise((r) => setTimeout(r, 1)); // der erste läuft schon …
    const [a, b, c] = await Promise.all([erst, flushNachSupabase(client), flushNachSupabase(client)]);
    // … der zweite wartet dahinter, der dritte schliesst sich dem zweiten an
    expect(b).toBe(c);
    expect(a.gesendet + b.gesendet).toBe(2);
    expect(aufrufe.filter((x) => x.tabelle === 'tagesmeldung' && x.op === 'upsert')).toHaveLength(2);
    expect(aufrufe.filter((x) => x.tabelle === 'zeiteintrag' && x.op === 'upsert')).toHaveLength(2);
  });

  it('eine Meldung, die während eines laufenden Durchgangs dazukommt, nimmt der nächste mit', async () => {
    await enqueueMeldung(meldung(1));
    let zweite: Promise<string> | null = null;
    const { client } = fakeClient({ warten: async (t) => { if (t === 'zeiteintrag' && !zweite) zweite = enqueueMeldung(meldung(2)); } });
    const erst = flushNachSupabase(client);
    await new Promise((r) => setTimeout(r, 5));
    const dann = flushNachSupabase(client);
    expect((await erst).gesendet + (await dann).gesendet).toBe(2);
    expect(await offeneMeldungen()).toHaveLength(0);
  });

  it('ändert sich ein Eintrag während des Sendens (rev), wird er nicht als gesendet markiert', async () => {
    const cu = await enqueueMeldung(meldung(1));
    const { client } = fakeClient({
      warten: async (t) => { if (t === 'zeiteintrag') await db.meldungen.update(cu, { rev: 7 }); },
    });
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 0 });
    expect((await db.meldungen.get(cu))?.status).toBe('lokal');
    expect(await flushNachSupabase(fakeClient().client)).toMatchObject({ gesendet: 1 }); // beim nächsten Mal mit dem neuen Stand
  });
});

describe('Warteschlange gehört einer Firma (13.10.2026)', () => {
  it('Meldungen von Firma A gehen nicht mit der Anmeldung von Firma B hinaus — und warten sichtbar', async () => {
    zugangMerken({ user: 'u-a', firma: 'f-a', name: 'Gerüst GmbH' });
    const cu = await enqueueMeldung(meldung(1));
    expect(await db.meldungen.get(cu)).toMatchObject({ firma_id: 'f-a', auth_user_id: 'u-a', firma_name: 'Gerüst GmbH' });

    // Abmelden, We-Plan meldet sich an
    zugangMerken({ user: 'u-b', firma: 'f-b', name: 'We-Plan' });
    let user = 'u-b';
    const { client, aufrufe } = fakeClient({ user: () => user });
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 0 });
    expect(aufrufe).toHaveLength(0);
    expect(await offeneAnzahl()).toBe(0);
    expect((await warteStand()).fremd).toEqual([{ name: 'Gerüst GmbH', anzahl: 1 }]);

    // Gerüst GmbH wieder angemeldet → geht hinaus
    zugangMerken({ user: 'u-a', firma: 'f-a', name: 'Gerüst GmbH' });
    user = 'u-a';
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 1 });
  });

  it('beim Start steht noch die Firma vom letzten Mal im Speicher: gesendet wird nach der Sitzung, nicht nach dem Gemerkten', async () => {
    zugangMerken({ user: 'u-a', firma: 'f-a', name: null });
    await enqueueMeldung(meldung(1));
    // Die Sitzung gehört schon u-b, der Speicher sagt noch u-a
    const { client, aufrufe } = fakeClient({ user: () => 'u-b' });
    expect(await flushNachSupabase(client)).toMatchObject({ gesendet: 0 });
    expect(aufrufe).toHaveLength(0);
  });

  it('Alt-Einträge ohne Firma gehören der angemeldeten Firma', () => {
    expect(gehoertZu({}, { user: 'u-b', firma: 'f-b' })).toBe(true);
    expect(gehoertZu({ firma_id: 'f-a', auth_user_id: 'u-a' }, { user: 'u-b', firma: 'f-b' })).toBe(false);
    // Firma noch unbekannt: derselbe Benutzer darf (ein Konto gehört zu genau einer Firma)
    expect(gehoertZu({ firma_id: null, auth_user_id: 'u-a' }, { user: 'u-a', firma: 'f-a' })).toBe(true);
    expect(gehoertZu({ firma_id: 'f-a', auth_user_id: 'u-a' }, { user: 'u-a', firma: null })).toBe(true);
    expect(gehoertZu({ firma_id: null, auth_user_id: 'u-a' }, { user: 'u-b', firma: null })).toBe(false);
  });

  it('Firma erst nach dem Erfassen bekannt (Start ohne Netz): wird nachgetragen', async () => {
    zugangMerken({ user: 'u-a', firma: null, name: null });
    const cu = await enqueueMeldung(meldung(1));
    expect(await db.meldungen.get(cu)).toMatchObject({ firma_id: null, auth_user_id: 'u-a' });
    await warteschlangeZuordnen('u-a', 'f-a', 'Gerüst GmbH');
    expect(await db.meldungen.get(cu)).toMatchObject({ firma_id: 'f-a', firma_name: 'Gerüst GmbH' });
  });

  it('Demo leeren nimmt nur die Einträge der Demo-Firma, nie die einer anderen oder alte ohne Firma', async () => {
    await enqueueMeldung(meldung(1));                                  // alt, ohne Firma
    zugangMerken({ user: 'u-a', firma: 'f-a', name: 'Gerüst GmbH' });
    await enqueueMeldung(meldung(2));
    zugangMerken({ user: 'u-d', firma: 'f-demo', name: 'We-Plan' });
    await enqueueMeldung(meldung(3), ton());
    expect(await firmaWarteschlangeLeeren('f-demo')).toBe(1);
    const rest = (await db.meldungen.toArray()).map((e) => (e.payload as unknown as MeldungPayload).id).sort();
    expect(rest).toEqual(['m-1', 'm-2']);
  });
});

describe('Belege: ein Blob, der sich nicht ablegen lässt, reisst die Stunden nicht mit', () => {
  it('Meldung bleibt in der Warteschlange, der Grund steht am Eintrag', async () => {
    const kaputt = { get type() { throw new Error('QuotaExceededError'); } } as unknown as Blob;
    const cu = await enqueueMeldung(meldung(1), undefined, [kaputt]);
    expect(await offeneMeldungen()).toHaveLength(1);
    const eintrag = await db.meldungen.get(cu);
    expect(eintrag?.belegFehler).toContain('Fotos');
  });
});
