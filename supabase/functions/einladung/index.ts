// Einladungslink für Monteur und Chefmonteur — bewusst OHNE JWT (verify_jwt false):
// Das Gerät, das sich koppeln will, hat noch keine Sitzung. Das ist ja der Punkt.
//
// Auth läuft über den unerratbaren Token (UUID, unique auf `einladung`), 24 h gültig,
// einmal verwendbar. Gleiches Muster wie der Kundenlink `bestaetigung`.
//
//   GET  ?token=…                  → wer eingeladen ist (Name, Rolle), ohne etwas zu verändern
//   POST {token, bezeichnung?}     → einlösen: eigener Zugang für dieses Gerät + Sitzung zurück
//
// Warum ein eigener Auth-Zugang **je Gerät** und nicht je Person:
// Verliert jemand sein Handy, sperrt der Bauführer genau dieses Gerät — die anderen laufen
// weiter. Gesperrt heisst: Zeile in `benutzer` weg, also `aktuelle_firma()` null, also keine
// einzige sichtbare Zeile mehr.
//
// ⚠ Die Datenbank trennt weiterhin nur zwischen Firmen, nicht zwischen Rollen (siehe 0032).
//
// Quelle der Wahrheit ist DIESE Datei im Repo. Deploy: Supabase-MCP `deploy_edge_function`
// (verify_jwt: false!) oder `supabase functions deploy einladung --no-verify-jwt`.
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

interface Einladung {
  id: string;
  firma_id: string;
  mitarbeiter_id: string;
  ansicht: 'monteur' | 'chef';
  gueltig_bis: string;
  eingeloest_am: string | null;
  mitarbeiter: { name: string; aktiv: boolean } | null;
}

/** Holt die Einladung und sagt in einem Satz, warum sie nicht gilt. */
async function einladungLesen(
  supa: ReturnType<typeof createClient>,
  token: string,
): Promise<{ e: Einladung } | { fehler: string; status: number }> {
  const { data } = await supa
    .from('einladung')
    .select('id, firma_id, mitarbeiter_id, ansicht, gueltig_bis, eingeloest_am, mitarbeiter:mitarbeiter_id(name, aktiv)')
    .eq('token', token)
    .maybeSingle();
  const e = data as unknown as Einladung | null;
  if (!e) return { fehler: 'Diesen Link gibt es nicht.', status: 404 };
  if (e.eingeloest_am) return { fehler: 'Dieser Link wurde schon benutzt. Bitte einen neuen anfordern.', status: 410 };
  if (new Date(e.gueltig_bis) < new Date()) return { fehler: 'Dieser Link ist abgelaufen. Bitte einen neuen anfordern.', status: 410 };
  if (e.mitarbeiter && !e.mitarbeiter.aktiv) return { fehler: 'Diese Person ist nicht mehr aktiv.', status: 403 };
  return { e };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const supa = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    // ── Vorschau: wer ist eingeladen? Verändert nichts, damit ein versehentlicher
    //    Klick (oder die Linkvorschau von WhatsApp) die Einladung nicht verbraucht.
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return antwort(400, { fehler: 'token fehlt' });
      const r = await einladungLesen(supa, token);
      if ('fehler' in r) return antwort(r.status, { fehler: r.fehler });
      return antwort(200, { name: r.e.mitarbeiter?.name ?? '', ansicht: r.e.ansicht });
    }

    if (req.method !== 'POST') return antwort(405, { fehler: 'Methode nicht erlaubt' });

    const { token, bezeichnung } = (await req.json().catch(() => ({}))) as {
      token?: string;
      bezeichnung?: string;
    };
    if (!token) return antwort(400, { fehler: 'token fehlt' });

    const r = await einladungLesen(supa, token);
    if ('fehler' in r) return antwort(r.status, { fehler: r.fehler });
    const e = r.e;

    // ── Eigener Zugang für dieses Gerät. Die Mailadresse ist technisch, niemand schreibt
    //    je dorthin — darum eine Domain, die es nicht gibt, und ein Passwort, das niemand kennt.
    const geraetId = crypto.randomUUID();
    const email = `geraet-${geraetId}@geraete.rapporto.invalid`;
    const passwort = crypto.randomUUID() + crypto.randomUUID();

    const { data: neu, error: userFehler } = await supa.auth.admin.createUser({
      email,
      password: passwort,
      email_confirm: true,
      user_metadata: { geraet_id: geraetId, mitarbeiter_id: e.mitarbeiter_id, ansicht: e.ansicht },
    });
    if (userFehler || !neu?.user) return antwort(500, { fehler: 'Zugang konnte nicht angelegt werden.' });
    const authId = neu.user.id;

    // Aufräumen, falls einer der nächsten Schritte scheitert — sonst bliebe ein Zugang
    // ohne Firma stehen, der nichts kann, aber in der Liste auftaucht.
    const zurueck = async () => { await supa.auth.admin.deleteUser(authId).catch(() => undefined); };

    // ── Die Firma dranhängen. Ohne diese Zeile gibt `aktuelle_firma()` null zurück und das
    //    Gerät sähe keine einzige Zeile — genau das ist später auch der Sperrmechanismus.
    const { error: bFehler } = await supa.from('benutzer').insert({
      auth_user_id: authId,
      firma_id: e.firma_id,
      bezeichnung: `Gerät · ${e.mitarbeiter?.name ?? ''}`.trim(),
    });
    if (bFehler) { await zurueck(); return antwort(500, { fehler: 'Zugang konnte der Firma nicht zugeordnet werden.' }); }

    // ── Gerät festhalten (Service-Role umgeht RLS, firma_id also von Hand — CLAUDE.md)
    const { error: gFehler } = await supa.from('geraet').insert({
      id: geraetId,
      firma_id: e.firma_id,
      mitarbeiter_id: e.mitarbeiter_id,
      ansicht: e.ansicht,
      auth_user_id: authId,
      bezeichnung: (bezeichnung ?? '').slice(0, 60) || null,
      letzte_nutzung: new Date().toISOString(),
    });
    if (gFehler) {
      await supa.from('benutzer').delete().eq('auth_user_id', authId);
      await zurueck();
      return antwort(500, { fehler: 'Gerät konnte nicht gespeichert werden.' });
    }

    // ── Sitzung holen und ans Gerät geben. Supabase legt sie dort ab; sie hält sich über den
    //    Refresh-Token, damit niemand auf der Baustelle je wieder etwas eintippen muss.
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: sitzung, error: sFehler } = await anon.auth.signInWithPassword({ email, password: passwort });
    if (sFehler || !sitzung.session) {
      await supa.from('geraet').delete().eq('id', geraetId);
      await supa.from('benutzer').delete().eq('auth_user_id', authId);
      await zurueck();
      return antwort(500, { fehler: 'Anmeldung fehlgeschlagen.' });
    }

    // Erst ganz zum Schluss verbrauchen — scheitert etwas davor, gilt der Link weiter.
    await supa.from('einladung').update({ eingeloest_am: new Date().toISOString() }).eq('id', e.id);

    return antwort(200, {
      access_token: sitzung.session.access_token,
      refresh_token: sitzung.session.refresh_token,
      mitarbeiter_id: e.mitarbeiter_id,
      name: e.mitarbeiter?.name ?? '',
      ansicht: e.ansicht,
      geraet_id: geraetId,
    });
  } catch (err) {
    return antwort(500, { fehler: err instanceof Error ? err.message : 'Unbekannter Fehler' });
  }
});
