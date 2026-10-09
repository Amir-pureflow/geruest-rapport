-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0034 · Benutzerkonten aus der Verwaltung anlegen (10.10.2026, Erin)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Der Bauführer erfasst eine Person in Verwaltung → Mitarbeitende und gibt ihr gleich ein Konto:
-- Adresse `vorname.nachname@firma`, Passwort, Rolle Monteur, Chefmonteur, Bauführer oder Sekretariat.
-- Kein Supabase-Dashboard, keine Edge Function — Funktionen hier, aufgerufen aus der App
-- (src/seiten/verwaltung/Konto.tsx).
--
-- Warum Datenbankfunktionen und keine Edge Function: Funktionen lassen sich nur mit Supabase-CLI oder
-- im Dashboard ausliefern, und daran ist der Einladungslink (0032) gescheitert. Eine Migration läuft
-- im SQL-Editor, wie alle anderen.
--
-- Adressen: `vorname.nachname@<Domain der Firma>` (Erin, 10.10.2026). Die Domain steht neu in
-- `firma.mail_domain` — Gerüst GmbH: `geruest.ch`. Ohne Domain gilt `rapporto.pureflow-ai.com`.
-- Es wird nie eine Mail verschickt (Supabase › «Confirm email» ist aus); die Adresse ist nur der Login.
-- Die Funktionen schreiben direkt in `auth.users` und `auth.identities`, so wie Supabase selbst es
-- tut. ⚠ Ändert Supabase dort einmal Pflichtspalten, scheitert «Konto anlegen» mit einer Meldung —
-- dann diese Funktion nachführen. Bestehende Konten sind davon nicht betroffen.
--
-- Rechte — hier zum ersten Mal **in der Datenbank** nach Rolle getrennt (Abschnitt 2): Konten verwaltet
-- nur das Büro; Sekretariats-Konten nur Inhaber und Sekretariat, nicht der Bauführer (Lohn). Das eigene
-- Konto löschen oder die eigene Rolle ändern geht nicht. Ein Monteur-Handy kann gar nichts davon,
-- auch nicht mit eigenem Programm.
--
-- Zudem: Wer in der Verwaltung **inaktiv** gesetzt oder gelöscht wird, verliert seinen Zugang sofort
-- (`aktuelle_firma()` unten). Temporärer weg → Konto aus, ohne dass jemand daran denken muss.

create extension if not exists pgcrypto with schema extensions;

-- Falls 0033 noch fehlt — sonst ohne Wirkung.
alter table benutzer add column if not exists mitarbeiter_id uuid;
alter table benutzer add column if not exists ansicht text;
alter table benutzer drop constraint if exists benutzer_ansicht_check;
alter table benutzer add constraint benutzer_ansicht_check
  check (ansicht is null or ansicht in ('bauf', 'sekretariat', 'chef', 'monteur'));

-- Person gelöscht → Zugang weg (0033 hatte «set null»: dann hätte das Konto als Firmen-Zugang weitergelebt).
alter table benutzer drop constraint if exists benutzer_mitarbeiter_id_fkey;
alter table benutzer add constraint benutzer_mitarbeiter_id_fkey
  foreign key (mitarbeiter_id) references mitarbeiter (id) on delete cascade;

-- Eine Person, ein Konto.
create unique index if not exists benutzer_mitarbeiter_eindeutig on benutzer (mitarbeiter_id) where mitarbeiter_id is not null;

-- Domain je Firma
alter table firma add column if not exists mail_domain text;
alter table firma drop constraint if exists firma_mail_domain_check;
alter table firma add constraint firma_mail_domain_check
  check (mail_domain is null or mail_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');
update firma set mail_domain = 'geruest.ch' where name = 'Gerüst GmbH' and mail_domain is null;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 0. Bestehende Zugänge auf die neue Form umstellen. Passwort und angemeldete Geräte bleiben.
-- ────────────────────────────────────────────────────────────────────────────────────────────
/** Mailadresse eines Zugangs ändern — in auth.users und in der Identität, sonst klemmt die Anmeldung. */
create or replace function zugang_umbenennen(p_alt text, p_neu text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_alt);
  if v_uid is null then return; end if;                                       -- gibt es nicht (mehr)
  if exists (select 1 from auth.users where lower(email) = lower(p_neu)) then return; end if;  -- schon umgestellt
  update auth.users set email = lower(p_neu), updated_at = now() where id = v_uid;
  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(lower(p_neu)))
   where user_id = v_uid and provider = 'email';
end;
$$;
revoke all on function zugang_umbenennen(text, text) from public;

-- Arbnors Firmen-Zugang (Erin, 10.10.2026)
select zugang_umbenennen('arbnor@rapporto.pureflow-ai.com', 'arbnor.arifi@geruest.ch');

-- Personen-Zugänge, die noch auf der Ersatz-Domain laufen, aber deren Firma jetzt eine eigene hat
-- (z. B. nuhi.vaiti@rapporto.pureflow-ai.com aus 0033 → nuhi.vaiti@geruest.ch)
select zugang_umbenennen(u.email, split_part(u.email, '@', 1) || '@' || f.mail_domain)
  from benutzer b
  join auth.users u on u.id = b.auth_user_id
  join firma f      on f.id = b.firma_id
 where b.mitarbeiter_id is not null
   and f.mail_domain is not null
   and lower(u.email) like '%@rapporto.pureflow-ai.com';

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Inaktiv heisst: kein Zugang mehr
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Gleiche Signatur wie 0019 — alle Regeln, die damit vergleichen, bleiben, wie sie sind.
create or replace function aktuelle_firma()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.firma_id
    from benutzer b
    left join mitarbeiter m on m.id = b.mitarbeiter_id
   where b.auth_user_id = auth.uid()
     and (b.mitarbeiter_id is null or m.aktiv);
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Wer darf welche Rolle vergeben? (Erin, 10.10.2026: «Was ist, wenn eine Sekretärin kommt?»)
-- ────────────────────────────────────────────────────────────────────────────────────────────
--   Firmen-Zugang (Inhaber, Ansicht leer) und Sekretariat: alle vier Rollen.
--   Bauführer: Monteur, Chefmonteur, Bauführer — **nicht Sekretariat**. Lohn sieht nur das Sekretariat
--   (Bauführer 20.09.: «kein Zugriff hier drauf»); sonst könnte er sich selbst ein Sekretariats-Konto machen.
--   Monteur und Chefmonteur: gar nichts.
-- Gilt für Anlegen, Passwort, Rolle ändern und Löschen — jeweils für die Rolle des betroffenen Kontos.

/**
 * Firma des Aufrufers, wenn er Konten der Rolle `p_rolle` verwalten darf. Sonst Fehler.
 * `p_rolle` null: nur lesen (Liste der Konten) — dafür reicht jeder Büro-Zugang.
 */
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
  select b.firma_id, b.ansicht into v_firma, v_ich from benutzer b where b.auth_user_id = auth.uid();
  if v_firma is null then raise exception 'Kein Zugang.'; end if;
  if v_ich in ('chef', 'monteur') then raise exception 'Konten verwaltet das Büro.'; end if;
  if v_ich = 'bauf' and p_rolle = 'sekretariat' then
    raise exception 'Konten fürs Sekretariat verwaltet das Sekretariat.';
  end if;
  return v_firma;
end;
$$;

revoke all on function konten_recht(text) from public;

/** Konto einer Person dieser Firma: Zugang und Rolle. Fehler, wenn es keines gibt. */
create or replace function konto_von(p_mitarbeiter uuid, p_firma uuid, out o_uid uuid, out o_rolle text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  select b.auth_user_id, b.ansicht into o_uid, o_rolle
    from benutzer b where b.mitarbeiter_id = p_mitarbeiter and b.firma_id = p_firma;
  if o_uid is null then raise exception 'Diese Person hat kein Konto.'; end if;
end;
$$;

revoke all on function konto_von(uuid, uuid) from public;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Konten der Firma lesen (die App darf `benutzer` nur für sich selbst lesen)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- drop, weil eine frühere Fassung eine Spalte weniger hatte — den Rückgabetyp ersetzt Postgres nicht.
drop function if exists konten_der_firma();
create function konten_der_firma()
returns table (mitarbeiter_id uuid, email text, ansicht text, letzte_anmeldung timestamptz, ich boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.mitarbeiter_id, u.email::text, b.ansicht, u.last_sign_in_at, b.auth_user_id = auth.uid()
    from benutzer b
    join auth.users u on u.id = b.auth_user_id
   where b.firma_id = konten_recht(null)
     and b.mitarbeiter_id is not null;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Konto anlegen — gibt die endgültige Adresse zurück (bei Doppelnamen mit Zahl)
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_anlegen(p_mitarbeiter uuid, p_benutzername text, p_passwort text, p_ansicht text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_firma  uuid;
  v_domain text;
  v_name   text;
  v_email  text;
  v_nr     int := 1;
  v_uid    uuid := gen_random_uuid();
  v_person text;
begin
  if p_ansicht is null or p_ansicht not in ('monteur', 'chef', 'bauf', 'sekretariat') then
    raise exception 'Unbekannte Rolle.';
  end if;
  v_firma := konten_recht(p_ansicht);
  select m.name into v_person from mitarbeiter m where m.id = p_mitarbeiter and m.firma_id = v_firma;
  if v_person is null then raise exception 'Diese Person gibt es in eurer Firma nicht.'; end if;
  if exists (select 1 from benutzer where mitarbeiter_id = p_mitarbeiter) then
    raise exception '% hat schon ein Konto.', v_person;
  end if;
  if coalesce(p_benutzername, '') !~ '^[a-z0-9]+([.-][a-z0-9]+)*$' then
    raise exception 'Name nur mit Kleinbuchstaben, Ziffern und Punkt.';
  end if;
  if length(coalesce(p_passwort, '')) < 8 then raise exception 'Passwort braucht mindestens 8 Zeichen.'; end if;

  select coalesce(f.mail_domain, 'rapporto.pureflow-ai.com') into v_domain from firma f where f.id = v_firma;

  -- Doppelname: ismail.vaiti@…, ismail.vaiti2@…
  v_name := p_benutzername;
  while exists (select 1 from auth.users where lower(email) = v_name || '@' || v_domain) loop
    v_nr := v_nr + 1;
    v_name := p_benutzername || v_nr;
  end loop;
  v_email := v_name || '@' || v_domain;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    crypt(p_passwort, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('mitarbeiter_id', p_mitarbeiter), now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into benutzer (auth_user_id, firma_id, bezeichnung, mitarbeiter_id, ansicht)
  values (v_uid, v_firma, v_person, p_mitarbeiter, p_ansicht);

  return v_email;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Rolle ändern — Monteur wird Chefmonteur. Wirkt beim nächsten Öffnen der App (personLaden).
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_rolle(p_mitarbeiter uuid, p_ansicht text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_firma uuid;
  k       record;
begin
  if p_ansicht is null or p_ansicht not in ('monteur', 'chef', 'bauf', 'sekretariat') then
    raise exception 'Unbekannte Rolle.';
  end if;
  v_firma := konten_recht(p_ansicht);                       -- darf ich die neue Rolle vergeben?
  select * into k from konto_von(p_mitarbeiter, v_firma);
  perform konten_recht(k.o_rolle);                          -- … und die alte wegnehmen?
  if k.o_uid = auth.uid() then raise exception 'Die eigene Rolle ändert jemand anderes.'; end if;
  update benutzer set ansicht = p_ansicht where auth_user_id = k.o_uid;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Passwort neu setzen — vergessen
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_passwort(p_mitarbeiter uuid, p_passwort text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_firma uuid;
  k       record;
begin
  if length(coalesce(p_passwort, '')) < 8 then raise exception 'Passwort braucht mindestens 8 Zeichen.'; end if;
  v_firma := konten_recht(null);
  select * into k from konto_von(p_mitarbeiter, v_firma);
  perform konten_recht(k.o_rolle);
  update auth.users set encrypted_password = crypt(p_passwort, gen_salt('bf')), updated_at = now() where id = k.o_uid;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Konto löschen — Handy verloren, Person geht. Die Person selbst und ihre Stunden bleiben.
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_loeschen(p_mitarbeiter uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_firma uuid;
  k       record;
begin
  v_firma := konten_recht(null);
  select * into k from konto_von(p_mitarbeiter, v_firma);
  perform konten_recht(k.o_rolle);
  if k.o_uid = auth.uid() then raise exception 'Das eigene Konto löscht jemand anderes.'; end if;
  -- Löscht mit: benutzer (cascade), Identitäten und Sitzungen des Zugangs.
  delete from auth.users where id = k.o_uid;
end;
$$;

revoke all on function konten_der_firma()                    from public;
revoke all on function konto_anlegen(uuid, text, text, text) from public;
revoke all on function konto_rolle(uuid, text)               from public;
revoke all on function konto_passwort(uuid, text)            from public;
revoke all on function konto_loeschen(uuid)                  from public;
grant execute on function konten_der_firma()                    to authenticated;
grant execute on function konto_anlegen(uuid, text, text, text) to authenticated;
grant execute on function konto_rolle(uuid, text)               to authenticated;
grant execute on function konto_passwort(uuid, text)            to authenticated;
grant execute on function konto_loeschen(uuid)                  to authenticated;
