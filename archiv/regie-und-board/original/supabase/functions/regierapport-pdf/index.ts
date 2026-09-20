// Regierapport als PDF erzeugen und einen signierten Link zurückgeben (Ansicht in der App, Kundenlink).
// Body: { regierapport_id, basis_url? }. Deploy: verify_jwt true.
// Quelle der Wahrheit: supabase/functions/regierapport-pdf/index.ts + ../_shared/rapport_pdf.ts im Repo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { rapportPdfErzeugen } from '../_shared/rapport_pdf.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const id: string | undefined = body?.regierapport_id;
    if (!id) return antwort(400, { fehler: 'regierapport_id nötig' });
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let sachbearbeiter: string | null = null;
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const { data: u } = await supa.auth.getUser(jwt);
      sachbearbeiter = (u.user?.user_metadata?.name as string | undefined) ?? null;
    }

    const { pfad, dateiname } = await rapportPdfErzeugen(supa, id, { basisUrl: body?.basis_url, sachbearbeiter });
    const { data: signiert, error } = await supa.storage.from('anhaenge').createSignedUrl(pfad, 3600, { download: dateiname });
    if (error || !signiert) return antwort(500, { fehler: 'Link konnte nicht erstellt werden: ' + (error?.message ?? '') });
    return antwort(200, { ok: true, url: signiert.signedUrl, pfad, dateiname });
  } catch (e) {
    return antwort(500, { fehler: e instanceof Error ? e.message : String(e) });
  }
});
