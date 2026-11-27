// Erfundene Testdaten für die LOKALE Supabase: zwei Firmen («Testbau A AG», «Testbau B AG»), je Büro, Chefmonteur,
// Monteur, ein Team, ein Kunde, eine Baustelle, eine Meldung, ein Regierapport beim Kunden, ein Foto im Speicher.
// Keine echten Namen, keine echten Kundendaten. Läuft NUR gegen 127.0.0.1 — sonst Abbruch.
//
// Start: node tests/lokal/testdaten.mjs    (wiederholbar: räumt die Testfirmen vorher weg)
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

export const URL_LOKAL = 'http://127.0.0.1:54321';
// Öffentlich bekannte Schlüssel JEDER lokalen Supabase-Installation (supabase-demo) — keine Geheimnisse.
export const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export const PASSWORT = 'Lokal-Test-1234';

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_LOKAL)) throw new Error('GESPERRT: nur lokal');

// Feste Kennungen — die Tests greifen darauf zu
export const F = {
  A: { firma: 'aaaaaaaa-0000-4000-8000-000000000001', domain: 'testbau-a.test', name: 'Testbau A AG',
    team: 'aaaaaaaa-0000-4000-8000-0000000000a1', kunde: 'aaaaaaaa-0000-4000-8000-0000000000c1', baustelle: 'aaaaaaaa-0000-4000-8000-0000000000b1',
    chef: 'aaaaaaaa-0000-4000-8000-0000000000e1', monteur: 'aaaaaaaa-0000-4000-8000-0000000000e2', monteur2: 'aaaaaaaa-0000-4000-8000-0000000000e3',
    meldung: 'aaaaaaaa-0000-4000-8000-0000000000d1', meldungUuid: 'aaaaaaaa-0000-4000-8000-0000000000f1',
    rapport: 'aaaaaaaa-0000-4000-8000-000000000091', token: 'aaaaaaaa-0000-4000-8000-00000000aaaa' },
  B: { firma: 'bbbbbbbb-0000-4000-8000-000000000001', domain: 'testbau-b.test', name: 'Testbau B AG',
    team: 'bbbbbbbb-0000-4000-8000-0000000000a1', kunde: 'bbbbbbbb-0000-4000-8000-0000000000c1', baustelle: 'bbbbbbbb-0000-4000-8000-0000000000b1',
    chef: 'bbbbbbbb-0000-4000-8000-0000000000e1', monteur: 'bbbbbbbb-0000-4000-8000-0000000000e2', monteur2: 'bbbbbbbb-0000-4000-8000-0000000000e3',
    meldung: 'bbbbbbbb-0000-4000-8000-0000000000d1', meldungUuid: 'bbbbbbbb-0000-4000-8000-0000000000f1',
    rapport: 'bbbbbbbb-0000-4000-8000-000000000091', token: 'bbbbbbbb-0000-4000-8000-00000000bbbb' },
};
export const konto = (f, rolle) => `${rolle}@${F[f].domain}`;

function sql(text) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_lokal', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: text, encoding: 'utf8' });
}

export async function testdatenAnlegen() {
  const admin = createClient(URL_LOKAL, SERVICE, { auth: { persistSession: false } });
  // Aufräumen (Testfirmen und ihre Konten)
  sql(`set session_replication_role = replica;
    delete from regie_position where regierapport_id in (select id from regierapport where firma_id in ('${F.A.firma}','${F.B.firma}'));
    delete from zustellung_log where regierapport_id in (select id from regierapport where firma_id in ('${F.A.firma}','${F.B.firma}'));
    delete from foto where tagesmeldung_id in (select id from tagesmeldung where firma_id in ('${F.A.firma}','${F.B.firma}')) or regierapport_id in (select id from regierapport where firma_id in ('${F.A.firma}','${F.B.firma}'));
    delete from regierapport where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from zeiteintrag where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from tagesmeldung where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from jahresplan where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from einsatz_person where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from abwesenheit where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from team_mitglied where team_id in (select id from team where firma_id in ('${F.A.firma}','${F.B.firma}'));
    delete from benutzer where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from team where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from baustelle where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from kunde where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from mitarbeiter where firma_id in ('${F.A.firma}','${F.B.firma}');
    delete from firma where id in ('${F.A.firma}','${F.B.firma}');
    set session_replication_role = origin;
    delete from auth.identities where identity_data->>'email' like '%@testbau-_.test';
    delete from auth.users where email like '%@testbau-_.test';`);

  const nutzer = {};
  for (const f of ['A', 'B']) for (const rolle of ['buero', 'chef', 'monteur']) {
    const { data, error } = await admin.auth.admin.createUser({ email: konto(f, rolle), password: PASSWORT, email_confirm: true, user_metadata: { name: `${rolle} ${f}` } });
    if (error) throw error;
    nutzer[`${f}.${rolle}`] = data.user.id;
  }

  const heute = new Date();
  const d = (n) => { const x = new Date(heute); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  let s = '';
  for (const f of ['A', 'B']) {
    const k = F[f];
    s += `
insert into firma (id, name, modus_erfassung, modus_sekretariat, mail_domain, ist_demo) values ('${k.firma}', '${k.name}', 'regie', 'voll', '${k.domain}', false);
insert into mitarbeiter (id, name, typ, funktion, sprache, aktiv, oev_standard, km_standard, firma_id) values
  ('${k.chef}', 'Chef ${f} Test', 'intern', 'gruppe', 'it', true, false, 0, '${k.firma}'),
  ('${k.monteur}', 'Monteur ${f} Test', 'intern', 'monteur', 'sq', true, false, 0, '${k.firma}'),
  ('${k.monteur2}', 'Temp ${f} Test', 'temporaer', 'monteur', 'de', true, false, 0, '${k.firma}');
insert into team (id, bezeichnung, chefmonteur_id, aktiv, firma_id) values ('${k.team}', 'Team ${f}1', '${k.chef}', true, '${k.firma}');
insert into team_mitglied (team_id, mitarbeiter_id) values ('${k.team}', '${k.chef}'), ('${k.team}', '${k.monteur}'), ('${k.team}', '${k.monteur2}');
insert into benutzer (auth_user_id, firma_id, bezeichnung, mitarbeiter_id, ansicht) values
  ('${nutzer[`${f}.buero`]}', '${k.firma}', 'Büro ${f}', null, null),
  ('${nutzer[`${f}.chef`]}', '${k.firma}', 'Chef ${f}', '${k.chef}', 'chef'),
  ('${nutzer[`${f}.monteur`]}', '${k.firma}', 'Monteur ${f}', '${k.monteur}', 'monteur');
insert into kunde (id, name, email, firma_id) values ('${k.kunde}', 'Kunde ${f} AG', 'kunde-${f.toLowerCase()}@kunde.test', '${k.firma}');
insert into baustelle (id, konto_nr, strasse, plz, ort, bezeichnung, status, kunde_id, firma_id) values ('${k.baustelle}', '900001', 'Teststrasse ${f}', '3000', 'Bern', 'Baustelle ${f}', 'aktiv', '${k.kunde}', '${k.firma}');
insert into jahresplan (baustelle_id, team_id, von, bis, firma_id) values ('${k.baustelle}', '${k.team}', '${d(-7)}', '${d(7)}', '${k.firma}');
insert into tagesmeldung (id, client_uuid, team_id, datum, baustelle_id, normalfall, firma_id, transkript) values ('${k.meldung}', '${k.meldungUuid}', '${k.team}', '${d(-1)}', '${k.baustelle}', true, '${k.firma}', 'Geheimer Text ${f}');
insert into zeiteintrag (tagesmeldung_id, mitarbeiter_id, normal_min, ueber_min, status, firma_id) values
  ('${k.meldung}', '${k.chef}', 504, 21, 'freigegeben', '${k.firma}'),
  ('${k.meldung}', '${k.monteur}', 504, 21, 'offen', '${k.firma}'),
  ('${k.meldung}', '${k.monteur2}', 504, 21, 'freigegeben', '${k.firma}');
insert into regierapport (id, baustelle_id, nummer, status, betrag_rappen, versendet_am, link_token, tagesmeldung_id, firma_id, empfaenger_email) values
  ('${k.rapport}', '${k.baustelle}', '${f}-1', 'versendet', 369919, now(), '${k.token}', '${k.meldung}', '${k.firma}', 'kunde-${f.toLowerCase()}@kunde.test');
insert into regie_position (regierapport_id, tarif_code, bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen) values
  ('${k.rapport}', 'gruppe', 'Chef ${f} · 8.75 h', 875, 12100, 105875),
  ('${k.rapport}', 'monteur', 'Monteur ${f} · 8.75 h', 875, 10800, 94500),
  ('${k.rapport}', 'monteur', 'Temp ${f} · 8.75 h', 875, 10800, 94500),
  ('${k.rapport}', 'lieferwagen_35', 'Lieferwagen bis 3,5 t · 1.0 h', 100, 16500, 16500),
  ('${k.rapport}', 'etappe', 'Etappenzuschlag', 100, 28000, 28000),
  ('${k.rapport}', 'materialmiete', 'Materialmiete 9 %', 100, 30544, 30544);
`;
  }
  sql(`set session_replication_role = replica;\n${s}\nset session_replication_role = origin;`);

  // Ein Foto je Firma im Speicher (Pfad der Meldung) + Zeile
  for (const f of ['A', 'B']) {
    const k = F[f];
    const pfad = `fotos/${k.meldungUuid}/foto-${f}.jpg`;
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const { error } = await admin.storage.from('anhaenge').upload(pfad, jpg, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    sql(`insert into foto (id, tagesmeldung_id, pfad) values (gen_random_uuid(), '${k.meldung}', '${pfad}');`);
  }
  return { nutzer };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('testdaten.mjs')) {
  testdatenAnlegen().then(() => console.log('Testdaten angelegt: Testbau A AG, Testbau B AG')).catch((e) => { console.error(e); process.exit(1); });
}
