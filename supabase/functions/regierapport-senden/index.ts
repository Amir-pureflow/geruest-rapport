// Versendet einen Regierapport per Resend: fester Betreff pro Baustelle,
// Bestätigungslink ohne Login, Eintrag ins zustellung_log, Frist = +3 Tage.
// Aufruf nur mit gültigem JWT (verify_jwt). Schlüssel liegen in `konfiguration`
// (RLS ohne Policies — nur die Service-Role hier drin kann sie lesen).
//
// Zwei Modi (Body-Feld `modus`, Standard 'senden'):
//   senden      { regierapport_id, empfaenger_email?, basis_url }
//               Der Empfänger wird SERVERSEITIG geprüft: erlaubt ist nur die beim Kunden der Baustelle
//               hinterlegte Mail (kunde.email) oder eine Adresse aus konfiguration.MAIL_TESTEMPFAENGER
//               (kommagetrennt). Fehlt empfaenger_email, gilt kunde.email. Sonst 403.
//   erinnerung  { regierapport_id }
//               Erinnerungsmail an die gespeicherte empfaenger_email, Chronik 'erinnert', Status bleibt.
//               Wird täglich von regie_erinnerungen_anstossen() (pg_cron + pg_net) oder von n8n aufgerufen.
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

function mailNorm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

interface Rapport {
  id: string;
  status: string;
  nummer: string | null;
  link_token: string;
  betrag_rappen: number | null;
  frist_bis: string | null;
  anhang_pfad: string | null;
  tagesmeldung_id: string | null;
  empfaenger_email: string | null;
  versendet_am: string | null;
  baustelle: { bezeichnung: string | null; konto_nr: string; kunde: { email: string | null; ansprechperson: string | null } | null } | null;
}

interface Absender {
  email: string | null;
  name: string | null;
}

const STIL = 'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#17242a';
const KNOPF = 'display:inline-block;background:#D82816;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold';
const LEISE = 'font-size:13px;color:#6C7B81';

function chfText(rappen: number | null): string | null {
  return rappen != null ? (rappen / 100).toFixed(2) : null;
}

/** «Regierapport RR-2026-0012» bzw. nur «Regierapport», wenn (noch) keine Nummer da ist. */
function rapportName(r: Rapport): string {
  return r.nummer ? `Regierapport ${r.nummer}` : 'Regierapport';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const modus: string = body?.modus ?? 'senden';
    const regierapport_id: string | undefined = body?.regierapport_id;
    if (!regierapport_id) return antwort(400, { fehler: 'regierapport_id nötig' });
    if (modus !== 'senden' && modus !== 'erinnerung') return antwort(400, { fehler: 'modus muss senden oder erinnerung sein' });

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Wer sendet? Der angemeldete Bauführer — Antworten des Kunden sollen direkt zu ihm.
    // Bei anonymer Sitzung oder Cron-Aufruf (anon key) bleibt das leer.
    let absender: Absender = { email: null, name: null };
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const { data: u } = await supa.auth.getUser(jwt);
      absender = { email: u.user?.email ?? null, name: (u.user?.user_metadata?.name as string | undefined) ?? null };
    }

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries(
      (conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]),
    );
    if (!k.RESEND_API_KEY) return antwort(500, { fehler: 'RESEND_API_KEY fehlt in konfiguration' });

    const { data: rRoh } = await supa
      .from('regierapport')
      .select('id, status, nummer, link_token, betrag_rappen, frist_bis, anhang_pfad, tagesmeldung_id, empfaenger_email, versendet_am, baustelle:baustelle_id(bezeichnung, konto_nr, kunde:kunde_id(email, ansprechperson))')
      .eq('id', regierapport_id)
      .single();
    if (!rRoh) return antwort(404, { fehler: 'Regierapport nicht gefunden' });
    const r = rRoh as unknown as Rapport;

    const bez = r.baustelle?.bezeichnung ?? 'Baustelle';
    const knr = r.baustelle?.konto_nr ?? '';
    const betreffBasis = `Regie ${bez} · ${knr}`; // fester Betreff pro Baustelle → ein Mailverlauf
    const firma = k.MAIL_FIRMA ?? 'Gerüst Rapport';
    const gruss = absender.name ? `Freundliche Grüsse<br>${absender.name}` : 'Freundliche Grüsse';
    const grussText = absender.name ? `Freundliche Grüsse\n${absender.name}` : 'Freundliche Grüsse';
    const fuss = `${firma}${absender.email ? ` · Rückfragen an ${absender.email}` : ''}`;
    const von = k.MAIL_ABSENDER ?? `${firma} <onboarding@resend.dev>`;

    async function resend(mail: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; fehler: string }> {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mail),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, fehler: 'Resend: ' + (j?.message ?? res.status) };
      return { ok: true, id: j.id };
    }

    // ── Modus Erinnerung ──────────────────────────────────────────────────────
    if (modus === 'erinnerung') {
      if (!r.empfaenger_email) return antwort(400, { fehler: 'Rapport hat keine gespeicherte Empfänger-Mail — wurde er je versendet?' });
      if (r.status === 'entwurf') return antwort(400, { fehler: 'Entwurf — noch nicht versendet, keine Erinnerung' });
      if (r.status === 'bestaetigt') return antwort(200, { ok: false, grund: 'schon bestätigt' });

      const basis = String(body?.basis_url ?? k.APP_URL ?? '').replace(/\/$/, '');
      const link = basis ? `${basis}/b/${r.link_token}` : null;
      const chf = chfText(r.betrag_rappen);
      const name = rapportName(r);
      const versandTag = r.versendet_am ? new Date(r.versendet_am).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }) : null;
      const betreff = `Erinnerung: ${betreffBasis}${r.nummer ? ` · ${r.nummer}` : ''}`;

      const html = `
        <div style="${STIL}">
        <p>Guten Tag</p>
        <p>Wir haben noch keine Rückmeldung zum <strong>${name}</strong> für <strong>${bez}</strong> (Konto ${knr})${chf ? ` über Fr. ${chf}` : ''}${versandTag ? `, den wir Ihnen am ${versandTag} zugestellt haben` : ''}.</p>
        <p>Gemäss Vertrag ist der Rapport innert 3 Tagen gegenzuzeichnen${r.frist_bis ? ` — die Frist war der ${new Date(r.frist_bis).toLocaleDateString('de-CH')}` : ''}.</p>
        ${link ? `<p>Bitte bestätigen Sie ihn unter diesem Link — ohne Anmeldung:</p>
        <p><a href="${link}" style="${KNOPF}">${name} ansehen &amp; bestätigen</a></p>
        <p style="${LEISE}">Oder den Link kopieren: ${link}</p>` : ''}
        <p>Bei Fragen antworten Sie einfach auf diese Mail.</p>
        <p>${gruss}</p>
        <p style="font-size:12px;color:#6C7B81;border-top:1px solid #dfe5e4;padding-top:8px">${fuss}</p>
        </div>`;
      const text = [
        'Guten Tag',
        '',
        `Wir haben noch keine Rückmeldung zum ${name} für ${bez} (Konto ${knr})${chf ? ` über Fr. ${chf}` : ''}${versandTag ? `, den wir Ihnen am ${versandTag} zugestellt haben` : ''}.`,
        `Gemäss Vertrag ist der Rapport innert 3 Tagen gegenzuzeichnen${r.frist_bis ? ` — die Frist war der ${new Date(r.frist_bis).toLocaleDateString('de-CH')}` : ''}.`,
        '',
        ...(link ? ['Bitte bestätigen Sie ihn unter diesem Link — ohne Anmeldung:', link, ''] : []),
        'Bei Fragen antworten Sie einfach auf diese Mail.',
        '',
        grussText,
        '',
        fuss,
      ].join('\n');

      const mail: Record<string, unknown> = { from: von, to: [r.empfaenger_email], subject: betreff, html, text };
      if (absender.email) mail.reply_to = absender.email;
      const erg = await resend(mail);
      if (!erg.ok) return antwort(502, { fehler: erg.fehler });

      await supa.from('zustellung_log').insert({
        regierapport_id: r.id,
        an: r.empfaenger_email,
        ereignis: 'erinnert',
        detail: { resend_id: erg.id, betreff, nummer: r.nummer },
      });
      return antwort(200, { ok: true, resend_id: erg.id, modus: 'erinnerung' });
    }

    // ── Modus Senden ──────────────────────────────────────────────────────────
    // Empfänger serverseitig: Kunden-Mail der Baustelle oder Testempfänger aus der Konfiguration.
    const kundenMail = mailNorm(r.baustelle?.kunde?.email) || null;
    const testEmpfaenger = String(k.MAIL_TESTEMPFAENGER ?? '')
      .split(',')
      .map(mailNorm)
      .filter((s) => s.length > 0);
    const gewuenscht = mailNorm(body?.empfaenger_email) || kundenMail;
    if (!gewuenscht) {
      return antwort(400, { fehler: 'Beim Kunden dieser Baustelle ist keine E-Mail hinterlegt (Verwaltung → Kunden).' });
    }
    const erlaubt = gewuenscht === kundenMail || testEmpfaenger.includes(gewuenscht);
    if (!erlaubt) {
      return antwort(403, {
        fehler: `Empfänger muss die hinterlegte Kunden-Mail sein${kundenMail ? ` (${kundenMail})` : ''}.`,
      });
    }
    const empfaenger_email = gewuenscht;

    // Fotos zählen (Team-Meldung + nachgereichte) — sie stehen im Kundenlink, nicht als Anhang (Mailgrösse)
    const { count: fotoAnzahl } = await supa
      .from('foto')
      .select('id', { count: 'exact', head: true })
      .or(`regierapport_id.eq.${r.id}${r.tagesmeldung_id ? `,tagesmeldung_id.eq.${r.tagesmeldung_id}` : ''}`);

    const betreff = `${betreffBasis}${r.nummer ? ` · ${r.nummer}` : ''}`;
    const link = `${String(body?.basis_url ?? k.APP_URL ?? '').replace(/\/$/, '')}/b/${r.link_token}`;
    const chf = chfText(r.betrag_rappen);
    const name = rapportName(r);
    const anrede = r.baustelle?.kunde?.ansprechperson && gewuenscht === kundenMail ? `Guten Tag ${r.baustelle.kunde.ansprechperson}` : 'Guten Tag';
    const fotoSatz = fotoAnzahl && fotoAnzahl > 0
      ? `<p>Unter dem Link sehen Sie die Positionen und ${fotoAnzahl === 1 ? 'ein Foto' : `${fotoAnzahl} Fotos`} von der Baustelle.</p>`
      : '<p>Unter dem Link sehen Sie die einzelnen Positionen.</p>';

    // Gegen Spam-Einstufung: Text-Teil, sichtbarer Link, Antwortadresse einer echten Person, Fusszeile mit Absender.
    const html = `
      <div style="${STIL}">
      <p>${anrede}</p>
      <p>${r.anhang_pfad ? 'Im Anhang finden Sie' : 'Hiermit erhalten Sie'} den <strong>${name}</strong> für <strong>${bez}</strong> (Konto ${knr})${chf ? ` über Fr. ${chf}` : ''}.</p>
      ${fotoSatz}
      <p>Bitte bestätigen Sie ihn unter diesem Link — ohne Anmeldung:</p>
      <p><a href="${link}" style="${KNOPF}">${name} ansehen &amp; bestätigen</a></p>
      <p style="${LEISE}">Oder den Link kopieren: ${link}</p>
      <p style="${LEISE}">Gemäss Vertrag ist der Rapport innert 3 Tagen gegenzuzeichnen.</p>
      <p>${gruss}</p>
      <p style="font-size:12px;color:#6C7B81;border-top:1px solid #dfe5e4;padding-top:8px">${fuss}</p>
      </div>`;

    const text = [
      anrede,
      '',
      `${r.anhang_pfad ? 'Im Anhang finden Sie' : 'Hiermit erhalten Sie'} den ${name} für ${bez} (Konto ${knr})${chf ? ` über Fr. ${chf}` : ''}.`,
      fotoAnzahl && fotoAnzahl > 0 ? `Unter dem Link sehen Sie die Positionen und ${fotoAnzahl} Foto(s) von der Baustelle.` : 'Unter dem Link sehen Sie die einzelnen Positionen.',
      '',
      'Bitte bestätigen Sie ihn unter diesem Link — ohne Anmeldung:',
      link,
      '',
      'Gemäss Vertrag ist der Rapport innert 3 Tagen gegenzuzeichnen.',
      '',
      grussText,
      '',
      fuss,
    ].join('\n');

    const mail: Record<string, unknown> = { from: von, to: [empfaenger_email], subject: betreff, html, text };
    if (absender.email) mail.reply_to = absender.email;

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

    const erg = await resend(mail);
    if (!erg.ok) return antwort(502, { fehler: erg.fehler });

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
      detail: { resend_id: erg.id, betreff, nummer: r.nummer, fotos: fotoAnzahl ?? 0, testempfaenger: gewuenscht !== kundenMail },
    });

    return antwort(200, { ok: true, resend_id: erg.id, empfaenger_email });
  } catch (e) {
    return antwort(500, { fehler: String(e) });
  }
});
