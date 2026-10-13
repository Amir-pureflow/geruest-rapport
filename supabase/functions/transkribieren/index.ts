// Sprachnotiz → Text. Drei Wege:
//  1) Erkennen beim Erfassen: { audio_base64, mime, team_id, schritt: 'erkennen' } → Text in der
//     SPRACHE DES SPRECHERS zurück, nichts gespeichert. Der Sprecher prüft und korrigiert ihn in
//     seiner eigenen Sprache — Deutsch kann er nicht beurteilen (Entscheid Amir, 04.10.2026).
//     Spricht er Deutsch, kommt der bereinigte Text direkt zurück (kein Prüfschritt nötig).
//  2) Übersetzen nach der Bestätigung: { text, sprache, schritt: 'uebersetzen' } → Schweizer
//     Hochdeutsch aus dem BESTÄTIGTEN Text. So übersetzt die App, was der Sprecher gutgeheissen
//     hat, nicht was die Erkennung zufällig verstanden hat.
//  3) Nachträglich: { tagesmeldung_id | client_uuid, erneut? } → Aufnahme aus dem Bucket
//     «anhaenge», beide Schritte automatisch, Text an die Meldung. Läuft nach dem Upload, wenn
//     die Meldung ohne Text ankam (offline erfasst), oder auf Knopfdruck — dann ohne Bestätigung,
//     der Monteur ist nicht mehr da.
//  Alt: { audio_base64 } ohne `schritt` = Weg 1+2 in einem (Fassungen der App vor dem 04.10.,
//  der PWA-Zwischenspeicher hält sich einen Tag).
//
// Erkennung in der Sprache aus dem Mitarbeiterprofil (Regel #9: nie pro Aufnahme raten).
// `transkript` (deutsch), `transkript_quelle` (bestätigtes Original, nur wenn abweichend),
// `transkript_sprache`. Das Transkript ist Arbeitshilfe, die Aufnahme bleibt der Beleg (Regel #8).
//
// Das Ohr (Erkennung, 04.10.2026): **Azure AI Speech, schnelle Transkription**, sobald
// `AZURE_SPEECH_KEY` in `konfiguration` liegt — sonst Mistral Voxtral wie bisher. Azure kann
// alle Sprachen des Betriebs (Albanisch sq-AL, Arabisch ar-SY, Polnisch, Portugiesisch, Italienisch, Spanisch es-ES, dazu
// Schweizer Hochdeutsch de-CH), Voxtral kann kein Albanisch. Region über `AZURE_SPEECH_REGION`
// (Standard germanywestcentral = Frankfurt — die schnelle Transkription gibt es laut
// Regionen-Tabelle vom 30.09.2026 NICHT in switzerlandnorth; Frankfurt ist die nächste,
// Daten bleiben in der Region der Ressource). Formate: WebM (Android) und AAC/M4A (iPhone)
// nimmt sie direkt, bis 500 MB.
//
// Die Übersetzung macht Mistral (Paris, EU). Schlüssel `MISTRAL_API_KEY` in `konfiguration`.
// Optional: `TRANSKRIPT_MODELL` (Standard voxtral-mini-latest), `UEBERSETZUNG_MODELL`
// (Standard mistral-small-latest), `AZURE_SPEECH_ENDPOINT` (falls die Ressource einen eigenen
// Endpunkt hat, sonst wird er aus der Region gebaut).
// Deploy: verify_jwt true — Aufruf mit der angemeldeten Sitzung der App.
// Seit 13.10.2026 (0041): nur mit aktivem Zugang (Büro oder Chefmonteur) und nur für die eigene Firma — vorher reichte
// der öffentliche anon-Schlüssel, um mit einer fremden Meldungs-Id deren Text zu lesen oder neu erzeugen zu lassen.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { aufrufer, pfadPasst } from '../_shared/zugang.ts';
import { stt } from '../_shared/ohr.ts';
import { SPRACHEN, verdeutschen } from '../_shared/uebersetzung.ts';
import { kontextLaden } from '../_shared/kontext.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function spracheVon(chef: { sprache?: string | null } | null | undefined): string {
  return chef?.sprache && SPRACHEN[chef.sprache] ? chef.sprache : 'de';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const wer = await aufrufer(req);
  if (!wer) return antwort(401, { fehler: 'Nicht angemeldet oder kein aktiver Zugang.' });
  if (wer.rolle !== 'buero' && wer.rolle !== 'chef') return antwort(403, { fehler: 'Sprachnotizen verarbeitet nur das Teamgerät oder das Büro.' });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let meldungId: string | null = null;
  try {
    const body = await req.json();
    const { tagesmeldung_id, client_uuid, erneut, audio_base64, mime, team_id, baustelle_id, schritt, text, sprache: spracheDirekt } = body ?? {};

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries((conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]));
    if (!k.MISTRAL_API_KEY) return antwort(500, { fehler: 'MISTRAL_API_KEY fehlt in konfiguration' });

    // ── Weg 2: Übersetzen nach der Bestätigung — nur Text, nichts gespeichert ──
    if (schritt === 'uebersetzen') {
      if (typeof text !== 'string' || !text.trim()) return antwort(400, { fehler: 'text fehlt' });
      const spr = typeof spracheDirekt === 'string' && SPRACHEN[spracheDirekt] ? spracheDirekt : 'de';
      // Team und Baustelle (seit 13.10.2026 von der Erfassung mitgeschickt): damit Namen richtig geschrieben werden
      const kontext = await kontextLaden(supa, wer.firma, { team_id, baustelle_id });
      const erg = await verdeutschen(k, text.trim().slice(0, 4000), spr, { kontext });
      return antwort(200, { ...erg, vorschau: true });
    }

    // ── Weg 1: Erkennen beim Erfassen — Audio kommt direkt mit, nichts wird gespeichert ──
    if (typeof audio_base64 === 'string' && audio_base64.length > 0) {
      if (audio_base64.length > 12_000_000) return antwort(413, { fehler: 'Aufnahme zu gross für die Vorschau' });
      let sprache = 'de';
      if (team_id) {
        const { data: t } = await supa.from('team').select('firma_id, chefmonteur:chefmonteur_id(sprache)').eq('id', team_id).maybeSingle();
        const team = t as unknown as { firma_id: string; chefmonteur: { sprache: string } | null } | null;
        if (!team || team.firma_id !== wer.firma) return antwort(404, { fehler: 'Team nicht gefunden' });
        sprache = spracheVon(team.chefmonteur);
      }
      const bytes = Uint8Array.from(atob(audio_base64), (c) => c.charCodeAt(0));
      const typ = typeof mime === 'string' && mime ? mime : 'audio/webm';
      const datei = new Blob([bytes], { type: typ });
      const original = await stt(k, datei, `notiz.${typ.includes('mp4') ? 'm4a' : typ.includes('ogg') ? 'ogg' : 'webm'}`, sprache);

      if (schritt === 'erkennen' && sprache !== 'de') {
        // Der Sprecher prüft zuerst sein Original — Deutsch entsteht erst nach der Bestätigung (Weg 2)
        return antwort(200, { original, sprache, vorschau: true });
      }
      // Deutsch gesprochen (kein Prüfschritt nötig) oder alte App-Fassung: beides in einem
      const kontext = await kontextLaden(supa, wer.firma, { team_id, baustelle_id });
      const erg = await verdeutschen(k, original, sprache, { kontext });
      return antwort(200, { ...erg, original, uebersetzt: sprache !== 'de', vorschau: true });
    }

    // ── Weg 3: nachträglich an einer gespeicherten Meldung ──
    if (!tagesmeldung_id && !client_uuid) return antwort(400, { fehler: 'tagesmeldung_id, client_uuid, audio_base64 oder schritt=uebersetzen nötig' });

    let abfrage = supa
      .from('tagesmeldung')
      .select('id, client_uuid, firma_id, team_id, baustelle_id, datum, audio_pfad, transkript, team:team_id(chefmonteur:chefmonteur_id(sprache))');
    abfrage = tagesmeldung_id ? abfrage.eq('id', tagesmeldung_id) : abfrage.eq('client_uuid', client_uuid);
    const { data: m } = await abfrage.maybeSingle();
    // Fremde Firma = gibt es nicht (keine Auskunft, ob die Id existiert)
    if (!m || m.firma_id !== wer.firma) return antwort(404, { fehler: 'Meldung nicht gefunden' });
    if (erneut && wer.rolle !== 'buero') return antwort(403, { fehler: 'Den Text neu erstellen kann nur das Büro.' });
    meldungId = m.id;
    if (!m.audio_pfad) return antwort(400, { fehler: 'Diese Meldung hat keine Sprachnotiz' });
    if (!pfadPasst(m.audio_pfad, `audio/${m.client_uuid}.`)) return antwort(400, { fehler: 'Die Sprachnotiz liegt nicht bei dieser Meldung.' });
    if (m.transkript && !erneut) return antwort(200, { schon: true, transkript: m.transkript });

    const team = m.team as unknown as { chefmonteur: { sprache: string } | null } | null;
    const sprache = spracheVon(team?.chefmonteur);

    const { data: datei, error: dlFehler } = await supa.storage.from('anhaenge').download(m.audio_pfad);
    if (dlFehler || !datei) throw new Error('Aufnahme nicht lesbar: ' + (dlFehler?.message ?? m.audio_pfad));

    const original = await stt(k, datei, m.audio_pfad.split('/').pop() ?? 'notiz.webm', sprache);
    const kontext = await kontextLaden(supa, wer.firma, { team_id: m.team_id, baustelle_id: m.baustelle_id, datum: m.datum });
    const erg = await verdeutschen(k, original, sprache, { kontext });

    const { error: upd } = await supa
      .from('tagesmeldung')
      .update({ transkript: erg.transkript, transkript_quelle: erg.quelle, transkript_sprache: sprache, transkript_fehler: null })
      .eq('id', m.id);
    if (upd) throw new Error('Speichern: ' + upd.message);

    return antwort(200, { transkript: erg.transkript, sprache, uebersetzt: sprache !== 'de' });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (meldungId) await supa.from('tagesmeldung').update({ transkript_fehler: text.slice(0, 500) }).eq('id', meldungId);
    return antwort(502, { fehler: text });
  }
});
