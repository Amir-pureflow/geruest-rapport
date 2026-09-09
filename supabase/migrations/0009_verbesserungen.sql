-- 0009: Verbesserungen — Indizes, Rapportnummer, Stunden-RPCs mit Protokoll, Kennzahlen-Sichten,
-- Fristenlauf, Storage-Policies ohne Löschen, kleine Spalten.
--
-- Diese Datei wird im SQL-Editor des Dashboards eingefügt (kein CLI, kein MCP). Darum:
--   * idempotent: mehrfaches Ausführen ist folgenlos (if not exists / or replace / drop policy if exists)
--   * rein additiv: die laufende App (Branch main) funktioniert vor und nach dem Einspielen
--   * Tabellen-Policies («authenticated darf alles») bleiben unangetastet — Login kommt später
--
-- Konventionen wie immer: Geld in Rappen (int), Zeit in Minuten (int). Schweizer Hochdeutsch.

-- ── 1. Indizes ────────────────────────────────────────────────────────────────

create index if not exists regierapport_zusatzauftrag_idx on regierapport (zusatzauftrag_id);
create index if not exists regierapport_tagesmeldung_idx  on regierapport (tagesmeldung_id);
create index if not exists regie_position_rapport_idx     on regie_position (regierapport_id);
create index if not exists zustellung_log_rapport_idx     on zustellung_log (regierapport_id);
create index if not exists zusatzauftrag_baustelle_idx    on zusatzauftrag (baustelle_id);
create index if not exists jahresplan_team_zeit_idx       on jahresplan (team_id, von, bis);
create index if not exists tagesmeldung_team_datum_idx    on tagesmeldung (team_id, datum);
create index if not exists freigabe_log_zeiteintrag_idx   on freigabe_log (zeiteintrag_id);

-- ── 2. Ein Regierapport pro Tagesmeldung ─────────────────────────────────────
-- Vorher Duplikate entschärfen — nichts löschen: Es bleibt pro Meldung der Rapport, der schon beim
-- Kunden ist (status <> entwurf), sonst der älteste. Alle andern verlieren nur die Verknüpfung
-- (tagesmeldung_id → null); Positionen und Chronik bleiben erhalten.
update regierapport r
set tagesmeldung_id = null
from (
  select id,
         row_number() over (
           partition by tagesmeldung_id
           order by (case when status = 'entwurf' then 1 else 0 end), erstellt_am
         ) as rn
  from regierapport
  where tagesmeldung_id is not null
) d
where d.id = r.id and d.rn > 1;

create unique index if not exists regierapport_eine_pro_meldung
  on regierapport (tagesmeldung_id)
  where tagesmeldung_id is not null;

-- ── 3. Regierapport-Nummer RR-JJJJ-NNNN ──────────────────────────────────────
-- Fortlaufend pro Jahr über eine Hilfstabelle. Der Demo-Betrieb setzt seine Nummern selber
-- (RR-2026-0001 …); darum überspringt der Zähler Nummern, die es schon gibt.

create table if not exists regierapport_nummer_lauf (
  jahr   int primary key,
  letzte int not null default 0
);
alter table regierapport_nummer_lauf enable row level security; -- nur über Trigger/Funktion beschrieben

create or replace function regierapport_nummer_naechste(p_jahr int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  kandidat text;
begin
  insert into regierapport_nummer_lauf (jahr, letzte) values (p_jahr, 0)
  on conflict (jahr) do nothing;

  select letzte into n from regierapport_nummer_lauf where jahr = p_jahr for update;

  loop
    n := n + 1;
    kandidat := format('RR-%s-%s', p_jahr, lpad(n::text, 4, '0'));
    exit when not exists (select 1 from regierapport where nummer = kandidat);
  end loop;

  update regierapport_nummer_lauf set letzte = n where jahr = p_jahr;
  return kandidat;
end;
$$;

create or replace function regierapport_nummer_setzen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nummer is null then
    new.nummer := regierapport_nummer_naechste(
      extract(year from (coalesce(new.erstellt_am, now()) at time zone 'Europe/Zurich'))::int
    );
  end if;
  return new;
end;
$$;

drop trigger if exists regierapport_nummer_trg on regierapport;
create trigger regierapport_nummer_trg
  before insert on regierapport
  for each row execute function regierapport_nummer_setzen();

-- Bestehende Rapporte ohne Nummer nachnummerieren, in der Reihenfolge ihres Entstehens.
do $$
declare r record;
begin
  for r in select id, erstellt_am from regierapport where nummer is null order by erstellt_am, id loop
    update regierapport
    set nummer = regierapport_nummer_naechste(extract(year from (r.erstellt_am at time zone 'Europe/Zurich'))::int)
    where id = r.id;
  end loop;
end $$;

-- ── 4. Stunden freigeben — Protokoll in derselben Transaktion (CLAUDE.md #7) ──

create or replace function zeit_freigeben(p_ids uuid[], p_wer uuid, p_grund text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  anzahl int;
begin
  if p_wer is null then
    raise exception 'zeit_freigeben: p_wer (wer gibt frei) fehlt';
  end if;

  with betroffen as (
    update zeiteintrag
    set status = 'freigegeben'
    where id = any(p_ids) and status = 'offen'
    returning id
  )
  insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
  select id, p_wer, 'status', 'offen', 'freigegeben', nullif(trim(p_grund), '')
  from betroffen;

  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

-- ── 5. Einen Zeiteintrag korrigieren (480-Regel, Grund ist Pflicht) ──────────
-- normal_min = least(total, 480), ueber_min = greatest(0, total − 480).
-- Loggt nur Felder, deren Wert sich wirklich ändert.

-- Rückgabe als JSON {id, normal_min, ueber_min, total_min} — bewusst nicht `returns table`, damit
-- Ausgabespalten und Tabellenspalten in plpgsql nicht kollidieren.
create or replace function zeit_korrigieren(p_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alt_normal int;
  alt_ueber  int;
  neu_normal int;
  neu_ueber  int;
begin
  if p_wer is null then
    raise exception 'zeit_korrigieren: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_korrigieren: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_korrigieren: Gesamtminuten müssen >= 0 sein';
  end if;

  select z.normal_min, z.ueber_min into alt_normal, alt_ueber
  from zeiteintrag z where z.id = p_id for update;
  if not found then
    raise exception 'zeit_korrigieren: Zeiteintrag % nicht gefunden', p_id;
  end if;

  neu_normal := least(p_total_min, 480);
  neu_ueber  := greatest(0, p_total_min - 480);

  if neu_normal <> alt_normal then
    insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
    values (p_id, p_wer, 'normal_min', alt_normal::text, neu_normal::text, trim(p_grund));
  end if;
  if neu_ueber <> alt_ueber then
    insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
    values (p_id, p_wer, 'ueber_min', alt_ueber::text, neu_ueber::text, trim(p_grund));
  end if;

  update zeiteintrag z set normal_min = neu_normal, ueber_min = neu_ueber where z.id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'normal_min', neu_normal,
    'ueber_min', neu_ueber,
    'total_min', neu_normal + neu_ueber
  );
end;
$$;

-- ── 6. Ganzes Team einer Meldung auf denselben Gesamtwert ─────────────────────
-- Nur offene Einträge; gleiche Logik wie 5. Gibt die Anzahl geänderter Einträge zurück.

create or replace function zeit_team_setzen(p_tagesmeldung_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  z record;
  anzahl int := 0;
  neu_normal int;
  neu_ueber  int;
begin
  if p_wer is null then
    raise exception 'zeit_team_setzen: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_team_setzen: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_team_setzen: Gesamtminuten müssen >= 0 sein';
  end if;

  neu_normal := least(p_total_min, 480);
  neu_ueber  := greatest(0, p_total_min - 480);

  for z in
    select id, normal_min, ueber_min
    from zeiteintrag
    where tagesmeldung_id = p_tagesmeldung_id and status = 'offen'
    for update
  loop
    if z.normal_min = neu_normal and z.ueber_min = neu_ueber then
      continue;
    end if;
    if z.normal_min <> neu_normal then
      insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
      values (z.id, p_wer, 'normal_min', z.normal_min::text, neu_normal::text, trim(p_grund));
    end if;
    if z.ueber_min <> neu_ueber then
      insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
      values (z.id, p_wer, 'ueber_min', z.ueber_min::text, neu_ueber::text, trim(p_grund));
    end if;
    update zeiteintrag set normal_min = neu_normal, ueber_min = neu_ueber where id = z.id;
    anzahl := anzahl + 1;
  end loop;

  return anzahl;
end;
$$;

-- ── 7. Regierapport anlegen: Kopf + Positionen in einer Transaktion ──────────
-- Idempotent: gibt es zur Meldung schon einen Rapport, kommt dessen id zurück.
-- Positionen-JSON: [{tarif_code, bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen}, …]
-- Läuft als Aufrufer (security invoker) — die Tabellen-Policies gelten.

create or replace function regierapport_anlegen(
  p_meldung uuid,
  p_baustelle uuid,
  p_zusatzauftrag uuid,
  p_positionen jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  rid uuid;
  total int;
begin
  if p_baustelle is null then
    raise exception 'regierapport_anlegen: p_baustelle fehlt';
  end if;
  if p_positionen is not null and jsonb_typeof(p_positionen) <> 'array' then
    raise exception 'regierapport_anlegen: p_positionen muss ein JSON-Array sein';
  end if;

  if p_meldung is not null then
    select id into rid from regierapport where tagesmeldung_id = p_meldung order by erstellt_am limit 1;
    if rid is not null then
      return rid;
    end if;
  end if;

  select coalesce(sum((p->>'betrag_rappen')::int), 0) into total
  from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) p;

  begin
    insert into regierapport (baustelle_id, zusatzauftrag_id, tagesmeldung_id, betrag_rappen)
    values (p_baustelle, p_zusatzauftrag, p_meldung, total)
    returning id into rid;
  exception when unique_violation then
    -- Zwei Geräte gleichzeitig: der andere war schneller — dessen Rapport zurückgeben.
    select id into rid from regierapport where tagesmeldung_id = p_meldung order by erstellt_am limit 1;
    if rid is null then
      raise;
    end if;
    return rid;
  end;

  insert into regie_position (regierapport_id, tarif_code, bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen)
  select rid, x.tarif_code, x.bezeichnung, x.menge_hundertstel, x.ansatz_rappen, x.betrag_rappen
  from jsonb_to_recordset(coalesce(p_positionen, '[]'::jsonb))
    as x(tarif_code text, bezeichnung text, menge_hundertstel int, ansatz_rappen int, betrag_rappen int);

  return rid;
end;
$$;

-- Rechte auf den RPCs: nur eingeloggte (auch anonyme) Sitzungen und die Service-Role.
revoke all on function zeit_freigeben(uuid[], uuid, text) from public;
revoke all on function zeit_korrigieren(uuid, int, uuid, text) from public;
revoke all on function zeit_team_setzen(uuid, int, uuid, text) from public;
revoke all on function regierapport_anlegen(uuid, uuid, uuid, jsonb) from public;
revoke all on function regierapport_nummer_naechste(int) from public;
grant execute on function zeit_freigeben(uuid[], uuid, text)              to authenticated, service_role;
grant execute on function zeit_korrigieren(uuid, int, uuid, text)         to authenticated, service_role;
grant execute on function zeit_team_setzen(uuid, int, uuid, text)         to authenticated, service_role;
grant execute on function regierapport_anlegen(uuid, uuid, uuid, jsonb)   to authenticated, service_role;
-- Der Trigger läuft als Definer (Besitzer) — die App braucht kein Execute auf dem Nummernzähler.
grant execute on function regierapport_nummer_naechste(int)               to service_role;

-- ── 8. Sicht regie_kennzahlen — eine Zeile fürs Bauführer-Dashboard ──────────
-- Alter eines Rapports = heute − (versendet_am, sonst erstellt_am), in Tagen (Europe/Zurich).

create or replace view regie_kennzahlen
with (security_invoker = true) as
with r as (
  select
    status, betrag_rappen, frist_bis, versendet_am,
    (current_date - (coalesce(versendet_am, erstellt_am) at time zone 'Europe/Zurich')::date) as alter_tage
  from regierapport
)
select
  count(*) filter (where status in ('versendet','rueckfrage'))                                   as beim_kunden_anzahl,
  coalesce(sum(betrag_rappen) filter (where status in ('versendet','rueckfrage')), 0)::bigint  as beim_kunden_rappen,
  count(*) filter (where status = 'frist_abgelaufen'
                      or (status = 'versendet' and frist_bis < current_date))                  as frist_abgelaufen_anzahl,
  count(*) filter (where status = 'entwurf')                                                   as entwuerfe_anzahl,
  coalesce(sum(betrag_rappen) filter (where status = 'entwurf'), 0)::bigint                    as entwuerfe_rappen,
  coalesce(sum(betrag_rappen) filter (
    where status <> 'entwurf'
      and versendet_am is not null
      and (versendet_am at time zone 'Europe/Zurich') >= date_trunc('month', now() at time zone 'Europe/Zurich')
  ), 0)::bigint                                                                                as monat_versendet_rappen,
  coalesce(sum(betrag_rappen) filter (where status <> 'bestaetigt' and alter_tage between 0 and 7), 0)::bigint   as in_arbeit_0_7_rappen,
  coalesce(sum(betrag_rappen) filter (where status <> 'bestaetigt' and alter_tage between 8 and 30), 0)::bigint  as in_arbeit_8_30_rappen,
  coalesce(sum(betrag_rappen) filter (where status <> 'bestaetigt' and alter_tage > 30), 0)::bigint              as in_arbeit_ueber_30_rappen
from r;

grant select on regie_kennzahlen to authenticated;

-- ── 9. Sichten regie_auswertung (Monat × Baustelle × Status) und regie_durchlauf ──

create or replace view regie_auswertung
with (security_invoker = true) as
select
  (date_trunc('month', coalesce(r.versendet_am, r.erstellt_am) at time zone 'Europe/Zurich'))::date as monat,
  r.baustelle_id,
  b.konto_nr,
  b.bezeichnung as baustelle_bezeichnung,
  b.kunde_id,
  k.name as kunde_name,
  r.status,
  count(*)::int as anzahl,
  coalesce(sum(r.betrag_rappen), 0)::bigint as summe_rappen
from regierapport r
join baustelle b on b.id = r.baustelle_id
left join kunde k on k.id = b.kunde_id
group by 1, r.baustelle_id, b.konto_nr, b.bezeichnung, b.kunde_id, k.name, r.status;

grant select on regie_auswertung to authenticated;

-- Durchlauf pro Rapport: bestellt (Zusatzauftrag) → versendet → bestätigt, in Tagen.
-- null, solange ein Schritt fehlt. Ein Median ist in SQL sperrig — das rechnet die Oberfläche.
create or replace view regie_durchlauf
with (security_invoker = true) as
select
  r.id,
  r.nummer,
  r.status,
  r.baustelle_id,
  b.konto_nr,
  b.bezeichnung as baustelle_bezeichnung,
  r.zusatzauftrag_id,
  z.bestellt_am,
  r.erstellt_am,
  r.versendet_am,
  r.bestaetigt_am,
  ((r.versendet_am  at time zone 'Europe/Zurich')::date - (z.bestellt_am   at time zone 'Europe/Zurich')::date) as tage_bestellt_bis_versendet,
  ((r.bestaetigt_am at time zone 'Europe/Zurich')::date - (r.versendet_am  at time zone 'Europe/Zurich')::date) as tage_versendet_bis_bestaetigt,
  ((r.bestaetigt_am at time zone 'Europe/Zurich')::date - (z.bestellt_am   at time zone 'Europe/Zurich')::date) as tage_bestellt_bis_bestaetigt
from regierapport r
join baustelle b on b.id = r.baustelle_id
left join zusatzauftrag z on z.id = r.zusatzauftrag_id;

grant select on regie_durchlauf to authenticated;

-- ── 10. Sicht zusatzauftrag_ohne_regie_gruende ───────────────────────────────

create or replace view zusatzauftrag_ohne_regie_gruende
with (security_invoker = true) as
select
  (date_trunc('month', erledigt_am at time zone 'Europe/Zurich'))::date as monat,
  erledigt_grund,
  count(*)::int as anzahl
from zusatzauftrag
where status = 'erledigt_ohne_regie' and erledigt_am is not null
group by 1, erledigt_grund;

grant select on zusatzauftrag_ohne_regie_gruende to authenticated;

-- ── 11. Fristenlauf: abgelaufene Fristen markieren, Erinnerung anstossen ──────

-- zustellung_log kennt das Ereignis 'frist_abgelaufen' bisher nicht → Check erweitern (additiv).
alter table zustellung_log drop constraint if exists zustellung_log_ereignis_check;
alter table zustellung_log
  add constraint zustellung_log_ereignis_check
  check (ereignis in ('gesendet','zugestellt','geoeffnet','link_geklickt','bestaetigt','rueckfrage','erinnert','frist_abgelaufen'));

-- Versendete Rapporte, deren Frist vorbei ist → status 'frist_abgelaufen' + Chronikeintrag. Gibt die Anzahl zurück.
create or replace function regie_fristen_pruefen()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  anzahl int;
begin
  with betroffen as (
    update regierapport
    set status = 'frist_abgelaufen'
    where status = 'versendet' and frist_bis is not null and frist_bis < current_date
    returning id, empfaenger_email, frist_bis
  )
  insert into zustellung_log (regierapport_id, an, ereignis, detail)
  select id, coalesce(empfaenger_email, 'kunde'), 'frist_abgelaufen', jsonb_build_object('frist_bis', frist_bis)
  from betroffen;

  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

-- Erinnerungsmail: ruft die Edge Function `regierapport-senden` mit { modus: 'erinnerung', regierapport_id } auf —
-- nur wenn pg_net installiert ist und in `konfiguration` die Schlüssel SUPABASE_URL und SUPABASE_ANON_KEY liegen.
-- Erinnert wird, wer nach Fristablauf noch nicht erinnert wurde (kein 'erinnert' seit dem Versand).
-- Den Chronikeintrag 'erinnert' schreibt die Edge Function — schlägt der Aufruf fehl, kommt der Rapport morgen wieder dran.
-- Ohne pg_net: Rückgabe 0; dann macht n8n den Aufruf (siehe supabase/functions/README.md).
create or replace function regie_erinnerungen_anstossen()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  basis text;
  anon_key text;
  r record;
  anzahl int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 0;
  end if;

  select wert into basis    from konfiguration k where k.schluessel = 'SUPABASE_URL';
  select wert into anon_key from konfiguration k where k.schluessel = 'SUPABASE_ANON_KEY';
  if basis is null or anon_key is null then
    return 0;
  end if;

  for r in
    select rr.id
    from regierapport rr
    where rr.status = 'frist_abgelaufen'
      and rr.empfaenger_email is not null
      and not exists (
        select 1 from zustellung_log l
        where l.regierapport_id = rr.id
          and l.ereignis = 'erinnert'
          and l.zeitpunkt >= coalesce(rr.versendet_am, rr.erstellt_am)
      )
  loop
    perform net.http_post(
      url     := rtrim(basis, '/') || '/functions/v1/regierapport-senden',
      body    := jsonb_build_object('modus', 'erinnerung', 'regierapport_id', r.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', anon_key,
        'Authorization', 'Bearer ' || anon_key
      )
    );
    anzahl := anzahl + 1;
  end loop;

  return anzahl;
end;
$$;

-- Täglicher Lauf: erst Fristen, dann Erinnerungen.
create or replace function regie_fristen_taeglich()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f int;
  e int;
begin
  f := regie_fristen_pruefen();
  e := regie_erinnerungen_anstossen();
  return jsonb_build_object('frist_abgelaufen', f, 'erinnerungen', e);
end;
$$;

revoke all on function regie_fristen_pruefen() from public;
revoke all on function regie_erinnerungen_anstossen() from public;
revoke all on function regie_fristen_taeglich() from public;
grant execute on function regie_fristen_pruefen()         to authenticated, service_role;
grant execute on function regie_erinnerungen_anstossen()  to service_role;
grant execute on function regie_fristen_taeglich()        to service_role;

-- pg_cron: täglich 06:00 Europe/Zurich. pg_cron rechnet in UTC → 04:00 UTC (Sommerzeit) bzw. 05:00 (Winterzeit).
-- Wir planen beide Stunden; der Lauf ist idempotent, ein zweiter Durchgang findet nichts mehr.
-- Voraussetzung: Dashboard → Database → Extensions → pg_cron (und pg_net für die Mails) einschalten.
-- Ohne pg_cron passiert hier nichts — dann `select regie_fristen_taeglich();` täglich aus n8n aufrufen (README).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('regie_fristen_0600_sommer', '0 4 * * *', $job$select public.regie_fristen_taeglich();$job$);
    perform cron.schedule('regie_fristen_0600_winter', '0 5 * * *', $job$select public.regie_fristen_taeglich();$job$);
  else
    raise notice 'pg_cron fehlt: Dashboard → Database → Extensions → pg_cron aktivieren und 0009 nochmals ausführen (oder n8n ruft regie_fristen_taeglich() täglich auf).';
  end if;
end $$;

-- ── 12. Storage-Policies «anhaenge»: lesen + hochladen, nie ändern, nie löschen (CLAUDE.md #8) ──
-- Folge für den Code: Uploads mit `upsert: true` scheitern jetzt (braucht Update-Recht).
-- src/lib/db.ts lädt darum ohne upsert und wertet «existiert schon» als Erfolg.

drop policy if exists anhaenge_authenticated_all    on storage.objects;
drop policy if exists anhaenge_authenticated_select on storage.objects;
drop policy if exists anhaenge_authenticated_insert on storage.objects;

create policy anhaenge_authenticated_select on storage.objects
  for select to authenticated
  using (bucket_id = 'anhaenge');

create policy anhaenge_authenticated_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anhaenge');

-- ── 13. Kleine Spalten ────────────────────────────────────────────────────────

alter table mitarbeiter  add column if not exists telefon text;
-- Für später: Meldung wurde durch eine neuere ersetzt (Doppelmeldung) — noch ohne Nutzung.
alter table tagesmeldung add column if not exists ersetzt_am timestamptz;

-- ── 14. Transkript der Sprachnotiz (Edge Function `transkribieren`) ──────────
-- `transkript` = deutscher Text (Arbeitshilfe), `transkript_quelle` = Original, falls übersetzt,
-- `transkript_sprache` = Sprachcode aus dem Mitarbeiterprofil (de/ar/pl/en), `transkript_fehler` = letzter Fehler.
alter table tagesmeldung add column if not exists transkript_sprache text check (transkript_sprache in ('de','ar','pl','en'));
alter table tagesmeldung add column if not exists transkript_fehler  text;
