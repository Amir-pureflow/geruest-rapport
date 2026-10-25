-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0052 · Benachrichtigung «Plan für morgen» (25.10.2026, Caturix-Analyse Schritt 5)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir: «Es soll eine Benachrichtigung kommen, mehr nicht — oder bei einer Änderung.» Keine Quittung, kein «gesehen»,
-- keine Erinnerung. Zwei Nachrichten aufs Teamgerät bzw. Handy des Chefmonteurs (Web Push, kein App Store):
--   16:00 an jedem Arbeitstag: der Plan für den nächsten Arbeitstag (Baustelle, ab wann, Treffpunkt, Hinweis).
--   Bei einer Änderung am Plan für heute oder den nächsten Arbeitstag: was sich geändert hat — aus dem Posteingang (0051),
--   zwei Minuten nach der letzten Änderung, damit mehrere Klicks im Büro eine Nachricht ergeben.
--
-- Ablauf: Die Datenbank schreibt die Nachrichten in `push_ausgang` und stösst die Edge Function `push-senden` an (pg_net);
-- die verschlüsselt und verschickt sie an alle Geräte des Teams (`push_abo`). Schlüssel in `konfiguration`
-- (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_GEHEIM, SUPABASE_URL) — nicht im Repo. Fehlen sie, passiert nichts.
--
-- Wer ein Abo anlegen darf: das Büro (Teamgerät mit Firmen-Zugang) für jedes aktive Team der Firma, der Chefmonteur für
-- seine Teams. Der Monteur nicht («mehr nicht»).
-- Wiederholbar.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Geräte (Abos) und Ausgang
-- ────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists push_abo (
  id          uuid primary key default gen_random_uuid(),
  firma_id    uuid not null references firma(id) on delete cascade,
  konto       uuid not null references auth.users(id) on delete cascade,
  team_id     uuid not null references team(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) between 80 and 100),
  auth        text not null check (length(auth) between 16 and 30),
  geraet      text check (length(geraet) <= 120),
  erstellt_am timestamptz not null default now(),
  zuletzt_am  timestamptz not null default now(),
  fehler      smallint not null default 0
);
create index if not exists push_abo_team_idx on push_abo (team_id);

-- Lesen nur die eigenen; schreiben nur über die Funktionen unten
alter table push_abo enable row level security;
drop policy if exists push_abo_lesen on push_abo;
create policy push_abo_lesen on push_abo for select to authenticated using (konto = auth.uid());
grant select on push_abo to authenticated;
revoke insert, update, delete on push_abo from authenticated;
revoke all on push_abo from anon;

create table if not exists push_ausgang (
  id          uuid primary key default gen_random_uuid(),
  firma_id    uuid not null references firma(id) on delete cascade,
  team_id     uuid not null references team(id) on delete cascade,
  art         text not null check (art in ('plan_morgen', 'plan_geaendert')),
  tag         date not null,
  titel       text not null,
  text        text not null,
  ziel        text not null default '/',
  bezug_id    uuid,
  erstellt_am timestamptz not null default now(),
  gesendet_am timestamptz,
  ergebnis    text
);
-- Je Team und Tag eine Nachricht «Plan für morgen», auch wenn der Zeitplan zweimal läuft
create unique index if not exists push_ausgang_morgen_idx on push_ausgang (team_id, tag) where art = 'plan_morgen';
create index if not exists push_ausgang_offen_idx on push_ausgang (erstellt_am) where gesendet_am is null;
-- Keine Regeln: nur die Edge Function (Service-Role) und die Funktionen hier
alter table push_ausgang enable row level security;
revoke all on push_ausgang from anon, authenticated;

-- Wann ein Bündel des Posteingangs verschickt wurde (siehe posteingang_posten unten)
alter table posteingang add column if not exists gepusht_am timestamptz;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Für die App: Schlüssel holen, Gerät an- und abmelden
-- ────────────────────────────────────────────────────────────────────────────────────────────

-- Öffentlicher VAPID-Schlüssel (braucht das Gerät zum Abonnieren; nicht geheim). null = Benachrichtigungen nicht eingerichtet.
create or replace function push_schluessel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when aktuelle_firma() is null then null
              else (select wert from konfiguration where schluessel = 'VAPID_PUBLIC_KEY') end;
$$;

-- Gerät für ein Team anmelden. Ein Gerät (endpoint) gehört immer zur letzten Anmeldung — wechselt das Teamgerät das Team
-- oder den Zugang, ersetzt die neue Zeile die alte.
create or replace function push_abo_setzen(p_endpoint text, p_p256dh text, p_auth text, p_team uuid, p_geraet text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := aktuelle_firma();
  r text := aktuelle_rolle();
begin
  if f is null or auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if not exists (select 1 from team t where t.id = p_team and t.firma_id = f and t.aktiv
                   and (r = 'buero' or (r = 'chef' and t.chefmonteur_id = eigene_person()))) then
    raise exception 'Für dieses Team nicht erlaubt' using errcode = '42501';
  end if;
  delete from push_abo where endpoint = p_endpoint;
  insert into push_abo (firma_id, konto, team_id, endpoint, p256dh, auth, geraet)
  values (f, auth.uid(), p_team, p_endpoint, p_p256dh, p_auth, left(p_geraet, 120));
end;
$$;

create or replace function push_abo_loeschen(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_abo where endpoint = p_endpoint and konto = auth.uid();
$$;

revoke all on function push_schluessel() from public, anon;
revoke all on function push_abo_setzen(text, text, text, uuid, text) from public, anon;
revoke all on function push_abo_loeschen(text) from public, anon;
grant execute on function push_schluessel() to authenticated;
grant execute on function push_abo_setzen(text, text, text, uuid, text) to authenticated;
grant execute on function push_abo_loeschen(text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Posteingang: ein verschicktes Bündel bleibt, wie es verschickt wurde
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Wie «gelesen» (0051): Nach dem Versand beginnt die nächste Änderung ein neues Bündel. Sonst verschwände eine
-- verschickte Umplanung beim Zurücknehmen — das Team hätte «Beginn 7:00» bekommen, aber nie «wieder 6:30».

create or replace function posteingang_posten(
  p_firma uuid, p_an text, p_team uuid, p_person uuid, p_art text, p_buendel text, p_tag date, p_kopf jsonb,
  p_schluessel text, p_titel text, p_vorher jsonb, p_nachher jsonb, p_neu_erlaubt boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e posteingang;
  posten jsonb;
  vorher jsonb := coalesce(p_vorher, 'null'::jsonb);
  nachher jsonb := coalesce(p_nachher, 'null'::jsonb);
begin
  -- Für dieses Bündel ändert sich nichts (z. B. Abwesenheit einer Person, die an dem Tag in einem anderen Team ist)
  if vorher = nachher then return; end if;
  select * into e from posteingang where firma_id = p_firma and buendel = p_buendel for update;
  if e.id is not null and (e.gepusht_am is not null or exists (select 1 from posteingang_gelesen g where g.eintrag_id = e.id)) then
    update posteingang set buendel = null where id = e.id;
    e := null;
  end if;

  if e.id is null then
    if not p_neu_erlaubt then return; end if;
    insert into posteingang (firma_id, an, team_id, mitarbeiter_id, art, tag, buendel, inhalt)
    values (p_firma, p_an, p_team, p_person, p_art, p_tag, p_buendel,
            coalesce(p_kopf, '{}'::jsonb) || jsonb_build_object('posten', jsonb_build_object(p_schluessel,
              jsonb_build_object('titel', p_titel, 'vorher', vorher, 'nachher', nachher, 'zeit', now()))));
    return;
  end if;

  posten := coalesce(e.inhalt -> 'posten', '{}'::jsonb);
  if posten ? p_schluessel then vorher := posten -> p_schluessel -> 'vorher'; end if;
  if vorher = nachher then
    posten := posten - p_schluessel;
  else
    posten := posten || jsonb_build_object(p_schluessel,
      jsonb_build_object('titel', p_titel, 'vorher', vorher, 'nachher', nachher, 'zeit', now()));
  end if;
  if posten = '{}'::jsonb then
    delete from posteingang where id = e.id;
  else
    update posteingang
       set inhalt = (inhalt || coalesce(p_kopf, '{}'::jsonb)) || jsonb_build_object('posten', posten), geaendert_am = now()
     where id = e.id;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Texte der Nachrichten (kurz — der Sperrbildschirm zeigt zwei, drei Zeilen; Einzelheiten im Posteingang)
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function push_uhr(m int)
returns text
language sql
immutable
set search_path = public
as $$
  select (m / 60)::text || ':' || lpad((m % 60)::text, 2, '0');
$$;

-- «heute», «morgen», sonst «Montag 26.10.»
create or replace function push_tag_wort(p_tag date, p_heute date)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_tag = p_heute then 'heute'
              when p_tag = p_heute + 1 then 'morgen'
              else (array['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'])[extract(dow from p_tag)::int + 1]
                   || ' ' || extract(day from p_tag)::int || '.' || extract(month from p_tag)::int || '.' end;
$$;

-- Plan eines Teams an einem Tag: «Wohnüberbauung Brünnenpark · ab 6:30 · Treffpunkt Werkhof · Kran kommt um 9»
create or replace function push_plan_text(p_team uuid, p_tag date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select string_agg(
              coalesce(nullif(b.bezeichnung, ''), b.konto_nr, 'Baustelle')
              || ' · ab ' || push_uhr(coalesce(j.beginn_min::int, f.arbeitsbeginn_min, 420))
              || case when j.treffpunkt = 'werkhof' then ' · Treffpunkt Werkhof' else '' end
              || case when j.hinweis is not null then ' · ' || j.hinweis else '' end,
              ' / ' order by j.von, j.id)
       from jahresplan j
       join team t on t.id = j.team_id
       join firma f on f.id = t.firma_id
       left join baustelle b on b.id = j.baustelle_id
      where j.team_id = p_team and p_tag between j.von and j.bis),
    'Noch keine Baustelle geplant — beim Büro nachfragen.');
$$;

-- Was sich geändert hat, aus einem Bündel des Posteingangs (dieselben Regeln wie eintragText() in der App, kürzer)
create or replace function push_aenderung_text(p_inhalt jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  p record;
  v jsonb;
  n jsonb;
  wer text;
  weg text[] := '{}';
  neu text[] := '{}';
  z text[] := '{}';
  vorn text[] := '{}';
begin
  for p in select key, value from jsonb_each(coalesce(p_inhalt -> 'posten', '{}'::jsonb)) order by value ->> 'zeit', key loop
    v := p.value -> 'vorher';
    n := p.value -> 'nachher';
    if p.key like 'b:%' then
      if jsonb_typeof(v) = 'object' and jsonb_typeof(n) is distinct from 'object' then
        weg := weg || (v ->> 'baustelle');
      elsif jsonb_typeof(v) is distinct from 'object' and jsonb_typeof(n) = 'object' then
        neu := neu || (n ->> 'baustelle');
      elsif jsonb_typeof(v) = 'object' then
        if (v -> 'beginn') is distinct from (n -> 'beginn') then
          z := z || case when n -> 'beginn' is null then 'Beginn wieder wie immer' else 'Beginn ' || push_uhr((n ->> 'beginn')::int) end;
        end if;
        if (v -> 'treffpunkt') is distinct from (n -> 'treffpunkt') then
          z := z || case when n ->> 'treffpunkt' = 'werkhof' then 'Treffpunkt Werkhof' else 'Treffpunkt auf der Baustelle' end;
        end if;
        if (v -> 'hinweis') is distinct from (n -> 'hinweis') then
          z := z || case when n ->> 'hinweis' is null then 'Hinweis entfernt' else 'Hinweis: ' || (n ->> 'hinweis') end;
        end if;
      end if;
    elsif p.key like 'm:%' then
      wer := coalesce(p.value ->> 'titel', 'Jemand');
      z := z || case
        when n ->> 's' = 'abwesend' then wer || ' fehlt'
        when n ->> 's' = 'weg' then wer || ' ist bei ' || coalesce(n ->> 'nach', 'einem anderen Team')
        when n ->> 's' = 'da' and v ->> 's' = 'abwesend' then wer || ' ist doch da'
        when n ->> 's' = 'da' and v ->> 's' = 'weg' then wer || ' ist wieder bei euch'
        when n ->> 's' = 'da' then wer || ' kommt dazu'
        when n ->> 's' = 'nicht' then wer || ' ist nicht mehr eingeteilt'
      end;
    end if;
  end loop;
  -- Baustellen zuerst: eins gegen eins «X statt Y», sonst einzeln
  if cardinality(weg) = 1 and cardinality(neu) = 1 then
    vorn := array[neu[1] || ' statt ' || weg[1]];
  else
    vorn := coalesce((select array_agg('Neu: ' || x) from unnest(neu) x), '{}')
         || coalesce((select array_agg('Fällt weg: ' || x) from unnest(weg) x), '{}');
  end if;
  return left(coalesce(nullif(array_to_string(vorn || z, ' · '), ''), 'Tippen für Einzelheiten'), 230);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Verschicken
-- ────────────────────────────────────────────────────────────────────────────────────────────

-- Edge Function anstossen (pg_net, asynchron). Ohne pg_net oder ohne Schlüssel: nichts.
create or replace function push_anstossen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  basis text;
  geheim text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  select wert into basis from konfiguration where schluessel = 'SUPABASE_URL';
  select wert into geheim from konfiguration where schluessel = 'PUSH_GEHEIM';
  if basis is null or geheim is null then return; end if;
  perform net.http_post(
    url     := rtrim(basis, '/') || '/functions/v1/push-senden',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-geheim', geheim));
end;
$$;

-- 16:00 Schweizer Zeit an Arbeitstagen: Plan für den nächsten Arbeitstag an jedes Team mit Gerät.
-- Läuft um 14:00 und 15:00 UTC (Sommer-/Winterzeit) und prüft selbst, ob es in der Schweiz 16 Uhr ist.
create or replace function push_plan_morgen(p_jetzt timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lokal timestamp := p_jetzt at time zone 'Europe/Zurich';
  heute date := (p_jetzt at time zone 'Europe/Zurich')::date;
  morgen date;
  n integer;
begin
  if extract(hour from lokal) <> 16 or not arbeitstag_bern(heute) then return 0; end if;
  morgen := naechster_arbeitstag(heute);
  insert into push_ausgang (firma_id, team_id, art, tag, titel, text)
  select t.firma_id, t.id, 'plan_morgen', morgen,
         t.bezeichnung || ' · Plan für ' || push_tag_wort(morgen, heute), push_plan_text(t.id, morgen)
    from team t
   where t.aktiv and exists (select 1 from push_abo a where a.team_id = t.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  -- Was bis jetzt für diesen Tag geändert wurde, steht in dieser Nachricht — nicht nochmals einzeln schicken
  update posteingang p set gepusht_am = p_jetzt
   where p.art = 'plan' and p.an = 'team' and p.tag = morgen and p.buendel is not null and p.gepusht_am is null
     and exists (select 1 from push_abo a where a.team_id = p.team_id);
  if n > 0 then perform push_anstossen(); end if;
  return n;
end;
$$;

-- Jede Minute: Änderungen am Plan (Bündel des Posteingangs für heute und den nächsten Arbeitstag), sobald das Büro zwei
-- Minuten nichts mehr daran geändert hat. Stösst auch liegengebliebene Nachrichten nochmals an (Function nicht erreicht).
create or replace function push_aenderungen(p_jetzt timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  heute date := (p_jetzt at time zone 'Europe/Zurich')::date;
  n integer;
begin
  with faellig as (
    update posteingang p set gepusht_am = p_jetzt
     where p.art = 'plan' and p.an = 'team' and p.buendel is not null and p.gepusht_am is null
       and p.tag >= heute
       and p.geaendert_am <= p_jetzt - interval '2 minutes'
       and exists (select 1 from push_abo a where a.team_id = p.team_id)
    returning p.id, p.firma_id, p.team_id, p.tag, p.inhalt
  )
  insert into push_ausgang (firma_id, team_id, art, tag, titel, text, bezug_id)
  select f.firma_id, f.team_id, 'plan_geaendert', f.tag,
         coalesce(f.inhalt ->> 'team', 'Team') || ' · Plan für ' || push_tag_wort(f.tag, heute) || ' geändert',
         push_aenderung_text(f.inhalt), f.id
    from faellig f;
  get diagnostics n = row_count;
  if n > 0 or exists (select 1 from push_ausgang
                       where gesendet_am is null and erstellt_am between p_jetzt - interval '6 hours' and p_jetzt - interval '1 minute') then
    perform push_anstossen();
  end if;
  return n;
end;
$$;

revoke all on function push_anstossen() from public, anon, authenticated;
revoke all on function push_plan_morgen(timestamptz) from public, anon, authenticated;
revoke all on function push_aenderungen(timestamptz) from public, anon, authenticated;
revoke all on function push_plan_text(uuid, date) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push_plan_morgen', '0 14,15 * * *', $job$select public.push_plan_morgen();$job$);
    perform cron.schedule('push_aenderungen', '* * * * *', $job$select public.push_aenderungen();$job$);
  else
    raise notice 'pg_cron fehlt: push_plan_morgen() und push_aenderungen() laufen nicht von selbst.';
  end if;
end $$;

-- Aufräumen (0051) nimmt den Ausgang mit: verschickte Nachrichten nach 30 Tagen weg
create or replace function posteingang_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from posteingang where geaendert_am < now() - interval '90 days';
  get diagnostics n = row_count;
  delete from push_ausgang where erstellt_am < now() - interval '30 days';
  return n;
end;
$$;

notify pgrst, 'reload schema';
