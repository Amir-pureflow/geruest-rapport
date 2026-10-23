/**
 * «Frühere ersetzen» im Teamgerät (13.10.2026, vor dem Start bei der Gerüst GmbH).
 *
 * Hat ein Team an einem Tag schon gemeldet, fragt die Erfassung: ersetzen oder zusätzlich? Bis jetzt löschte «ersetzen»
 * die alten Zeilen und den alten Kopf auf dem Server, ohne die Antwort anzusehen — und legte die neue Meldung trotzdem
 * an. Scheiterte das Löschen (der Bauführer hatte schon korrigiert, es hingen Fotos daran, ein Regierapport zeigte auf
 * die Meldung), standen die Stunden danach doppelt da.
 *
 * Jetzt:
 *   1. Vor dem Angebot prüfen, ob jede frühere Meldung noch ersetzt werden darf (`ersetzenPruefen`). Wenn nicht, sagt
 *      der Dialog warum, und es gibt nur «Zusätzlich» oder «Abbrechen».
 *   2. Beim Ersetzen alles unter der Sperre der Warteschlange (db.ts `exklusiv`): kein Senden dazwischen. Nochmals
 *      prüfen, dann jede Antwort des Servers ansehen — beim ersten Fehler aufhören, und die neue Meldung wird NICHT
 *      angelegt.
 *   3. Meldungen, die nur auf dem Gerät liegen, werden nicht gelöscht, sondern «ersetzt»: Sprachnotiz und Fotos bleiben
 *      liegen (CLAUDE.md #8) und gehen als Kopie mit der neuen Meldung hinaus (`Uebernahme`).
 *
 * Eine Meldung mit Sprachnotiz oder Fotos auf dem Server wird nie ersetzt: ohne ihren Kopf fände niemand mehr den Beleg.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { belegeLesen, db, exklusiv, warteschlangeGeaendert, type MeldungPayload } from './db';
import { rpcFehlt } from './regie';

/** Eine frühere Meldung des Tages, wie die Erfassung sie kennt. */
export interface AlteMeldung {
  /** true = liegt (noch) in der Warteschlange dieses Geräts */
  lokal: boolean;
  /** client_uuid (lokal) oder tagesmeldung.id (Server) */
  schluessel: string;
  /** Für den Satz am Bildschirm, z. B. «Aarstrasse 12» */
  bezeichnung: string;
}

/** Was der Server über eine Meldung weiss. */
export interface Befund {
  gefunden: boolean;
  zeilen: { status: string }[];
  /** Zeilen mit Einträgen im freigabe_log (vom Bauführer korrigiert) */
  korrigiert: number;
  fotos: number;
  regie: number;
  audio: boolean;
}

/** Darf diese Meldung ersetzt werden? null = ja, sonst der Grund in einfachen Worten. */
export function ersetzbarGrund(b: Befund): string | null {
  if (!b.gefunden) return null;
  if (b.zeilen.some((z) => z.status !== 'offen')) return 'Der Bauführer hat diese Meldung schon freigegeben.';
  if (b.korrigiert > 0) return 'Der Bauführer hat diese Meldung schon bearbeitet.';
  if (b.regie > 0) return 'Zu dieser Meldung gibt es schon einen Regierapport.';
  if (b.fotos > 0) return 'Diese Meldung hat Fotos — sie bleiben als Beleg.';
  if (b.audio) return 'Diese Meldung hat eine Sprachnotiz — sie bleibt als Beleg.';
  return null;
}

const OHNE_VERBINDUNG = 'Gerade keine Verbindung zum Server — ob die Meldung schon beim Bauführer ist, lässt sich jetzt nicht prüfen.';

/**
 * Regierapporte zu einer Meldung zählen. Seit 0048 liest nur das Büro Regierapporte (Beträge); der Chefmonteur bekommt
 * über `meldung_regierapporte()` nur die Zahl. Fehlt die Migration, wie bisher direkt zählen.
 */
async function regieZaehlen(client: SupabaseClient, id: string): Promise<{ count: number | null; error: unknown }> {
  const r = await client.rpc('meldung_regierapporte', { p_meldung: id });
  if (!r.error) return { count: (r.data as number | null) ?? 0, error: null };
  if (!rpcFehlt(r.error)) return { count: null, error: r.error };
  const q = await client.from('regierapport').select('id', { count: 'exact', head: true }).eq('tagesmeldung_id', id);
  return { count: q.count, error: q.error };
}

/** Den Befund beim Server holen. null = keine Antwort (Verbindung, Fehler) — dann lieber nicht ersetzen. */
async function befundLaden(client: SupabaseClient, id: string): Promise<Befund | null> {
  const [k, z] = await Promise.all([
    client.from('tagesmeldung').select('id,audio_pfad').eq('id', id).maybeSingle(),
    client.from('zeiteintrag').select('id,status').eq('tagesmeldung_id', id),
  ]);
  if (k.error || z.error) return null;
  if (!k.data) return { gefunden: false, zeilen: [], korrigiert: 0, fotos: 0, regie: 0, audio: false };
  const zeilen = (z.data ?? []) as { id: string; status: string }[];
  const [fl, fo, rr] = await Promise.all([
    zeilen.length > 0
      ? client.from('freigabe_log').select('id', { count: 'exact', head: true }).in('zeiteintrag_id', zeilen.map((x) => x.id))
      : Promise.resolve({ count: 0, error: null }),
    client.from('foto').select('id', { count: 'exact', head: true }).eq('tagesmeldung_id', id),
    regieZaehlen(client, id),
  ]);
  if (fl.error || fo.error || rr.error) return null;
  return {
    gefunden: true, zeilen, korrigiert: fl.count ?? 0, fotos: fo.count ?? 0, regie: rr.count ?? 0,
    audio: !!(k.data as { audio_pfad: string | null }).audio_pfad,
  };
}

/**
 * Die Kennung auf dem Server, falls eine Meldung aus der Warteschlange schon dort sein KANN. null = sie war nie
 * unterwegs, liegt nur auf dem Gerät.
 */
async function serverIdVonLokal(clientUuid: string): Promise<string | null | 'weg'> {
  const e = await db.meldungen.get(clientUuid);
  if (!e) return 'weg';
  const id = (e.payload as unknown as Partial<MeldungPayload>).id;
  if (typeof id !== 'string') return null;
  return e.status === 'gesendet' || e.versucht || e.amServer ? id : null;
}

/** Je frühere Meldung: darf sie ersetzt werden? `grund` null = ja. */
export async function ersetzenPruefen(client: SupabaseClient | null, alte: AlteMeldung[]): Promise<{ schluessel: string; bezeichnung: string; grund: string | null }[]> {
  const out: { schluessel: string; bezeichnung: string; grund: string | null }[] = [];
  for (const a of alte) {
    const id = a.lokal ? await serverIdVonLokal(a.schluessel) : a.schluessel;
    if (id === null || id === 'weg') { out.push({ schluessel: a.schluessel, bezeichnung: a.bezeichnung, grund: null }); continue; }
    if (!client) { out.push({ schluessel: a.schluessel, bezeichnung: a.bezeichnung, grund: OHNE_VERBINDUNG }); continue; }
    const b = await befundLaden(client, id).catch(() => null);
    out.push({ schluessel: a.schluessel, bezeichnung: a.bezeichnung, grund: b ? ersetzbarGrund(b) : OHNE_VERBINDUNG });
  }
  return out;
}

/** Sprachnotiz und Fotos einer ersetzten Meldung, die mit der neuen hinausgehen. */
export interface Uebernahme {
  audio?: { blob: Blob; sekunden: number | null; transkript: string | null; transkript_quelle: string | null; transkript_sprache: string | null };
  fotos: Blob[];
}

/**
 * Zeilen und Kopf einer Meldung auf dem Server entfernen. null = geklappt (oder sie war nie dort), sonst der Grund.
 * Prüfen und Löschen in einer Transaktion (`tagesmeldung_entfernen`, Migration 0043): gibt der Bauführer genau in dem
 * Moment frei, bleibt die Meldung ganz stehen — nie nur halb.
 */
async function serverEntfernen(client: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await client.rpc('tagesmeldung_entfernen', { p_id: id });
  return error ? error.message : null;
}

/**
 * Frühere Meldungen ersetzen. Erst wenn das hier `ok` meldet, legt die Erfassung die neue Meldung an.
 * Bei einem Fehler: nichts mehr anfassen, den Grund zeigen — die Warteschlange läuft für die alten Meldungen normal weiter.
 */
export async function ersetzen(client: SupabaseClient | null, alte: AlteMeldung[]): Promise<{ ok: true; uebernahme: Uebernahme } | { ok: false; fehler: string }> {
  const lokale = alte.filter((a) => a.lokal).map((a) => a.schluessel);
  // Ein laufendes Senden soll beim nächsten Schritt aufhören, statt die alte Meldung noch fertig hinauszuschicken
  const seit = Date.now();
  for (const u of lokale) await db.meldungen.update(u, { zurueckgezogen: seit });
  const freigeben = async () => { for (const u of lokale) await db.meldungen.update(u, { zurueckgezogen: undefined }); };
  try {
    return await exklusiv(async () => {
      // Unter der Sperre nochmals prüfen: seit dem Dialog kann gesendet, freigegeben oder korrigiert worden sein
      const pruefung = await ersetzenPruefen(client, alte);
      const nein = pruefung.find((p) => p.grund);
      if (nein) { await freigeben(); return { ok: false as const, fehler: `Ersetzen geht nicht — «${nein.bezeichnung}»: ${nein.grund}` }; }

      // Auf dem Server entfernen, was dort ist oder sein kann — jede Antwort prüfen, beim ersten Fehler aufhören
      const entfernt: string[] = [];
      for (const a of alte) {
        const id = a.lokal ? await serverIdVonLokal(a.schluessel) : a.schluessel;
        if (id === null || id === 'weg') continue;
        if (!client) { await freigeben(); return { ok: false as const, fehler: OHNE_VERBINDUNG }; }
        const f = await serverEntfernen(client, id).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
        if (f) {
          await freigeben();
          const schon = entfernt.length > 0 ? ` Schon entfernt: ${entfernt.join(', ')} — bitte nochmals «Tag melden».` : '';
          return { ok: false as const, fehler: `«${a.bezeichnung}» liess sich nicht ersetzen: ${f} Die neue Meldung ist nicht gespeichert.${schon}` };
        }
        entfernt.push(a.bezeichnung);
      }

      // Auf dem Gerät: «ersetzt», nicht gelöscht. Sprachnotiz und Fotos, die noch nicht hinaus sind, gehen mit der neuen.
      const uebernahme: Uebernahme = { fotos: [] };
      for (const u of lokale) {
        const e = await db.meldungen.get(u);
        if (!e || e.status === 'ersetzt' || e.status === 'beiseite') continue;
        const belege = await belegeLesen(u);
        const p = e.payload as unknown as Partial<MeldungPayload>;
        if (belege.audio && !uebernahme.audio) {
          uebernahme.audio = {
            blob: belege.audio, sekunden: p.audio_sekunden ?? null,
            transkript: p.transkript ?? null, transkript_quelle: p.transkript_quelle ?? null, transkript_sprache: p.transkript_sprache ?? null,
          };
        }
        uebernahme.fotos.push(...belege.fotos);
        await db.meldungen.update(u, { status: 'ersetzt', zurueckgezogen: undefined, rev: (e.rev ?? 0) + 1 });
      }
      return { ok: true as const, uebernahme };
    });
  } catch (e) {
    await freigeben().catch(() => undefined);
    return { ok: false, fehler: 'Ersetzen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) + ' Die neue Meldung ist nicht gespeichert.' };
  } finally {
    warteschlangeGeaendert();
  }
}
