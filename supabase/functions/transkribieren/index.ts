// Sprachnotiz → Text. Läuft nach dem Upload der Aufnahme (db.ts) oder auf Knopfdruck (Wochenübersicht, Regierapport).
//
// Ablauf: Aufnahme aus dem Bucket «anhaenge» holen → Mistral Voxtral transkribiert in der Sprache des
// Chefmonteurs (aus dem Mitarbeiterprofil, Regel #9: nie raten) → wenn nicht Deutsch, übersetzt ein
// Sprachmodell ins Schweizer Hochdeutsch → `transkript` (deutsch), `transkript_quelle` (Original),
// `transkript_sprache` (Code). Das Transkript ist Arbeitshilfe, die Aufnahme bleibt der Beleg (Regel #8).
//
// Anbieter Mistral (Paris, EU-Verarbeitung). Schlüssel `MISTRAL_API_KEY` in `konfiguration`.
// Optional: `TRANSKRIPT_MODELL` (Standard voxtral-mini-latest), `UEBERSETZUNG_MODELL` (Standard mistral-small-latest).
// Deploy: verify_jwt true — Aufruf mit der (anonymen) Sitzung der App.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const SPRACHEN: Record<string, string> = { de: 'Deutsch', ar: 'Arabisch', pl: 'Polnisch', en: 'Englisch' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let meldungId: string | null = null;
  try {
    const { tagesmeldung_id, client_uuid, erneut } = await req.json();
    if (!tagesmeldung_id && !client_uuid) return antwort(400, { fehler: 'tagesmeldung_id oder client_uuid nötig' });

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries((conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]));
    if (!k.MISTRAL_API_KEY) return antwort(500, { fehler: 'MISTRAL_API_KEY fehlt in konfiguration' });
    const modell = k.TRANSKRIPT_MODELL || 'voxtral-mini-latest';
    const uebersetzer = k.UEBERSETZUNG_MODELL || 'mistral-small-latest';

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
    const sprache = team?.chefmonteur?.sprache && SPRACHEN[team.chefmonteur.sprache] ? team.chefmonteur.sprache : 'de';

    const { data: datei, error: dlFehler } = await supa.storage.from('anhaenge').download(m.audio_pfad);
    if (dlFehler || !datei) throw new Error('Aufnahme nicht lesbar: ' + (dlFehler?.message ?? m.audio_pfad));

    // 1) Erkennung in der Sprache des Sprechers
    const form = new FormData();
    form.append('file', datei, m.audio_pfad.split('/').pop() ?? 'notiz.webm');
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

    // 2) Übersetzung ins Deutsche, nur wenn nötig — Zahlen und Zeiten bleiben, wie sie sind
    let deutsch = original;
    if (sprache !== 'de') {
      const ue = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: uebersetzer,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'Du übersetzt kurze Sprachnotizen von einer Gerüstbau-Baustelle ins Deutsche (Schweizer Hochdeutsch, «ss» statt «ß»). ' +
                'Gib nur die Übersetzung aus, keine Erklärung, keine Anführungszeichen. Zahlen, Uhrzeiten, Stunden und Namen unverändert lassen. ' +
                'Unverständliches mit […] markieren, nichts dazu erfinden.',
            },
            { role: 'user', content: `Sprache: ${SPRACHEN[sprache]}\n\n${original}` },
          ],
        }),
      });
      if (!ue.ok) throw new Error(`Übersetzung ${ue.status}: ${(await ue.text()).slice(0, 300)}`);
      const j = (await ue.json()) as { choices?: { message?: { content?: string } }[] };
      deutsch = (j.choices?.[0]?.message?.content ?? '').trim() || original;
    }

    const { error: upd } = await supa
      .from('tagesmeldung')
      .update({ transkript: deutsch, transkript_quelle: sprache === 'de' ? null : original, transkript_sprache: sprache, transkript_fehler: null })
      .eq('id', m.id);
    if (upd) throw new Error('Speichern: ' + upd.message);

    return antwort(200, { transkript: deutsch, sprache, uebersetzt: sprache !== 'de' });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (meldungId) await supa.from('tagesmeldung').update({ transkript_fehler: text.slice(0, 500) }).eq('id', meldungId);
    return antwort(502, { fehler: text });
  }
});
