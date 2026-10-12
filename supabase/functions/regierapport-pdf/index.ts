// Regierapport als PDF erzeugen und einen signierten Link zurückgeben (Ansicht in der App, Kundenlink).
// Body: { regierapport_id }. Deploy: verify_jwt true. Nur das Büro, nur die eigene Firma (13.10.2026); der Link im PDF
// zeigt immer auf `APP_URL` aus `konfiguration` — `basis_url` aus der Anfrage wird nicht mehr übernommen.
// Quelle der Wahrheit: supabase/functions/regierapport-pdf/index.ts + ../_shared/rapport_pdf.ts im Repo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { rapportPdfErzeugen } from '../_shared/rapport_pdf.ts';
import { aufrufer } from '../_shared/zugang.ts';

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
    const wer = await aufrufer(req);
    if (!wer) return antwort(401, { fehler: 'Nicht angemeldet oder kein aktiver Zugang.' });
    if (wer.rolle !== 'buero') return antwort(403, { fehler: 'Regierapporte sind Sache des Büros.' });
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: eigen } = await supa.from('regierapport').select('firma_id').eq('id', id).maybeSingle();
    if (!eigen || eigen.firma_id !== wer.firma) return antwort(404, { fehler: 'Regierapport nicht gefunden' });

    let sachbearbeiter: string | null = null;
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const { data: u } = await supa.auth.getUser(jwt);
      sachbearbeiter = (u.user?.user_metadata?.name as string | undefined) ?? null;
    }

    const { pfad, dateiname } = await rapportPdfErzeugen(supa, id, { sachbearbeiter });
    const { data: signiert, error } = await supa.storage.from('anhaenge').createSignedUrl(pfad, 3600, { download: dateiname });
    if (error || !signiert) return antwort(500, { fehler: 'Link konnte nicht erstellt werden: ' + (error?.message ?? '') });
    return antwort(200, { ok: true, url: signiert.signedUrl, pfad, dateiname });
  } catch (e) {
    return antwort(500, { fehler: e instanceof Error ? e.message : String(e) });
  }
});
