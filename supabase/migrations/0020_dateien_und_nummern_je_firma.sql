-- 0020: Zwei Lücken aus 0019 schliessen (02.10.2026).
--
-- 0019 hat die Tabellen getrennt. Zwei Dinge blieben firmenübergreifend und fallen erst auf,
-- wenn man gezielt danach sucht:
--
--   1. Der Dateispeicher. Fotos, Sprachnotizen und Rapport-PDFs liegen im Eimer `anhaenge`,
--      und die Regel dort erlaubte jeder angemeldeten Sitzung alles. Die Pfade sind zufällige
--      Nummern, man müsste sie also raten — aber darauf baut man keine Trennung.
--   2. Die Rapportnummern liefen aus einem gemeinsamen Zähler. Jede Firma sah nur ihre eigenen,
--      darum entstanden Lücken (RR-2026-0031, dann 0034).
--
-- Die Dateipfade verraten, wem die Datei gehört:
--   audio/<client_uuid>.webm        → tagesmeldung.client_uuid
--   fotos/<client_uuid>/<id>.jpg    → tagesmeldung.client_uuid
--   rapporte/<regierapport_id>.pdf  → regierapport.id
-- Darüber hängt jede Datei an einer Zeile, die ihre Firma schon kennt.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Dateien: nur die eigenen
-- ════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Gehört diese Datei im Eimer `anhaenge` der angemeldeten Firma?
 *
 * `security definer`, damit die Prüfung auf `tagesmeldung` und `regierapport` nicht selbst
 * wieder durch deren Regeln muss. Unbekannte Ordner gehören niemandem und sind damit gesperrt.
 */
create or replace function anhang_gehoert_firma(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select case (storage.foldername(p_name))[1]
    when 'audio' then exists (
      select 1 from tagesmeldung m
       where m.firma_id = aktuelle_firma()
         and m.client_uuid::text = regexp_replace(storage.filename(p_name), '\.[^.]+$', '')
    )
    when 'fotos' then exists (
      select 1 from tagesmeldung m
       where m.firma_id = aktuelle_firma()
         and m.client_uuid::text = (storage.foldername(p_name))[2]
    )
    when 'rapporte' then exists (
      select 1 from regierapport r
       where r.firma_id = aktuelle_firma()
         and r.id::text = regexp_replace(storage.filename(p_name), '\.[^.]+$', '')
    )
    else false
  end;
$$;

revoke all on function anhang_gehoert_firma(text) from public;
grant execute on function anhang_gehoert_firma(text) to authenticated;

-- Alle bestehenden Regeln auf `storage.objects` weg, die den Eimer `anhaenge` betreffen.
-- Nicht nach Namen: hiesse eine davon anders als erwartet, bliebe sie stehen und würde die neue
-- aushebeln (Regeln gelten als ODER). Regeln anderer Eimer bleiben unberührt.
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (qual ilike '%anhaenge%' or with_check ilike '%anhaenge%' or policyname ilike '%anhaenge%')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy anhaenge_firma_lesen on storage.objects
  for select to authenticated
  using (bucket_id = 'anhaenge' and anhang_gehoert_firma(name));

-- Hochladen darf nur, wer die Datei an eine eigene Meldung hängt. Die Meldung steht beim
-- Senden schon in der Datenbank (src/lib/db.ts: erst die Meldung, dann der Beleg).
create policy anhaenge_firma_schreiben on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anhaenge' and anhang_gehoert_firma(name));

-- Löschen und Überschreiben bleiben gesperrt: Belege werden nie gelöscht (CLAUDE.md #8).
-- Die Edge Functions arbeiten mit der Service-Role und sind von all dem nicht betroffen.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Rapportnummern je Firma
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table regierapport_nummer_lauf add column if not exists firma_id uuid references firma (id);

-- Der bisherige Zähler gehört We-Plan, dort stehen alle bestehenden Rapporte.
update regierapport_nummer_lauf
   set firma_id = (select id from firma where name = 'We-Plan')
 where firma_id is null;

delete from regierapport_nummer_lauf where firma_id is null;

alter table regierapport_nummer_lauf drop constraint if exists regierapport_nummer_lauf_pkey;
alter table regierapport_nummer_lauf add primary key (firma_id, jahr);

/**
 * Nächste Rapportnummer der angemeldeten Firma. Jede Firma zählt für sich ab 1.
 * Wird aus `regierapport_anlegen` aufgerufen, das als Aufrufer läuft — `aktuelle_firma()` gilt also.
 */
create or replace function regierapport_nummer_naechste(p_jahr int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma uuid;
  n int;
  kandidat text;
begin
  v_firma := aktuelle_firma();
  if v_firma is null then
    raise exception 'Keine Firma angemeldet — Rapportnummer nicht möglich';
  end if;

  insert into regierapport_nummer_lauf (firma_id, jahr, letzte) values (v_firma, p_jahr, 0)
  on conflict (firma_id, jahr) do nothing;

  select letzte into n from regierapport_nummer_lauf where firma_id = v_firma and jahr = p_jahr for update;

  loop
    n := n + 1;
    kandidat := format('RR-%s-%s', p_jahr, lpad(n::text, 4, '0'));
    exit when not exists (select 1 from regierapport where nummer = kandidat and firma_id = v_firma);
  end loop;

  update regierapport_nummer_lauf set letzte = n where firma_id = v_firma and jahr = p_jahr;
  return kandidat;
end;
$$;

revoke all on function regierapport_nummer_naechste(int) from public;
grant execute on function regierapport_nummer_naechste(int) to authenticated, service_role;

-- Nummern sind nur innerhalb der Firma eindeutig, nicht mehr weltweit.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'regierapport'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (nummer)'
  loop
    execute format('alter table regierapport drop constraint %I', r.conname);
  end loop;
end $$;

drop index if exists regierapport_nummer_key;
create unique index if not exists regierapport_firma_nummer_key on regierapport (firma_id, nummer) where nummer is not null;

-- ── Probe ────────────────────────────────────────────────────────────────────────────────────
select f.name, l.jahr, l.letzte as letzte_nummer
  from firma f
  left join regierapport_nummer_lauf l on l.firma_id = f.id
 order by f.name;
