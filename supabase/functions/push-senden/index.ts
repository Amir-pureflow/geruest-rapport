// Benachrichtigungen verschicken (25.10.2026, Schritt 5 «Plan für morgen», Migration 0052).
//
// Die Datenbank legt die Nachrichten in `push_ausgang` (16:00 «Plan für morgen», Änderungen am Plan) und ruft diese
// Function über pg_net auf. Hier: offene Nachrichten holen (höchstens 6 h alt — ältere sind überholt), für sich
// reservieren (gesendet_am setzen, damit zwei gleichzeitige Aufrufe nichts doppelt schicken), an alle Geräte des Teams
// verschlüsseln und senden. Abgemeldete Geräte (404/410) werden gelöscht, andere Fehler gezählt (ab 5 weg).
//
// Zugang: nur mit dem Geheimnis `PUSH_GEHEIM` aus `konfiguration` im Kopf `x-push-geheim` (die Datenbank schickt es mit).
// Deploy: verify_jwt false — pg_net hat keine Sitzung; ohne Geheimnis antwortet die Function mit 401.
// Schlüssel in `konfiguration`: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (Web Push, RFC 8292), PUSH_GEHEIM, optional VAPID_KONTAKT.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { senden, type Vapid } from '../_shared/webpush.ts';

interface Nachricht { id: string; team_id: string; art: string; tag: string; titel: string; text: string; ziel: string; bezug_id: string | null }
interface Abo { id: string; endpoint: string; p256dh: string; auth: string; fehler: number }

const json = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

/** Vergleich ohne Zeitunterschied je nach Übereinstimmung */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ fehler: 'nur POST' }, 405);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: konf, error: kf } = await supa.from('konfiguration').select('schluessel,wert')
    .in('schluessel', ['PUSH_GEHEIM', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_KONTAKT', 'APP_URL']);
  if (kf) return json({ fehler: 'konfiguration: ' + kf.message }, 500);
  const k = Object.fromEntries(((konf ?? []) as { schluessel: string; wert: string }[]).map((r) => [r.schluessel, r.wert]));
  if (!k.PUSH_GEHEIM || !gleich(req.headers.get('x-push-geheim') ?? '', k.PUSH_GEHEIM)) return json({ fehler: 'kein Zugang' }, 401);
  if (!k.VAPID_PUBLIC_KEY || !k.VAPID_PRIVATE_KEY) return json({ fehler: 'VAPID-Schlüssel fehlen' }, 500);
  const vapid: Vapid = { oeffentlich: k.VAPID_PUBLIC_KEY, privat: k.VAPID_PRIVATE_KEY, kontakt: k.VAPID_KONTAKT || k.APP_URL || 'mailto:info@pureflow-ai.ch' };

  const seit = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: offen, error: of } = await supa.from('push_ausgang').select('id').is('gesendet_am', null).gte('erstellt_am', seit).order('erstellt_am').limit(200);
  if (of) return json({ fehler: 'push_ausgang: ' + of.message }, 500);
  const ids = ((offen ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return json({ gesendet: 0 });
  // Reservieren: nur was noch niemand genommen hat
  const { data: meine, error: rf } = await supa.from('push_ausgang').update({ gesendet_am: new Date().toISOString() })
    .in('id', ids).is('gesendet_am', null).select('id,team_id,art,tag,titel,text,ziel,bezug_id');
  if (rf) return json({ fehler: 'reservieren: ' + rf.message }, 500);

  let zugestellt = 0;
  for (const n of (meine ?? []) as Nachricht[]) {
    const { data: abos } = await supa.from('push_abo').select('id,endpoint,p256dh,auth,fehler').eq('team_id', n.team_id);
    const liste = (abos ?? []) as Abo[];
    // «Plan für morgen» ersetzt die vorige Nachricht desselben Tages auf dem Gerät; Änderungen bleiben einzeln stehen
    const daten = { titel: n.titel, text: n.text, ziel: n.ziel || '/', tag: n.art === 'plan_morgen' ? `plan-${n.team_id}-${n.tag}` : `aenderung-${n.bezug_id ?? n.id}` };
    const ergebnisse = await Promise.all(liste.map(async (a) => {
      try { return { a, e: await senden(a, daten, vapid) }; } catch (err) { return { a, e: { status: 0, weg: false, text: String(err).slice(0, 200) } }; }
    }));
    const ok = ergebnisse.filter((x) => x.e.status >= 200 && x.e.status < 300);
    const weg = ergebnisse.filter((x) => x.e.weg || (!(x.e.status >= 200 && x.e.status < 300) && x.a.fehler + 1 >= 5));
    const fehler = ergebnisse.filter((x) => !(x.e.status >= 200 && x.e.status < 300) && !weg.includes(x));
    if (ok.length) await supa.from('push_abo').update({ zuletzt_am: new Date().toISOString(), fehler: 0 }).in('id', ok.map((x) => x.a.id));
    if (weg.length) await supa.from('push_abo').delete().in('id', weg.map((x) => x.a.id));
    for (const x of fehler) await supa.from('push_abo').update({ fehler: x.a.fehler + 1 }).eq('id', x.a.id);
    zugestellt += ok.length;
    const notiz = `${ok.length}/${liste.length} Geräte` + (fehler.length || weg.length
      ? ' · ' + [...fehler, ...weg].map((x) => `${x.e.status}${x.e.text ? ' ' + x.e.text.slice(0, 60) : ''}`).join('; ')
      : '');
    await supa.from('push_ausgang').update({ ergebnis: notiz.slice(0, 500) }).eq('id', n.id);
  }
  return json({ nachrichten: (meine ?? []).length, zugestellt });
});
