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
// Anbieter Mistral (Paris, EU-Verarbeitung). Schlüssel `MISTRAL_API_KEY` in `konfiguration`.
// Optional: `TRANSKRIPT_MODELL` (Standard voxtral-mini-latest), `UEBERSETZUNG_MODELL`
// (Standard mistral-small-latest). Grenze von Voxtral: Albanisch kann es nicht, Arabisch und
// Polnisch nur schwach — der geplante Wechsel des Ohrs auf Azure AI Speech (Region Schweiz Nord)
// betrifft NUR die Funktion `stt()` unten, der Rest bleibt.
// Deploy: verify_jwt true — Aufruf mit der angemeldeten Sitzung der App.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const SPRACHEN: Record<string, string> = { de: 'Deutsch', sq: 'Albanisch', pt: 'Portugiesisch', ar: 'Arabisch', pl: 'Polnisch', en: 'Englisch' };

const ANWEISUNG =
  'Du bereinigst gesprochene Notizen von einer Gerüstbau-Baustelle zu klarem Schweizer Hochdeutsch («ss» statt «ß»). ' +
  'Regeln: Grammatik und Wortstellung korrigieren. Füllwörter, Wiederholungen und Versprecher entfernen. ' +
  'Selbstkorrekturen auflösen: es gilt die zuletzt genannte Fassung (z. B. «der Chefmonteur … ah, der Bauführer meine ich» → Bauführer). ' +
  'Zahlen, Uhrzeiten, Stunden, Namen, Baustellen und Mengenangaben wörtlich übernehmen — «ein Feld mehr» bleibt «ein Feld mehr», nicht umdeuten. ' +
  'Fachbegriffe des Gerüstbaus beibehalten (Feld, Lage, Treppenturm, Konsole, versetzen). ' +
  'Nichts hinzufügen, nichts Wichtiges weglassen, nichts bewerten. Bei Unklarheit die Worte des Sprechers lassen. ' +
  'Kurz und sachlich, wie ein Eintrag im Rapport. Nur den bereinigten Text ausgeben, ohne Anführungszeichen, ohne Erklärung. ' +
  'Ist die Notiz nicht auf Deutsch, zuerst sinngemäss übersetzen, dann bereinigen.';

/** Schritt 1 — das Ohr: Aufnahme → Text in der Sprache des Sprechers (roh, so wie gesprochen). */
async function stt(k: Record<string, string>, datei: Blob, dateiname: string, sprache: string): Promise<string> {
  const modell = k.TRANSKRIPT_MODELL || 'voxtral-mini-latest';
  const form = new FormData();
  form.append('file', datei, dateiname);
  form.append('model', modell);
  form.append('language', sprache);
  const erk = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}` },
    body: form,
  });
  if (!erk.ok) throw new Error(`Erkennung ${erk.status}: ${(await erk.text()).slice(0, 300)}`);
  const erkannt = (await erk.json()) as { text?: string };
  const original = (erkannt.text ?? '').trim();
  if (!original) throw new Error('Erkennung lieferte keinen Text');
  return original;
}

/** Schritt 2 — die Übertragung: (bestätigter) Text → bereinigtes Schweizer Hochdeutsch. */
async function verdeutschen(k: Record<string, string>, text: string, sprache: string) {
  const uebersetzer = k.UEBERSETZUNG_MODELL || 'mistral-small-latest';
  const ue = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: uebersetzer,
      temperature: 0,
      messages: [
        { role: 'system', content: ANWEISUNG },
        { role: 'user', content: `Sprache des Sprechers: ${SPRACHEN[sprache] ?? 'Deutsch'}\n\n${text}` },
      ],
    }),
  });
  if (!ue.ok) throw new Error(`Übersetzung ${ue.status}: ${(await ue.text()).slice(0, 300)}`);
  const j = (await ue.json()) as { choices?: { message?: { content?: string } }[] };
  const deutsch = (j.choices?.[0]?.message?.content ?? '').trim() || text;
  return { transkript: deutsch, quelle: deutsch === text ? null : text, sprache };
}

function spracheVon(chef: { sprache?: string | null } | null | undefined): string {
  return chef?.sprache && SPRACHEN[chef.sprache] ? chef.sprache : 'de';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let meldungId: string | null = null;
  try {
    const body = await req.json();
    const { tagesmeldung_id, client_uuid, erneut, audio_base64, mime, team_id, schritt, text, sprache: spracheDirekt } = body ?? {};

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries((conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]));
    if (!k.MISTRAL_API_KEY) return antwort(500, { fehler: 'MISTRAL_API_KEY fehlt in konfiguration' });

    // ── Weg 2: Übersetzen nach der Bestätigung — nur Text, nichts gespeichert ──
    if (schritt === 'uebersetzen') {
      if (typeof text !== 'string' || !text.trim()) return antwort(400, { fehler: 'text fehlt' });
      const spr = typeof spracheDirekt === 'string' && SPRACHEN[spracheDirekt] ? spracheDirekt : 'de';
      const erg = await verdeutschen(k, text.trim().slice(0, 4000), spr);
      return antwort(200, { ...erg, vorschau: true });
    }

    // ── Weg 1: Erkennen beim Erfassen — Audio kommt direkt mit, nichts wird gespeichert ──
    if (typeof audio_base64 === 'string' && audio_base64.length > 0) {
      if (audio_base64.length > 12_000_000) return antwort(413, { fehler: 'Aufnahme zu gross für die Vorschau' });
      let sprache = 'de';
      if (team_id) {
        const { data: t } = await supa.from('team').select('chefmonteur:chefmonteur_id(sprache)').eq('id', team_id).maybeSingle();
        sprache = spracheVon((t as unknown as { chefmonteur: { sprache: string } | null } | null)?.chefmonteur);
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
      const erg = await verdeutschen(k, original, sprache);
      return antwort(200, { ...erg, original, uebersetzt: sprache !== 'de', vorschau: true });
    }

    // ── Weg 3: nachträglich an einer gespeicherten Meldung ──
    if (!tagesmeldung_id && !client_uuid) return antwort(400, { fehler: 'tagesmeldung_id, client_uuid, audio_base64 oder schritt=uebersetzen nötig' });

    let abfrage = supa
      .from('tagesmeldung')
      .select('id, audio_pfad, transkript, team:team_id(chefmonteur:chefmonteur_id(sprache))');
    abfrage = tagesmeldung_id ? abfrage.eq('id', tagesmeldung_id) : abfrage.eq('client_uuid', client_uuid);
    const { data: m } = await abfrage.single();
    if (!m) return antwort(404, { fehler: 'Meldung nicht gefunden' });
    meldungId = m.id;
    if (!m.audio_pfad) return antwort(400, { fehler: 'Diese Meldung hat keine Sprachnotiz' });
    if (m.transkript && !erneut) return antwort(200, { schon: true, transkript: m.transkript });

    const team = m.team as unknown as { chefmonteur: { sprache: string } | null } | null;
    const sprache = spracheVon(team?.chefmonteur);

    const { data: datei, error: dlFehler } = await supa.storage.from('anhaenge').download(m.audio_pfad);
    if (dlFehler || !datei) throw new Error('Aufnahme nicht lesbar: ' + (dlFehler?.message ?? m.audio_pfad));

    const original = await stt(k, datei, m.audio_pfad.split('/').pop() ?? 'notiz.webm', sprache);
    const erg = await verdeutschen(k, original, sprache);

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
