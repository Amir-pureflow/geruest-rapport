// Versendet einen Regierapport per Resend: fester Betreff pro Baustelle,
// Bestätigungslink ohne Login, Eintrag ins zustellung_log, Frist = +3 Tage.
// Aufruf nur mit gültigem Nutzer-JWT (verify_jwt). Schlüssel liegen in `konfiguration`
// (RLS ohne Policies — nur die Service-Role hier drin kann sie lesen).
//
// Quelle der Wahrheit ist DIESE Datei im Repo. Deploy: Supabase-MCP `deploy_edge_function`
// (verify_jwt: true) oder `supabase functions deploy regierapport-senden`.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { regierapport_id, empfaenger_email, basis_url } = await req.json();
    if (!regierapport_id || !empfaenger_email) {
      return antwort(400, { fehler: 'regierapport_id und empfaenger_email nötig' });
    }

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries(
      (conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]),
    );
    if (!k.RESEND_API_KEY) return antwort(500, { fehler: 'RESEND_API_KEY fehlt in konfiguration' });

    const { data: r } = await supa
      .from('regierapport')
      .select('id, status, link_token, betrag_rappen, frist_bis, anhang_pfad, tagesmeldung_id, baustelle:baustelle_id(bezeichnung, konto_nr)')
      .eq('id', regierapport_id)
      .single();
    if (!r) return antwort(404, { fehler: 'Regierapport nicht gefunden' });

    // Fotos zählen (Team-Meldung + nachgereichte) — sie stehen im Kundenlink, nicht als Anhang (Mailgrösse)
    const { count: fotoAnzahl } = await supa
      .from('foto')
      .select('id', { count: 'exact', head: true })
      .or(`regierapport_id.eq.${r.id}${r.tagesmeldung_id ? `,tagesmeldung_id.eq.${r.tagesmeldung_id}` : ''}`);

    const bs = r.baustelle as unknown as { bezeichnung: string | null; konto_nr: string } | null;
    const bez = bs?.bezeichnung ?? 'Baustelle';
    const knr = bs?.konto_nr ?? '';
    const betreff = `Regie ${bez} · ${knr}`; // fester Betreff pro Baustelle → ein Mailverlauf
    const link = `${String(basis_url ?? '').replace(/\/$/, '')}/b/${r.link_token}`;
    const chf = r.betrag_rappen != null ? (r.betrag_rappen / 100).toFixed(2) : null;
    const fotoSatz = fotoAnzahl && fotoAnzahl > 0
      ? `<p>Unter dem Link sehen Sie die Positionen und ${fotoAnzahl === 1 ? 'ein Foto' : `${fotoAnzahl} Fotos`} von der Baustelle.</p>`
      : '<p>Unter dem Link sehen Sie die einzelnen Positionen.</p>';

    const html = `
      <p>Guten Tag</p>
      <p>${r.anhang_pfad ? 'Im Anhang finden Sie' : 'Hiermit erhalten Sie'} den Regierapport für <strong>${bez}</strong>${chf ? ` über Fr. ${chf}` : ''}.</p>
      ${fotoSatz}
      <p>Bitte bestätigen Sie ihn mit einem Klick — ohne Anmeldung:</p>
      <p><a href="${link}" style="display:inline-block;background:#D82816;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Regierapport ansehen &amp; bestätigen</a></p>
      <p style="color:#6C7B81;font-size:13px">Gemäss Vertrag ist der Rapport innert 3 Tagen gegenzuzeichnen.</p>`;

    const mail: Record<string, unknown> = {
      from: k.MAIL_ABSENDER ?? 'onboarding@resend.dev',
      to: [empfaenger_email],
      subject: betreff,
      html,
    };

    if (r.anhang_pfad) {
      const { data: datei } = await supa.storage.from('anhaenge').download(r.anhang_pfad);
      if (datei) {
        const buf = new Uint8Array(await datei.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) {
          bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        mail.attachments = [{ filename: r.anhang_pfad.split('/').pop(), content: btoa(bin) }];
      }
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
    });
    const resJson = await res.json();
    if (!res.ok) return antwort(502, { fehler: 'Resend: ' + (resJson?.message ?? res.status) });

    const jetzt = new Date();
    const frist = r.frist_bis ?? new Date(jetzt.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    await supa
      .from('regierapport')
      .update({ status: 'versendet', versendet_am: jetzt.toISOString(), empfaenger_email, frist_bis: frist })
      .eq('id', r.id);
    await supa.from('zustellung_log').insert({
      regierapport_id: r.id,
      an: empfaenger_email,
      ereignis: 'gesendet',
      detail: { resend_id: resJson.id, betreff, fotos: fotoAnzahl ?? 0 },
    });

    return antwort(200, { ok: true, resend_id: resJson.id });
  } catch (e) {
    return antwort(500, { fehler: String(e) });
  }
});
