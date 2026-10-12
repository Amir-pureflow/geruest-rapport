/**
 * «Frühere ersetzen»: prüfen, jede Antwort ansehen, nie doppelt zählen, nie einen Beleg löschen.
 * Der Fake-Client hält die Tabellen im Speicher und kann einfache Abfragen (eq, in, maybeSingle, Zählen, Löschen).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, enqueueMeldung, flushNachSupabase, lokaleWarteschlangeLeeren, type MeldungPayload } from './db';
import { ersetzbarGrund, ersetzen, ersetzenPruefen } from './ersetzen';
import { zugangVergessen } from './zugang';

type Zeile = Record<string, unknown>;

function speicherClient(tabellen: Record<string, Zeile[]>, opts: { warten?: (tabelle: string, op: string) => Promise<void>; loeschFehler?: (tabelle: string) => { code?: string; message: string } | null } = {}) {
  const aufrufe: string[] = [];
  const liste = (t: string) => (tabellen[t] ??= []);
  function abfrage(t: string, op: 'select' | 'delete' | 'update', werte?: Zeile, kopf = false) {
    const filter: ((z: Zeile) => boolean)[] = [];
    let einzeln = false;
    let mitZeilen = op === 'select';
    const ausfuehren = async () => {
      aufrufe.push(`${op} ${t}`);
      await opts.warten?.(t, op);
      const treffer = liste(t).filter((z) => filter.every((f) => f(z)));
      if (op === 'delete') {
        const fehler = opts.loeschFehler?.(t) ?? null;
        if (fehler) return { data: null, error: fehler };
        tabellen[t] = liste(t).filter((z) => !treffer.includes(z));
      }
      if (op === 'update') for (const z of treffer) Object.assign(z, werte);
      if (kopf) return { data: null, count: treffer.length, error: null };
      if (einzeln) return { data: treffer[0] ?? null, error: null };
      return { data: mitZeilen ? treffer : null, error: null };
    };
    const b = {
      eq(c: string, v: unknown) { filter.push((z) => z[c] === v); return b; },
      in(c: string, v: unknown[]) { filter.push((z) => v.includes(z[c])); return b; },
      select() { mitZeilen = true; return b; },
      maybeSingle() { einzeln = true; return b; },
      then<A, B>(ok: (x: Awaited<ReturnType<typeof ausfuehren>>) => A, nein?: (e: unknown) => B) { return ausfuehren().then(ok, nein); },
    };
    return b;
  }
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    from: (t: string) => ({
      select: (_spalten?: string, o?: { head?: boolean }) => abfrage(t, 'select', undefined, !!o?.head),
      delete: () => abfrage(t, 'delete'),
      update: (w: Zeile) => abfrage(t, 'update', w),
      upsert: async (rows: Zeile | Zeile[], o: { onConflict: string }) => {
        aufrufe.push(`upsert ${t}`);
        await opts.warten?.(t, 'upsert');
        for (const r of Array.isArray(rows) ? rows : [rows]) {
          if (!liste(t).some((z) => z[o.onConflict] === r[o.onConflict])) liste(t).push({ status: 'offen', ...r });
        }
        return { data: null, error: null };
      },
    }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    // `tagesmeldung_entfernen` (0043): prüft und löscht in einem Schritt, wie die Datenbank
    rpc: async (name: string, args: { p_id: string }) => {
      aufrufe.push(`rpc ${name}`);
      if (name !== 'tagesmeldung_entfernen') return { data: null, error: { message: `unbekannte Funktion ${name}` } };
      const fehler = opts.loeschFehler?.('tagesmeldung') ?? null;
      if (fehler) return { data: null, error: fehler };
      const kopf = liste('tagesmeldung').find((z) => z.id === args.p_id);
      if (!kopf) return { data: 'weg', error: null };
      const zeilen = liste('zeiteintrag').filter((z) => z.tagesmeldung_id === args.p_id);
      const nein = (message: string) => ({ data: null, error: { message } });
      if (zeilen.some((z) => z.status !== 'offen')) return nein('Der Bauführer hat diese Meldung schon freigegeben.');
      if (liste('freigabe_log').some((l) => zeilen.some((z) => z.id === l.zeiteintrag_id))) return nein('Der Bauführer hat diese Meldung schon bearbeitet.');
      if (liste('regierapport').some((r) => r.tagesmeldung_id === args.p_id)) return nein('Zu dieser Meldung gibt es schon einen Regierapport.');
      if (liste('foto').some((f) => f.tagesmeldung_id === args.p_id)) return nein('Diese Meldung hat Fotos — sie bleiben als Beleg.');
      if (kopf.audio_pfad) return nein('Diese Meldung hat eine Sprachnotiz — sie bleibt als Beleg.');
      tabellen.zeiteintrag = liste('zeiteintrag').filter((z) => z.tagesmeldung_id !== args.p_id);
      tabellen.tagesmeldung = liste('tagesmeldung').filter((z) => z.id !== args.p_id);
      return { data: 'entfernt', error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, aufrufe, tabellen };
}

function meldung(n: number): MeldungPayload {
  const id = `m-${n}`;
  return {
    id, team_id: 't1', datum: '2026-10-13', baustelle_id: 'b1', normalfall: true, abweichung_typ: null, wer_hats_gewollt: null,
    audio_sekunden: 9, erfasst_von: 'u1', transkript: 'Material kam spät',
    eintraege: [{ id: `${id}-z1`, mitarbeiter_id: 'p1', normal_min: 504, ueber_min: 0, oev: false, km: 0, baustelle_id: 'b1', konto_nr: '903673' }],
  };
}

/** Eine Meldung, die schon auf dem Server steht. */
function aufServer(): Record<string, Zeile[]> {
  return {
    tagesmeldung: [{ id: 's-1', client_uuid: 'c-s1', audio_pfad: null }],
    zeiteintrag: [{ id: 's-1-z1', tagesmeldung_id: 's-1', status: 'offen', mitarbeiter_id: 'p1', normal_min: 504 }],
    freigabe_log: [], foto: [], regierapport: [],
  };
}

beforeEach(async () => {
  await lokaleWarteschlangeLeeren();
  zugangVergessen();
});

describe('ersetzbarGrund — warum ersetzen nicht geht, in einfachen Worten', () => {
  const frei = { gefunden: true, zeilen: [{ status: 'offen' }], korrigiert: 0, fotos: 0, regie: 0, audio: false };
  it('alles offen, nichts dran: darf ersetzt werden', () => expect(ersetzbarGrund(frei)).toBeNull());
  it('nicht (mehr) auf dem Server: darf', () => expect(ersetzbarGrund({ ...frei, gefunden: false, korrigiert: 3 })).toBeNull());
  it('freigegeben', () => expect(ersetzbarGrund({ ...frei, zeilen: [{ status: 'freigegeben' }] })).toContain('freigegeben'));
  it('korrigiert (freigabe_log)', () => expect(ersetzbarGrund({ ...frei, korrigiert: 1 })).toBe('Der Bauführer hat diese Meldung schon bearbeitet.'));
  it('Fotos', () => expect(ersetzbarGrund({ ...frei, fotos: 2 })).toBe('Diese Meldung hat Fotos — sie bleiben als Beleg.'));
  it('Sprachnotiz', () => expect(ersetzbarGrund({ ...frei, audio: true })).toContain('Sprachnotiz'));
  it('Regierapport', () => expect(ersetzbarGrund({ ...frei, regie: 1 })).toContain('Regierapport'));
});

describe('ersetzen — Server', () => {
  it('Bauführer hat korrigiert: wird nicht angeboten und nicht gelöscht', async () => {
    const t = aufServer();
    t.freigabe_log.push({ id: 'l1', zeiteintrag_id: 's-1-z1' });
    const { client, tabellen } = speicherClient(t);
    const alte = [{ lokal: false, schluessel: 's-1', bezeichnung: 'Aarstrasse' }];
    expect((await ersetzenPruefen(client, alte))[0].grund).toBe('Der Bauführer hat diese Meldung schon bearbeitet.');
    const r = await ersetzen(client, alte);
    expect(r.ok).toBe(false);
    expect(tabellen.zeiteintrag).toHaveLength(1);
    expect(tabellen.tagesmeldung).toHaveLength(1);
  });

  it('ersetzbar: Zeilen und Kopf weg', async () => {
    const { client, tabellen } = speicherClient(aufServer());
    const r = await ersetzen(client, [{ lokal: false, schluessel: 's-1', bezeichnung: 'Aarstrasse' }]);
    expect(r.ok).toBe(true);
    expect(tabellen.zeiteintrag).toHaveLength(0);
    expect(tabellen.tagesmeldung).toHaveLength(0);
  });

  it('Löschen scheitert: Grund zurück, und die neue Meldung darf nicht angelegt werden', async () => {
    const { client, tabellen } = speicherClient(aufServer(), { loeschFehler: (t) => (t === 'tagesmeldung' ? { code: '23503', message: 'violates foreign key constraint "foto_tagesmeldung_id_fkey"' } : null) });
    const r = await ersetzen(client, [{ lokal: false, schluessel: 's-1', bezeichnung: 'Aarstrasse' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContain('nicht gespeichert');
    expect(tabellen.tagesmeldung).toHaveLength(1);
  });

  it('ohne Verbindung lässt sich eine gesendete Meldung nicht ersetzen', async () => {
    expect((await ersetzenPruefen(null, [{ lokal: false, schluessel: 's-1', bezeichnung: 'A' }]))[0].grund).toContain('keine Verbindung');
  });
});

describe('ersetzen — Meldung auf dem Gerät', () => {
  it('nie gesendet: wird «ersetzt», nicht gelöscht; Sprachnotiz geht als Kopie mit der neuen Meldung', async () => {
    const cu = await enqueueMeldung(meldung(1), new Blob(['ton'], { type: 'audio/webm' }), [new Blob(['bild'], { type: 'image/jpeg' })]);
    const r = await ersetzen(null, [{ lokal: true, schluessel: cu, bezeichnung: 'Aarstrasse' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.uebernahme.audio?.sekunden).toBe(9);
      expect(r.uebernahme.audio?.transkript).toBe('Material kam spät');
      expect(r.uebernahme.fotos).toHaveLength(1);
    }
    expect((await db.meldungen.get(cu))?.status).toBe('ersetzt');
    expect(await db.audio.get(cu)).toBeDefined();                        // Beleg bleibt auf dem Gerät
    expect(await db.fotos.where('client_uuid').equals(cu).count()).toBe(1);
  });

  it('wird gerade gesendet: Ersetzen wartet, das Senden hört auf, nichts zählt doppelt', async () => {
    const cu = await enqueueMeldung(meldung(1));
    let los: () => void = () => undefined;
    const bremse = new Promise<void>((r) => { los = r; });
    const { client, tabellen } = speicherClient({ freigabe_log: [], foto: [], regierapport: [] }, {
      warten: (t, op) => (t === 'zeiteintrag' && op === 'upsert' ? bremse : Promise.resolve()),
    });
    const senden = flushNachSupabase(client);
    await new Promise((r) => setTimeout(r, 5));                          // Kopf ist drin, Zeilen hängen im Netz
    const ersetzt = ersetzen(client, [{ lokal: true, schluessel: cu, bezeichnung: 'Aarstrasse' }]);
    await new Promise((r) => setTimeout(r, 5));
    expect((await db.meldungen.get(cu))?.zurueckgezogen).toBeTruthy();   // das Senden soll aufhören
    los();
    expect(await senden).toMatchObject({ gesendet: 0 });                  // nicht als gesendet markiert
    const r = await ersetzt;
    expect(r.ok).toBe(true);
    // Was schon beim Server war, ist wieder weg — die neue Meldung kann ohne Dublette hinaus
    expect(tabellen.tagesmeldung).toHaveLength(0);
    expect(tabellen.zeiteintrag).toHaveLength(0);
    expect((await db.meldungen.get(cu))?.status).toBe('ersetzt');
  });

  it('war schon mit Sprachnotiz beim Server: wird nicht ersetzt, sendet normal weiter', async () => {
    const cu = await enqueueMeldung(meldung(1), new Blob(['ton'], { type: 'audio/webm' }));
    const { client } = speicherClient({ freigabe_log: [], foto: [], regierapport: [] });
    await flushNachSupabase(client);
    // gesendet und mit Sprachnotiz verknüpft
    const r = await ersetzen(client, [{ lokal: true, schluessel: cu, bezeichnung: 'Aarstrasse' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContain('Sprachnotiz');
    expect((await db.meldungen.get(cu))?.zurueckgezogen).toBeUndefined();
  });
});
