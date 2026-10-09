-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0034 · Benutzerkonten aus der Verwaltung anlegen (10.10.2026, Erin)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Der Bauführer erfasst eine Person in Verwaltung → Mitarbeitende und gibt ihr gleich ein Konto:
-- Benutzername `vorname.nachname`, Passwort, Rolle Monteur oder Chefmonteur. Kein Supabase-Dashboard,
-- keine Edge Function — vier Funktionen hier, aufgerufen aus der App (src/seiten/verwaltung/Konto.tsx).
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
-- Rechte — hier zum ersten Mal **in der Datenbank** nach Rolle getrennt: Konten anlegen, Passwort
-- setzen und löschen darf nur ein Büro-Zugang (Firmen-Zugang ohne Ansicht, Bauführer, Sekretariat).
-- Ein Monteur-Handy kann das nicht, auch nicht mit eigenem Programm.
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
-- 2. Wer darf Konten verwalten?
-- ────────────────────────────────────────────────────────────────────────────────────────────
/** Firma des Aufrufers, wenn er im Büro sitzt. Sonst Fehler. */
create or replace function buero_firma()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_firma uuid;
  v_ansicht text;
begin
  select b.firma_id, b.ansicht into v_firma, v_ansicht from benutzer b where b.auth_user_id = auth.uid();
  if v_firma is null then raise exception 'Kein Zugang.'; end if;
  if v_ansicht in ('chef', 'monteur') then raise exception 'Konten verwaltet das Büro.'; end if;
  return v_firma;
end;
$$;

revoke all on function buero_firma() from public;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Konten der Firma lesen (die App darf `benutzer` nur für sich selbst lesen)
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konten_der_firma()
returns table (mitarbeiter_id uuid, email text, ansicht text, letzte_anmeldung timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.mitarbeiter_id, u.email::text, b.ansicht, u.last_sign_in_at
    from benutzer b
    join auth.users u on u.id = b.auth_user_id
   where b.firma_id = buero_firma()
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
  v_firma  uuid := buero_firma();
  v_domain text;
  v_name   text;
  v_email  text;
  v_nr     int := 1;
  v_uid    uuid := gen_random_uuid();
  v_person text;
begin
  select m.name into v_person from mitarbeiter m where m.id = p_mitarbeiter and m.firma_id = v_firma;
  if v_person is null then raise exception 'Diese Person gibt es in eurer Firma nicht.'; end if;
  if exists (select 1 from benutzer where mitarbeiter_id = p_mitarbeiter) then
    raise exception '% hat schon ein Konto.', v_person;
  end if;
  if p_ansicht not in ('chef', 'monteur') then raise exception 'Rolle muss Monteur oder Chefmonteur sein.'; end if;
  if coalesce(p_benutzername, '') !~ '^[a-z0-9]+([.-][a-z0-9]+)*$' then
    raise exception 'Benutzername nur mit Kleinbuchstaben, Ziffern und Punkt.';
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
    jsonb_build_object('mitarbeiter_id', p_mitarbeiter, 'ansicht', p_ansicht), now(), now(),
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
-- 5. Passwort neu setzen — Monteur hat es vergessen
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_passwort(p_mitarbeiter uuid, p_passwort text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_firma uuid := buero_firma();
  v_uid   uuid;
begin
  if length(coalesce(p_passwort, '')) < 8 then raise exception 'Passwort braucht mindestens 8 Zeichen.'; end if;
  select auth_user_id into v_uid from benutzer where mitarbeiter_id = p_mitarbeiter and firma_id = v_firma;
  if v_uid is null then raise exception 'Diese Person hat kein Konto.'; end if;
  update auth.users set encrypted_password = crypt(p_passwort, gen_salt('bf')), updated_at = now() where id = v_uid;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Konto löschen — Handy verloren, Person geht. Die Person selbst und ihre Stunden bleiben.
-- ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function konto_loeschen(p_mitarbeiter uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_firma uuid := buero_firma();
  v_uid   uuid;
begin
  select auth_user_id into v_uid from benutzer where mitarbeiter_id = p_mitarbeiter and firma_id = v_firma;
  if v_uid is null then return; end if;
  -- Löscht mit: benutzer (cascade), Identitäten und Sitzungen des Zugangs.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function konten_der_firma()                 from public;
revoke all on function konto_anlegen(uuid, text, text, text) from public;
revoke all on function konto_passwort(uuid, text)          from public;
revoke all on function konto_loeschen(uuid)                from public;
grant execute on function konten_der_firma()                 to authenticated;
grant execute on function konto_anlegen(uuid, text, text, text) to authenticated;
grant execute on function konto_passwort(uuid, text)          to authenticated;
grant execute on function konto_loeschen(uuid)                to authenticated;
