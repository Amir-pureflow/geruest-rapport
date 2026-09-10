// Leistungsbeschrieb vorschlagen: der Text, den der Bauführer heute in SORBA tippt.
// Quellen: Sprachnotiz (Transkript), Abweichung und «wer wollte es» aus der Tagesmeldung,
// die vorgerechneten Positionen, der Zusatzauftrag (Besteller, Tätigkeit) und die Anzahl Fotos.
// Die KI schreibt nur den Text — Zahlen kommen aus der App, entschieden wird vom Bauführer,
// der den Vorschlag bearbeitet und speichert (Regel #1: kein Urteil, Regel #8: Beleg bleibt Beleg).
//
// Anbieter Mistral (Paris, EU). Schlüssel `MISTRAL_API_KEY`, optional `BESCHRIEB_MODELL` (Standard mistral-medium-latest —
// «small» liess im Test Umlaute weg)
// in `konfiguration`. Speichert NICHTS — die Antwort ist ein Vorschlag, gespeichert wird in der App.
// Deploy: verify_jwt true. Quelle der Wahrheit: supabase/functions/beschrieb-vorschlagen/index.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'zusätzliche Arbeit', warten: 'Wartezeit', kaputt: 'Reparatur / etwas kaputt' };
const WER: Record<string, string> = { kunde: 'auf Wunsch des Kunden (Bauleitung)', chef: 'auf Anweisung des Chefmonteurs', niemand: 'ohne ausdrücklichen Auftrag' };

/** «Do 3.9.2026» — die KI bekommt das Datum fertig formatiert, sonst schreibt sie ISO. */
function datumText(isoDatum: string): string {
  const d = new Date(isoDatum + 'T12:00:00');
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function chf(rappen: number | null): string {
  return rappen != null ? (rappen / 100).toFixed(2) : '–';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { regierapport_id } = await req.json();
    if (!regierapport_id) return antwort(400, { fehler: 'regierapport_id nötig' });

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries((conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]));
    if (!k.MISTRAL_API_KEY) return antwort(500, { fehler: 'MISTRAL_API_KEY fehlt in konfiguration' });
    const modell = k.BESCHRIEB_MODELL || 'mistral-medium-latest';

    const { data: r } = await supa
      .from('regierapport')
      .select(
        'id, nummer, betrag_rappen, tagesmeldung_id, baustelle:baustelle_id(bezeichnung, konto_nr, kunde:kunde_id(name, ansprechperson)), ' +
          'tagesmeldung:tagesmeldung_id(datum, abweichung_typ, wer_hats_gewollt, transkript, team:team_id(bezeichnung, chefmonteur:chefmonteur_id(name)), zeiteintrag(normal_min, ueber_min, mitarbeiter:mitarbeiter_id(name, funktion))), ' +
          'zusatzauftrag:zusatzauftrag_id(besteller_name, besteller_rolle, taetigkeit, notiz, bestellt_am)',
      )
      .eq('id', regierapport_id)
      .single();
    if (!r) return antwort(404, { fehler: 'Regierapport nicht gefunden' });

    const { data: pos } = await supa.from('regie_position').select('bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen, tarif_code').eq('regierapport_id', r.id).order('tarif_code');
    const { count: fotos } = await supa
      .from('foto')
      .select('id', { count: 'exact', head: true })
      .or(`regierapport_id.eq.${r.id}${r.tagesmeldung_id ? `,tagesmeldung_id.eq.${r.tagesmeldung_id}` : ''}`);

    const bs = r.baustelle as unknown as { bezeichnung: string | null; konto_nr: string; kunde: { name: string | null; ansprechperson: string | null } | null } | null;
    const tm = r.tagesmeldung as unknown as {
      datum: string; abweichung_typ: string | null; wer_hats_gewollt: string | null; transkript: string | null;
      team: { bezeichnung: string; chefmonteur: { name: string } | null } | null;
      zeiteintrag: { normal_min: number; ueber_min: number; mitarbeiter: { name: string; funktion: string } | null }[];
    } | null;
    const za = r.zusatzauftrag as unknown as { besteller_name: string; besteller_rolle: string | null; taetigkeit: string; notiz: string | null; bestellt_am: string } | null;

    const personen = (tm?.zeiteintrag ?? []).map((z) => `${z.mitarbeiter?.name ?? 'Monteur'} (${z.mitarbeiter?.funktion ?? 'monteur'}): ${((z.normal_min + z.ueber_min) / 60).toFixed(1)} h`);
    const positionen = (pos ?? []).map((p: { bezeichnung: string; betrag_rappen: number }) => `${p.bezeichnung} — Fr. ${chf(p.betrag_rappen)}`);

    const fakten = [
      `Baustelle: ${bs?.bezeichnung ?? '–'} (Konto ${bs?.konto_nr ?? '–'})`,
      bs?.kunde?.name ? `Kunde: ${bs.kunde.name}${bs.kunde.ansprechperson ? `, Bauleitung ${bs.kunde.ansprechperson}` : ''}` : null,
      tm ? `Datum der Arbeit: ${datumText(tm.datum)}` : null,
      tm?.team ? `Team: ${tm.team.bezeichnung}${tm.team.chefmonteur ? `, Chefmonteur ${tm.team.chefmonteur.name}` : ''}` : null,
      tm?.abweichung_typ ? `Art laut Team: ${ABWEICHUNG[tm.abweichung_typ] ?? tm.abweichung_typ}` : null,
      // «niemand» kommt nicht in den Kundentext — das klärt der Bauführer, nicht der Rapport
      tm?.wer_hats_gewollt && tm.wer_hats_gewollt !== 'niemand' ? `Veranlasst: ${WER[tm.wer_hats_gewollt] ?? tm.wer_hats_gewollt}` : null,
      za ? `Zusatzauftrag: «${za.taetigkeit}», bestellt von ${za.besteller_name}${za.besteller_rolle ? ` (${za.besteller_rolle})` : ''} am ${za.bestellt_am.slice(0, 10)}${za.notiz ? `, Notiz: ${za.notiz}` : ''}` : null,
      tm?.transkript ? `Sprachnotiz des Chefmonteurs (transkribiert): «${tm.transkript}»` : 'Sprachnotiz: keine',
      personen.length > 0 ? `Eingesetzte Personen und Stunden:\n- ${personen.join('\n- ')}` : null,
      positionen.length > 0 ? `Verrechnete Positionen (SGUV):\n- ${positionen.join('\n- ')}` : null,
      `Total: Fr. ${chf(r.betrag_rappen)}`,
      `Fotos vorhanden: ${fotos ?? 0}`,
    ].filter((z): z is string => !!z);

    const system =
      'Du schreibst den Leistungsbeschrieb für einen Regierapport einer Schweizer Gerüstbaufirma. ' +
      'Der Text kommt in das Rapportprogramm (SORBA) und wird vom Kunden gegengezeichnet. ' +
      'Regeln: Schweizer Hochdeutsch mit korrekten Umlauten (ä, ö, ü), «ss» statt «ß». Sachlich, in der Vergangenheit, 2 bis 4 kurze Sätze, kein Gruss, keine Anrede, keine Überschrift. ' +
      'Nenne: was gemacht wurde, wo (Gebäudeteil, wenn bekannt), warum bzw. für wen (der Grund aus der Sprachnotiz gehört immer hinein, z. B. «weil der Kran des Baumeisters das Feld blockierte» oder «für den Dachdecker»), wer es veranlasst hat (nur wenn angegeben, dann «auf Wunsch der Bauleitung» ohne Firmenname), mit wie vielen Personen und wie lange. ' +
      'Das Datum im Format «3.9.2026», nie als Jahr-Monat-Tag. Personen als Anzahl nennen, nicht mit Namen. ' +
      'Verwende NUR die gelieferten Fakten. Erfinde keine Mengen, Bauteile, Namen oder Zeiten. Ist etwas unklar, lass es weg. ' +
      'Nenne keine Frankenbeträge (die stehen in den Positionen). Gib nur den Text aus.';

    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modell,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Fakten zum Regierapport${r.nummer ? ` ${r.nummer}` : ''}:\n\n${fakten.join('\n')}` },
        ],
      }),
    });
    if (!res.ok) return antwort(502, { fehler: `Mistral ${res.status}: ${(await res.text()).slice(0, 300)}` });
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j.choices?.[0]?.message?.content ?? '').trim().replace(/^["«]|["»]$/g, '');
    if (!text) return antwort(502, { fehler: 'Kein Text erhalten' });

    return antwort(200, { beschrieb: text, quellen: { transkript: !!tm?.transkript, zusatzauftrag: !!za, fotos: fotos ?? 0, positionen: positionen.length } });
  } catch (e) {
    return antwort(500, { fehler: e instanceof Error ? e.message : String(e) });
  }
});
