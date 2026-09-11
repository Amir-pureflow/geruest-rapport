// Mehrkostenanzeige: die schriftliche Anmeldung einer Zusatzarbeit an die Bauleitung — VOR der Arbeit.
// Bausitzungsprotokoll 7.1: «Mehrkosten ohne vorzeitige und schriftliche Anzeige werden nicht entschädigt.»
//
// Body: { zusatzauftrag_id, empfaenger_email?, basis_url? }
// Empfänger wird serverseitig geprüft: nur kunde.email der Baustelle oder eine Adresse aus
// konfiguration.MAIL_TESTEMPFAENGER (kommagetrennt). Nach dem Versand stehen angezeigt_am / angezeigt_an /
// angezeigt_text am Zusatzauftrag. Idempotent: ist schon angezeigt, kommt 200 {schon:true} zurück (erneut: true erzwingt).
//
// Quelle der Wahrheit: supabase/functions/mehrkosten-anzeigen/index.ts im Repo. Deploy: verify_jwt true.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function mailNorm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function datumCh(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
}

const TAETIGKEIT: Record<string, string> = {
  versetzen: 'Gerüst versetzen',
  ergaenzen: 'Gerüst ergänzen',
  reparieren: 'Gerüst reparieren',
  teilabbau: 'Teilabbau',
  reinigen: 'Reinigung',
  anderes: 'zusätzliche Gerüstarbeiten',
};
const KANAL: Record<string, string> = { telefon: 'telefonisch', mail: 'per E-Mail', vor_ort: 'vor Ort' };

const STIL = 'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#17242a';
const LEISE = 'font-size:13px;color:#6C7B81';

interface Auftrag {
  id: string;
  besteller_name: string;
  besteller_rolle: string | null;
  bestellt_am: string;
  kanal: string;
  taetigkeit: string;
  geplant_fuer: string | null;
  notiz: string | null;
  angezeigt_am: string | null;
  baustelle: {
    bezeichnung: string | null;
    konto_nr: string;
    kunde: { name: string; email: string | null; ansprechperson: string | null; anzeige_noetig: boolean | null } | null;
  } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const id: string | undefined = body?.zusatzauftrag_id;
    if (!id) return antwort(400, { fehler: 'zusatzauftrag_id nötig' });

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let absender: { email: string | null; name: string | null } = { email: null, name: null };
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const { data: u } = await supa.auth.getUser(jwt);
      absender = { email: u.user?.email ?? null, name: (u.user?.user_metadata?.name as string | undefined) ?? null };
    }

    const { data: conf } = await supa.from('konfiguration').select('schluessel,wert');
    const k: Record<string, string> = Object.fromEntries((conf ?? []).map((r: { schluessel: string; wert: string }) => [r.schluessel, r.wert]));
    if (!k.RESEND_API_KEY) return antwort(500, { fehler: 'RESEND_API_KEY fehlt in konfiguration' });

    const { data: aRoh } = await supa
      .from('zusatzauftrag')
      .select('id, besteller_name, besteller_rolle, bestellt_am, kanal, taetigkeit, geplant_fuer, notiz, angezeigt_am, baustelle:baustelle_id(bezeichnung, konto_nr, kunde:kunde_id(name, email, ansprechperson, anzeige_noetig))')
      .eq('id', id)
      .single();
    if (!aRoh) return antwort(404, { fehler: 'Zusatzauftrag nicht gefunden' });
    const a = aRoh as unknown as Auftrag;
    if (a.angezeigt_am && !body?.erneut) return antwort(200, { schon: true, angezeigt_am: a.angezeigt_am });

    // Empfänger: Kunden-Mail der Baustelle oder Testempfänger
    const kundenMail = mailNorm(a.baustelle?.kunde?.email) || null;
    const test = String(k.MAIL_TESTEMPFAENGER ?? '').split(',').map(mailNorm).filter(Boolean);
    const gewuenscht = mailNorm(body?.empfaenger_email) || kundenMail;
    if (!gewuenscht) return antwort(400, { fehler: 'Beim Kunden dieser Baustelle ist keine E-Mail hinterlegt (Verwaltung → Kunden).' });
    if (gewuenscht !== kundenMail && !test.includes(gewuenscht)) {
      return antwort(403, { fehler: `Empfänger muss die hinterlegte Kunden-Mail sein${kundenMail ? ` (${kundenMail})` : ''}.` });
    }

    const bez = a.baustelle?.bezeichnung ?? 'Baustelle';
    const knr = a.baustelle?.konto_nr ?? '';
    const firma = k.MAIL_FIRMA ?? 'Gerüst Rapport';
    const anrede = a.baustelle?.kunde?.ansprechperson && gewuenscht === kundenMail ? `Guten Tag ${a.baustelle.kunde.ansprechperson}` : 'Guten Tag';
    const taetigkeit = TAETIGKEIT[a.taetigkeit] ?? a.taetigkeit;
    const bestellt = `${datumCh(a.bestellt_am)}${KANAL[a.kanal] ? ` ${KANAL[a.kanal]}` : ''}`;
    const besteller = a.besteller_rolle ? `${a.besteller_name} (${a.besteller_rolle})` : a.besteller_name;
    const geplant = a.geplant_fuer ? datumCh(a.geplant_fuer) : null;
    const betreff = `Mehrkostenanzeige ${bez} · ${knr}`;
    const gruss = absender.name ? `Freundliche Grüsse<br>${esc(absender.name)}` : 'Freundliche Grüsse';
    const fuss = `${firma}${absender.email ? ` · Rückfragen an ${absender.email}` : ''}`;

    const kern = [
      `Am ${bestellt} hat uns ${besteller} beauftragt, auf der Baustelle ${bez} (Objekt ${knr}) folgende Arbeit auszuführen: ${taetigkeit}${a.notiz ? ` — ${a.notiz}` : ''}.`,
      `Diese Arbeit ist nicht Teil des vereinbarten Werkumfangs. Wir zeigen sie hiermit vor der Ausführung als Mehrkosten an. Die Verrechnung erfolgt nach Aufwand zum Regie-Tarif (SGUV)${geplant ? `, Ausführung geplant am ${geplant}` : ''}.`,
      'Nach der Ausführung erhalten Sie den Regierapport zur Gegenzeichnung. Falls Sie mit dieser Anzeige nicht einverstanden sind, bitten wir um Rückmeldung vor Beginn der Arbeiten.',
    ];

    const html = `
      <div style="${STIL}">
      <p>${esc(anrede)}</p>
      ${kern.map((s) => `<p>${esc(s)}</p>`).join('\n')}
      <p>${gruss}</p>
      <p style="${LEISE};border-top:1px solid #dfe5e4;padding-top:8px">${esc(fuss)}</p>
      </div>`;
    const text = [anrede, '', ...kern.flatMap((s) => [s, '']), absender.name ? `Freundliche Grüsse\n${absender.name}` : 'Freundliche Grüsse', '', fuss].join('\n');

    const mail: Record<string, unknown> = { from: k.MAIL_ABSENDER ?? `${firma} <onboarding@resend.dev>`, to: [gewuenscht], subject: betreff, html, text };
    if (absender.email) mail.reply_to = absender.email;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return antwort(502, { fehler: 'Resend: ' + (j?.message ?? res.status) });

    const jetzt = new Date().toISOString();
    const { error } = await supa
      .from('zusatzauftrag')
      .update({ angezeigt_am: jetzt, angezeigt_an: gewuenscht, angezeigt_text: text })
      .eq('id', a.id);
    if (error) return antwort(500, { fehler: 'Mail ist raus, Vermerk fehlgeschlagen: ' + error.message });

    return antwort(200, { ok: true, angezeigt_am: jetzt, angezeigt_an: gewuenscht, resend_id: j.id, testempfaenger: gewuenscht !== kundenMail });
  } catch (e) {
    return antwort(500, { fehler: String(e) });
  }
});
