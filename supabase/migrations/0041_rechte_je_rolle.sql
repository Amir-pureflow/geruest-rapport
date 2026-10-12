-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0041 · Rechte je Rolle in der Datenbank, Firmen-Bezüge, «heute» in Schweizer Zeit (13.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir 13.10.: «Die App darf keine Fehler haben. Es muss in der Produktion komplett ready sein.»
-- Bis hier trennte die Datenbank nur Firmen; was eine Rolle darf, stand nur in der Oberfläche (CLAUDE.md ⚠).
-- Ein Monteur-Zugang durfte an der Datenbank dasselbe wie der Bauführer. Ab hier:
--
--   Büro (Firmen-Zugang, Bauführer, Sekretariat): wie bisher alles in der eigenen Firma.
--   Chefmonteur: lesen; Tagesmeldung, Zeilen und Fotos melden; eine noch offene Meldung ersetzen (löschen);
--                die Sprachnotiz nachreichen (nur `audio_pfad`); die eigene Sprache ändern. Sonst nichts.
--   Monteur:     nur lesen.
--
-- Umgesetzt mit RESTRICTIVE-Regeln: sie gelten zusätzlich (UND) zu den Firmen-Regeln aus 0019/0036, die
-- unverändert bleiben. Lesen bleibt für alle Rollen der Firma offen. Dazu:
--   - Protokolle (`freigabe_log`, `zustellung_log`) nur anhängen: ändern nie, löschen nur in der Demo-Firma (Regel #8).
--   - Jede Zeile zeigt nur auf Zeilen der eigenen Firma (Team, Baustelle, Person, Meldung …).
--   - `firma.name`, `mail_domain`, `aktiv` und `ist_demo` ändert nur PureFlow (SQL), nicht die App.
--   - Die Demo erkennt die Datenbank an `firma.ist_demo`, nicht mehr am Namen.
--   - Freigeben/Korrigieren (RPCs) nur fürs Büro und nur in der eigenen Firma; «wer» ist immer die Sitzung.
--   - Konten verwalten nur aktive Büro-Zugänge (inaktive Person = kein Zugang, auch hier).
--   - Fristen- und Erinnerungs-Funktionen nur für den Zeitplan (cron), nicht für Anmeldungen.
--   - `tarif` nur lesen.
--   - «heute» auf dem Server = Schweizer Datum (die Datenbank läuft in UTC).
-- Wiederholbar.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Wer bin ich? Rolle der Sitzung
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 'buero' für Firmen-Zugang (Ansicht leer), Bauführer und Sekretariat; sonst die Ansicht ('chef', 'monteur').
-- null ohne aktiven Zugang — wie `aktuelle_firma()` (0034): inaktive Person = keine Rolle.

create or replace function aktuelle_rolle()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when b.ansicht is null or b.ansicht in ('bauf', 'sekretariat') then 'buero' else b.ansicht end
    from benutzer b
    left join mitarbeiter m on m.id = b.mitarbeiter_id
   where b.auth_user_id = auth.uid()
     and (b.mitarbeiter_id is null or m.aktiv);
$$;

create or replace function ist_buero()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(aktuelle_rolle() = 'buero', false);
$$;

/** Person hinter dem Zugang (null bei Firmen-Zugängen). */
create or replace function eigene_person()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.mitarbeiter_id from benutzer b where b.auth_user_id = auth.uid();
$$;

revoke all on function aktuelle_rolle() from public, anon;
revoke all on function ist_buero() from public, anon;
revoke all on function eigene_person() from public, anon;
grant execute on function aktuelle_rolle() to authenticated, service_role;
grant execute on function ist_buero() to authenticated, service_role;
grant execute on function eigene_person() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Demo-Firma als Merkmal, Firmen-Stammdaten nur durch PureFlow
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Bisher hing «Demo» am Namen 'We-Plan' — und den Namen durfte jede Sitzung der Firma ändern.

alter table firma add column if not exists ist_demo boolean not null default false;
update firma set ist_demo = (name = 'We-Plan') where ist_demo is distinct from (name = 'We-Plan');

create or replace function ist_demo_firma()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.ist_demo from firma f where f.id = aktuelle_firma()), false);
$$;
revoke all on function ist_demo_firma() from public, anon;
grant execute on function ist_demo_firma() to authenticated, service_role;

create or replace function firma_schutz()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id is distinct from old.id
    or new.name is distinct from old.name
    or new.mail_domain is distinct from old.mail_domain
    or new.aktiv is distinct from old.aktiv
    or new.ist_demo is distinct from old.ist_demo
  ) then
    raise exception 'Name, Mail-Domain und Status der Firma ändert nur PureFlow.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists firma_schutz on firma;
create trigger firma_schutz before update on firma for each row execute function firma_schutz();

create or replace function demo_verlauf_leeren()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := aktuelle_firma();
  n integer;
begin
  if f is null or not exists (select 1 from firma where id = f and ist_demo) or not ist_buero() then
    raise exception 'Nur in der Demo-Firma';
  end if;
  delete from plan_verlauf where firma_id = f;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Schreiben je Rolle (RESTRICTIVE — zusätzlich zu den Firmen-Regeln)
-- ────────────────────────────────────────────────────────────────────────────────────────────

-- Tabellen, in die nur das Büro schreibt
do $$
declare t text;
begin
  foreach t in array array[
    'team', 'team_mitglied', 'baustelle', 'kunde', 'jahresplan', 'planaenderung', 'einsatz_person',
    'abwesenheit', 'zusatzauftrag', 'regierapport', 'regie_position'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_rolle_neu', t);
    execute format('drop policy if exists %I on %I', t || '_rolle_aendern', t);
    execute format('drop policy if exists %I on %I', t || '_rolle_loeschen', t);
    execute format('create policy %I on %I as restrictive for insert to authenticated with check (ist_buero())', t || '_rolle_neu', t);
    execute format('create policy %I on %I as restrictive for update to authenticated using (ist_buero()) with check (ist_buero())', t || '_rolle_aendern', t);
    execute format('create policy %I on %I as restrictive for delete to authenticated using (ist_buero())', t || '_rolle_loeschen', t);
  end loop;
end $$;

-- Firma: Einstellungen und Briefkopf nur das Büro (welche Spalten, regelt zusätzlich `firma_schutz`)
drop policy if exists firma_rolle_aendern on firma;
create policy firma_rolle_aendern on firma as restrictive for update to authenticated
  using (ist_buero()) with check (ist_buero());

-- Mitarbeitende: das Büro; der Chefmonteur nur die eigene Zeile (Sprache, siehe Abschnitt 4)
drop policy if exists mitarbeiter_rolle_neu on mitarbeiter;
drop policy if exists mitarbeiter_rolle_aendern on mitarbeiter;
drop policy if exists mitarbeiter_rolle_loeschen on mitarbeiter;
create policy mitarbeiter_rolle_neu on mitarbeiter as restrictive for insert to authenticated
  with check (ist_buero());
create policy mitarbeiter_rolle_aendern on mitarbeiter as restrictive for update to authenticated
  using (ist_buero() or (aktuelle_rolle() = 'chef' and id = eigene_person()))
  with check (ist_buero() or (aktuelle_rolle() = 'chef' and id = eigene_person()));
create policy mitarbeiter_rolle_loeschen on mitarbeiter as restrictive for delete to authenticated
  using (ist_buero());

-- Tagesmeldung: melden darf der Chefmonteur; löschen (ersetzen) nur, solange keine Zeile freigegeben ist
drop policy if exists tagesmeldung_rolle_neu on tagesmeldung;
drop policy if exists tagesmeldung_rolle_aendern on tagesmeldung;
drop policy if exists tagesmeldung_rolle_loeschen on tagesmeldung;
create policy tagesmeldung_rolle_neu on tagesmeldung as restrictive for insert to authenticated
  with check (ist_buero() or aktuelle_rolle() = 'chef');
create policy tagesmeldung_rolle_aendern on tagesmeldung as restrictive for update to authenticated
  using (ist_buero() or aktuelle_rolle() = 'chef')
  with check (ist_buero() or aktuelle_rolle() = 'chef');
create policy tagesmeldung_rolle_loeschen on tagesmeldung as restrictive for delete to authenticated
  using (ist_buero() or (aktuelle_rolle() = 'chef' and not exists (
    select 1 from zeiteintrag z where z.tagesmeldung_id = tagesmeldung.id and z.status <> 'offen'
  )));

-- Zeiteinträge: der Chefmonteur meldet und ersetzt nur offene; ändern (korrigieren, freigeben) nur das Büro
drop policy if exists zeiteintrag_rolle_neu on zeiteintrag;
drop policy if exists zeiteintrag_rolle_aendern on zeiteintrag;
drop policy if exists zeiteintrag_rolle_loeschen on zeiteintrag;
create policy zeiteintrag_rolle_neu on zeiteintrag as restrictive for insert to authenticated
  with check (ist_buero() or (aktuelle_rolle() = 'chef' and status = 'offen'));
create policy zeiteintrag_rolle_aendern on zeiteintrag as restrictive for update to authenticated
  using (ist_buero()) with check (ist_buero());
create policy zeiteintrag_rolle_loeschen on zeiteintrag as restrictive for delete to authenticated
  using (ist_buero() or (aktuelle_rolle() = 'chef' and status = 'offen'));

-- Fotos: melden darf der Chefmonteur; ändern und löschen nur das Büro
drop policy if exists foto_rolle_neu on foto;
drop policy if exists foto_rolle_aendern on foto;
drop policy if exists foto_rolle_loeschen on foto;
create policy foto_rolle_neu on foto as restrictive for insert to authenticated
  with check (ist_buero() or aktuelle_rolle() = 'chef');
create policy foto_rolle_aendern on foto as restrictive for update to authenticated
  using (ist_buero()) with check (ist_buero());
create policy foto_rolle_loeschen on foto as restrictive for delete to authenticated
  using (ist_buero());

-- Protokolle: nur anhängen (Regel #7/#8). Löschen nur beim Zurücksetzen der Demo-Firma.
do $$
declare t text;
begin
  foreach t in array array['freigabe_log', 'zustellung_log'] loop
    execute format('drop policy if exists %I on %I', t || '_rolle_neu', t);
    execute format('drop policy if exists %I on %I', t || '_rolle_aendern', t);
    execute format('drop policy if exists %I on %I', t || '_rolle_loeschen', t);
    execute format('create policy %I on %I as restrictive for insert to authenticated with check (ist_buero())', t || '_rolle_neu', t);
    execute format('create policy %I on %I as restrictive for update to authenticated using (false) with check (false)', t || '_rolle_aendern', t);
    execute format('create policy %I on %I as restrictive for delete to authenticated using (ist_buero() and ist_demo_firma())', t || '_rolle_loeschen', t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Welche Spalten Chefmonteur und Monteur ändern dürfen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Regeln kennen keine Spalten; das prüft ein Auslöser. Erlaubt sind nur die Spalten in den Argumenten.
-- Edge Functions (Service-Role) und das Büro sind nicht betroffen.

create or replace function rolle_spalten_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' or ist_buero() then
    return new;
  end if;
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception 'Das darf nur das Büro ändern.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tagesmeldung_rolle_spalten on tagesmeldung;
create trigger tagesmeldung_rolle_spalten before update on tagesmeldung
  for each row execute function rolle_spalten_pruefen('audio_pfad');

drop trigger if exists mitarbeiter_rolle_spalten on mitarbeiter;
create trigger mitarbeiter_rolle_spalten before update on mitarbeiter
  for each row execute function rolle_spalten_pruefen('sprache');

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Verweise nur innerhalb der eigenen Firma
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Die Regeln prüfen die Firma der Zeile, nicht die der Zeilen, auf die sie zeigt. Ohne diese Prüfung liesse sich eine
-- Meldung der eigenen Firma an das Team oder die Baustelle einer fremden hängen (Fremdschlüssel prüfen keine Rechte).
-- Argumente: 'spalte:tabelle'. Tabellen ohne eigene `firma_id` (team_mitglied) nehmen die Firma des ersten Verweises.

create or replace function firma_bezuege_pruefen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  neu    jsonb := to_jsonb(new);
  alt    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  eigene uuid  := (neu ->> 'firma_id')::uuid;
  paar   text;
  spalte text;
  wert   text;
  f      uuid;
begin
  foreach paar in array tg_argv loop
    spalte := split_part(paar, ':', 1);
    wert := neu ->> spalte;
    continue when wert is null or wert is not distinct from (alt ->> spalte);
    execute format('select firma_id from %I where id = $1', split_part(paar, ':', 2)) into f using wert::uuid;
    continue when f is null;  -- gibt es die Zeile nicht, meldet das der Fremdschlüssel
    if eigene is null then
      eigene := f;
    elsif f <> eigene then
      raise exception 'Verweis auf eine andere Firma (%.%)', tg_table_name, spalte using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists tagesmeldung_firma_bezuege on tagesmeldung;
create trigger tagesmeldung_firma_bezuege before insert or update on tagesmeldung
  for each row execute function firma_bezuege_pruefen('team_id:team', 'baustelle_id:baustelle');

drop trigger if exists zeiteintrag_firma_bezuege on zeiteintrag;
create trigger zeiteintrag_firma_bezuege before insert or update on zeiteintrag
  for each row execute function firma_bezuege_pruefen('tagesmeldung_id:tagesmeldung', 'mitarbeiter_id:mitarbeiter', 'baustelle_id:baustelle');

drop trigger if exists jahresplan_firma_bezuege on jahresplan;
create trigger jahresplan_firma_bezuege before insert or update on jahresplan
  for each row execute function firma_bezuege_pruefen('team_id:team', 'baustelle_id:baustelle');

drop trigger if exists team_firma_bezuege on team;
create trigger team_firma_bezuege before insert or update on team
  for each row execute function firma_bezuege_pruefen('chefmonteur_id:mitarbeiter');

drop trigger if exists team_mitglied_firma_bezuege on team_mitglied;
create trigger team_mitglied_firma_bezuege before insert or update on team_mitglied
  for each row execute function firma_bezuege_pruefen('team_id:team', 'mitarbeiter_id:mitarbeiter');

drop trigger if exists baustelle_firma_bezuege on baustelle;
create trigger baustelle_firma_bezuege before insert or update on baustelle
  for each row execute function firma_bezuege_pruefen('kunde_id:kunde');

drop trigger if exists regierapport_firma_bezuege on regierapport;
create trigger regierapport_firma_bezuege before insert or update on regierapport
  for each row execute function firma_bezuege_pruefen('baustelle_id:baustelle', 'tagesmeldung_id:tagesmeldung', 'zusatzauftrag_id:zusatzauftrag');

drop trigger if exists zusatzauftrag_firma_bezuege on zusatzauftrag;
create trigger zusatzauftrag_firma_bezuege before insert or update on zusatzauftrag
  for each row execute function firma_bezuege_pruefen('baustelle_id:baustelle');

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Freigeben und Korrigieren: nur das Büro, nur die eigene Firma, «wer» = Sitzung
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function zeit_freigeben(p_ids uuid[], p_wer uuid, p_grund text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  anzahl int;
begin
  if not ist_buero() then
    raise exception 'Freigeben darf nur das Büro.' using errcode = '42501';
  end if;
  p_wer := coalesce(auth.uid(), p_wer);
  if p_wer is null then
    raise exception 'zeit_freigeben: p_wer (wer gibt frei) fehlt';
  end if;

  with betroffen as (
    update zeiteintrag
    set status = 'freigegeben'
    where id = any(p_ids) and status = 'offen' and firma_id = aktuelle_firma()
    returning id
  )
  insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
  select id, p_wer, 'status', 'offen', 'freigegeben', nullif(trim(p_grund), '')
  from betroffen;

  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

create or replace function zeit_korrigieren(p_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alt_normal int;
  alt_ueber  int;
  normaltag  int;
  neu_normal int;
  neu_ueber  int;
begin
  if not ist_buero() then
    raise exception 'Korrigieren darf nur das Büro.' using errcode = '42501';
  end if;
  p_wer := coalesce(auth.uid(), p_wer);
  if p_wer is null then
    raise exception 'zeit_korrigieren: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_korrigieren: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_korrigieren: Gesamtminuten müssen >= 0 sein';
  end if;

  select z.normal_min, z.ueber_min, coalesce(f.normaltag_min, 504)
    into alt_normal, alt_ueber, normaltag
  from zeiteintrag z
  left join firma f on f.id = z.firma_id
  where z.id = p_id and z.firma_id = aktuelle_firma()
  for update of z;
  if not found then
    raise exception 'zeit_korrigieren: Zeiteintrag % nicht gefunden', p_id;
  end if;

  neu_normal := least(p_total_min, normaltag);
  neu_ueber  := greatest(0, p_total_min - normaltag);

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

create or replace function zeit_team_setzen(p_tagesmeldung_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  z record;
  anzahl int := 0;
  normaltag  int;
  neu_normal int;
  neu_ueber  int;
begin
  if not ist_buero() then
    raise exception 'Korrigieren darf nur das Büro.' using errcode = '42501';
  end if;
  p_wer := coalesce(auth.uid(), p_wer);
  if p_wer is null then
    raise exception 'zeit_team_setzen: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_team_setzen: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_team_setzen: Gesamtminuten müssen >= 0 sein';
  end if;

  select coalesce(f.normaltag_min, 504) into normaltag
  from tagesmeldung t
  left join firma f on f.id = t.firma_id
  where t.id = p_tagesmeldung_id and t.firma_id = aktuelle_firma();
  if not found then
    raise exception 'zeit_team_setzen: Meldung % nicht gefunden', p_tagesmeldung_id;
  end if;

  neu_normal := least(p_total_min, normaltag);
  neu_ueber  := greatest(0, p_total_min - normaltag);

  for z in
    select id, normal_min, ueber_min
    from zeiteintrag
    where tagesmeldung_id = p_tagesmeldung_id and status = 'offen' and firma_id = aktuelle_firma()
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

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Konten verwalten nur aktive Zugänge
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Bisher las `konten_recht` die Firma ohne `mitarbeiter.aktiv`: eine deaktivierte Büro-Person hätte mit ihrem noch
-- gültigen Login einem aktiven Konto ein neues Passwort setzen können.

create or replace function konten_recht(p_rolle text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_firma uuid;
  v_ich   text;
begin
  select b.firma_id, b.ansicht into v_firma, v_ich
    from benutzer b
    left join mitarbeiter m on m.id = b.mitarbeiter_id
   where b.auth_user_id = auth.uid()
     and (b.mitarbeiter_id is null or m.aktiv);
  if v_firma is null then raise exception 'Kein Zugang.'; end if;
  if v_ich in ('chef', 'monteur') then raise exception 'Konten verwaltet das Büro.'; end if;
  if v_ich = 'bauf' and p_rolle = 'sekretariat' then
    raise exception 'Konten fürs Sekretariat verwaltet das Sekretariat.';
  end if;
  return v_firma;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 8. Funktionen, die nur der Zeitplan oder Auslöser aufrufen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Supabase gibt neuen Funktionen `execute` für `authenticated`; 0009/0035 hatten nur public/anon entzogen.
-- Der Zeitplan (cron) läuft als Eigentümer und braucht das Recht nicht.

revoke execute on function regie_fristen_taeglich() from public, anon, authenticated;
revoke execute on function regie_fristen_pruefen() from public, anon, authenticated;
revoke execute on function regie_erinnerungen_anstossen() from public, anon, authenticated;
revoke execute on function regierapport_nummer_naechste(int) from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 9. «heute» = Schweizer Datum
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- `current_date` ist in UTC: zwischen Mitternacht und 01:00/02:00 Schweizer Zeit noch «gestern».

create or replace function regie_fristen_pruefen()
returns integer
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
    where status = 'versendet' and frist_bis is not null and frist_bis < (now() at time zone 'Europe/Zurich')::date
    returning id, empfaenger_email, frist_bis
  )
  insert into zustellung_log (regierapport_id, an, ereignis, detail)
  select id, coalesce(empfaenger_email, 'kunde'), 'frist_abgelaufen', jsonb_build_object('frist_bis', frist_bis)
  from betroffen;

  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

create or replace view regie_kennzahlen with (security_invoker = true) as
 WITH r AS (
         SELECT regierapport.status,
            regierapport.betrag_rappen,
            regierapport.frist_bis,
            regierapport.versendet_am,
            (now() AT TIME ZONE 'Europe/Zurich'::text)::date - (COALESCE(regierapport.versendet_am, regierapport.erstellt_am) AT TIME ZONE 'Europe/Zurich'::text)::date AS alter_tage
           FROM regierapport
        )
 SELECT count(*) FILTER (WHERE status = ANY (ARRAY['versendet'::text, 'rueckfrage'::text])) AS beim_kunden_anzahl,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status = ANY (ARRAY['versendet'::text, 'rueckfrage'::text])), 0::bigint) AS beim_kunden_rappen,
    count(*) FILTER (WHERE status = 'frist_abgelaufen'::text OR status = 'versendet'::text AND frist_bis < (now() AT TIME ZONE 'Europe/Zurich'::text)::date) AS frist_abgelaufen_anzahl,
    count(*) FILTER (WHERE status = 'entwurf'::text) AS entwuerfe_anzahl,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status = 'entwurf'::text), 0::bigint) AS entwuerfe_rappen,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status <> 'entwurf'::text AND versendet_am IS NOT NULL AND (versendet_am AT TIME ZONE 'Europe/Zurich'::text) >= date_trunc('month'::text, (now() AT TIME ZONE 'Europe/Zurich'::text))), 0::bigint) AS monat_versendet_rappen,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status <> 'bestaetigt'::text AND alter_tage >= 0 AND alter_tage <= 7), 0::bigint) AS in_arbeit_0_7_rappen,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status <> 'bestaetigt'::text AND alter_tage >= 8 AND alter_tage <= 30), 0::bigint) AS in_arbeit_8_30_rappen,
    COALESCE(sum(betrag_rappen) FILTER (WHERE status <> 'bestaetigt'::text AND alter_tage > 30), 0::bigint) AS in_arbeit_ueber_30_rappen
   FROM r;

create or replace view zusatzauftrag_stand with (security_invoker = true) as
 SELECT z.id,
    z.client_uuid,
    z.baustelle_id,
    z.besteller_name,
    z.besteller_rolle,
    z.bestellt_am,
    z.kanal,
    z.taetigkeit,
    z.geplant_fuer,
    z.notiz,
    z.status,
    z.erledigt_grund,
    z.erledigt_am,
    z.erledigt_von,
    b.konto_nr,
    b.bezeichnung AS baustelle_bezeichnung,
        CASE
            WHEN z.status = 'erledigt_ohne_regie'::text THEN 'erledigt_ohne_regie'::text
            WHEN r.status = 'bestaetigt'::text THEN 'bestaetigt'::text
            WHEN r.status = ANY (ARRAY['versendet'::text, 'rueckfrage'::text, 'frist_abgelaufen'::text]) THEN 'beim_kunden'::text
            WHEN r.id IS NOT NULL THEN 'im_regierapport'::text
            WHEN m.id IS NOT NULL THEN 'gemeldet'::text
            ELSE 'bestellt'::text
        END AS stand,
    m.datum AS gemeldet_am,
    m.team_bezeichnung AS gemeldet_von_team,
    r.id AS regierapport_id,
    r.nummer AS regierapport_nummer,
    r.status AS regierapport_status,
    z.status = 'offen'::text AND r.id IS NULL AND m.id IS NULL AND z.geplant_fuer IS NOT NULL AND z.geplant_fuer < (now() AT TIME ZONE 'Europe/Zurich'::text)::date AS ohne_meldung,
    b.kunde_id,
    k.name AS kunde_name,
    k.email AS kunde_email,
    k.ansprechperson AS kunde_ansprechperson,
    COALESCE(k.anzeige_noetig, true) AS anzeige_noetig,
    z.angezeigt_am,
    z.angezeigt_an
   FROM zusatzauftrag z
     JOIN baustelle b ON b.id = z.baustelle_id
     LEFT JOIN kunde k ON k.id = b.kunde_id
     LEFT JOIN LATERAL ( SELECT r_1.id,
            r_1.nummer,
            r_1.status
           FROM regierapport r_1
          WHERE r_1.zusatzauftrag_id = z.id
          ORDER BY r_1.erstellt_am DESC
         LIMIT 1) r ON true
     LEFT JOIN LATERAL ( SELECT t.id,
            t.datum,
            tm.bezeichnung AS team_bezeichnung
           FROM tagesmeldung t
             LEFT JOIN team tm ON tm.id = t.team_id
          WHERE t.baustelle_id = z.baustelle_id AND t.datum >= (z.bestellt_am AT TIME ZONE 'Europe/Zurich'::text)::date AND (t.normalfall = false AND (t.abweichung_typ = ANY (ARRAY['zusaetzlich'::text, 'kaputt'::text])) OR (EXISTS ( SELECT 1
                   FROM zeiteintrag ze
                  WHERE ze.tagesmeldung_id = t.id AND ze.ueber_min > 0)))
          ORDER BY t.datum
         LIMIT 1) m ON true;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 10. SGUV-Ansätze: alle lesen, niemand ändert (0001 hatte «alles für alle» stehen lassen)
-- ────────────────────────────────────────────────────────────────────────────────────────────

drop policy if exists tarif_authenticated_all on tarif;
drop policy if exists tarif_lesen on tarif;
create policy tarif_lesen on tarif for select to authenticated using (true);

notify pgrst, 'reload schema';
