// Kundenlink — bewusst OHNE JWT (verify_jwt false): Die Bauleitung hat kein Konto.
// Auth läuft über den unerratbaren link_token (UUID, unique auf regierapport).
// GET  ?token=…        → Rapport, Positionen, Fotos (signierte Links, 1 h) + protokolliert 'link_geklickt'
// POST {token, aktion} → 'bestaetigt' | 'rueckfrage' + Protokoll
//
// Quelle der Wahrheit ist DIESE Datei im Repo. Deploy: Supabase-MCP `deploy_edge_function`
// (verify_jwt: false!) oder `supabase functions deploy bestaetigung --no-verify-jwt`.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  try {
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return antwort(400, { fehler: 'token fehlt' });
      const { data: r } = await supa
        .from('regierapport')
        .select('id, nummer, status, betrag_rappen, versendet_am, frist_bis, empfaenger_email, tagesmeldung_id, beschrieb, pdf_pfad, baustelle:baustelle_id(bezeichnung, konto_nr), tagesmeldung:tagesmeldung_id(datum)')
        .eq('link_token', token)
        .single();
      if (!r) return antwort(404, { fehler: 'Dieser Link ist ungültig.' });
      await supa.from('zustellung_log').insert({
        regierapport_id: r.id,
        an: r.empfaenger_email ?? 'kunde',
        ereignis: 'link_geklickt',
      });

      // Positionen — der Kunde soll sehen, wofür er zeichnet
      const { data: pos } = await supa
        .from('regie_position')
        .select('bezeichnung, betrag_rappen, tarif_code')
        .eq('regierapport_id', r.id)
        .order('tarif_code');

      // Fotos: von der Team-Meldung und nachgereichte am Rapport — signierte Links, 1 Stunde
      const { data: fotos } = await supa
        .from('foto')
        .select('pfad, erstellt_am')
        .or(`regierapport_id.eq.${r.id}${r.tagesmeldung_id ? `,tagesmeldung_id.eq.${r.tagesmeldung_id}` : ''}`)
        .order('erstellt_am');
      let fotoUrls: string[] = [];
      if (fotos && fotos.length > 0) {
        const { data: signiert } = await supa.storage
          .from('anhaenge')
          .createSignedUrls(fotos.map((f: { pfad: string }) => f.pfad), 3600);
        fotoUrls = (signiert ?? []).map((s: { signedUrl: string | null }) => s.signedUrl).filter((u: string | null): u is string => !!u);
      }

      const bs = r.baustelle as unknown as { bezeichnung: string | null; konto_nr: string } | null;
      const tm = r.tagesmeldung as unknown as { datum: string } | null;
      // PDF wie der SORBA-Ausdruck — zum Herunterladen und Ausdrucken, 1 Stunde gültig
      const pdfPfad = (r as { pdf_pfad?: string | null }).pdf_pfad ?? null;
      let pdfUrl: string | null = null;
      if (pdfPfad) {
        const { data: s } = await supa.storage.from('anhaenge').createSignedUrl(pdfPfad, 3600, { download: `${(r as { nummer?: string | null }).nummer ?? 'Regierapport'}.pdf` });
        pdfUrl = s?.signedUrl ?? null;
      }
      return antwort(200, {
        nummer: (r as { nummer?: string | null }).nummer ?? null,
        pdf_url: pdfUrl,
        status: r.status,
        betrag_rappen: r.betrag_rappen,
        versendet_am: r.versendet_am,
        frist_bis: r.frist_bis,
        bezeichnung: bs?.bezeichnung ?? null,
        konto_nr: bs?.konto_nr ?? null,
        datum: tm?.datum ?? null,
        beschrieb: (r as { beschrieb?: string | null }).beschrieb ?? null,
        positionen: (pos ?? []).map((p: { bezeichnung: string; betrag_rappen: number }) => ({ bezeichnung: p.bezeichnung, betrag_rappen: p.betrag_rappen })),
        fotos: fotoUrls,
      });
    }

    if (req.method === 'POST') {
      const { token, aktion, kommentar } = await req.json();
      if (!token || !['bestaetigt', 'rueckfrage'].includes(aktion)) {
        return antwort(400, { fehler: 'token und aktion (bestaetigt|rueckfrage) nötig' });
      }
      const { data: r } = await supa
        .from('regierapport')
        .select('id, status, empfaenger_email')
        .eq('link_token', token)
        .single();
      if (!r) return antwort(404, { fehler: 'Dieser Link ist ungültig.' });
      if (r.status === 'bestaetigt') return antwort(200, { status: 'bestaetigt' }); // idempotent

      const update =
        aktion === 'bestaetigt'
          ? { status: 'bestaetigt', bestaetigt_am: new Date().toISOString() }
          : { status: 'rueckfrage' };
      await supa.from('regierapport').update(update).eq('id', r.id);
      await supa.from('zustellung_log').insert({
        regierapport_id: r.id,
        an: r.empfaenger_email ?? 'kunde',
        ereignis: aktion,
        detail: kommentar ? { kommentar } : null,
      });
      return antwort(200, { status: update.status });
    }

    return antwort(405, { fehler: 'Methode nicht erlaubt' });
  } catch (e) {
    return antwort(500, { fehler: String(e) });
  }
});
