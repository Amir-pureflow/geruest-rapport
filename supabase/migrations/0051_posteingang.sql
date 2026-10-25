-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0051 · Posteingang (24.10.2026, Caturix-Analyse, Schritt 4)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Eine Glocke für das, was jemand wissen muss, ohne danach zu suchen:
--   Team (Teamgerät, Chefmonteur): Plan für heute oder den nächsten Arbeitstag geändert — andere Baustelle, Beginn,
--     Treffpunkt, Hinweis, Leute dazu oder weg, jemand fehlt —, und das Büro hat Stunden korrigiert.
--   Person (persönlicher Zugang): an dem Tag in einem anderen Team; eigene Stunden korrigiert.
--   Büro: Rückfrage des Kunden zu einem Regierapport, bestätigt, Frist abgelaufen; Meldung mit Abweichung.
--
-- Geschrieben wird nur von Auslösern (als Besitzer) — auch aus alten App-Fassungen und aus den Edge Functions. Die App
-- liest und setzt «gelesen» (je Zugang). Änderungen am Plan werden je Team und Tag gebündelt und aufgerechnet: wer eine
-- Baustelle wegnimmt und gleich wieder einsetzt, erzeugt nichts. Ein gelesenes Bündel bleibt, wie es gelesen wurde; die
-- nächste Änderung beginnt ein neues — sonst verschwände eine gelesene Umplanung, sobald sie zurückgenommen wird, und das
-- Team führe an die falsche Baustelle.
--
-- Ein Tag, der zum ersten Mal verplant wird, ist keine Umplanung (wie «Plan geändert», planung.ts): sonst hätte jedes Team
-- am Freitag eine Meldung für Montag, weil die Woche geplant wurde.
--
-- Fehler im Posteingang dürfen nie das Speichern verhindern: jeder Auslöser fängt sie ab (Warnung im Log).
-- Wiederholbar.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tage: Schweizer Datum, Feiertage Bern, nächster Arbeitstag (wie feiertage.ts)
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function ostersonntag(jahr int)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := jahr % 19; b := jahr / 100; c := jahr % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  return make_date(jahr, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

-- Montag bis Freitag und kein Feiertag im Kanton Bern
create or replace function arbeitstag_bern(d date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select extract(isodow from d) < 6 and d not in (
    make_date(extract(year from d)::int, 1, 1),  make_date(extract(year from d)::int, 1, 2),
    ostersonntag(extract(year from d)::int) - 2, ostersonntag(extract(year from d)::int) + 1,
    ostersonntag(extract(year from d)::int) + 39, ostersonntag(extract(year from d)::int) + 50,
    make_date(extract(year from d)::int, 8, 1),  make_date(extract(year from d)::int, 12, 25),
    make_date(extract(year from d)::int, 12, 26));
$$;

create or replace function naechster_arbeitstag(d date)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare n date := d + 1;
begin
  while not arbeitstag_bern(n) loop n := n + 1; end loop;
  return n;
end;
$$;

-- `current_date` ist UTC: zwischen Mitternacht und 01:00/02:00 Schweizer Zeit noch «gestern»
create or replace function heute_ch()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/Zurich')::date;
$$;

-- Für diese Tage geht eine Änderung am Plan ins Posteingang: heute und der nächste Arbeitstag. Heute nur an einem
-- Arbeitstag — ein Einsatz Mo–Fr steht im Kalender auch über das Wochenende, am Samstag hiesse jede Änderung sonst
-- «Plan für heute geändert».
create or replace function posteingang_tage()
returns date[]
language sql
stable
set search_path = public
as $$
  select array_remove(array[case when arbeitstag_bern(heute_ch()) then heute_ch() end, naechster_arbeitstag(heute_ch())], null);
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Tabellen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- an = 'buero' (alle Büro-Zugänge der Firma), 'team' (Teamgerät und Chefmonteur des Teams), 'person' (persönlicher Zugang).
-- inhalt: Kopf (Team, Name, Nummer …) und bei Bündeln `posten` = { schlüssel: { titel, vorher, nachher, zeit } }.
-- buendel: Schlüssel des offenen Bündels (eindeutig je Firma); abgeschlossene haben keinen mehr.

create table if not exists posteingang (
  id             uuid primary key default gen_random_uuid(),
  firma_id       uuid not null references firma(id) on delete cascade,
  an             text not null check (an in ('buero', 'team', 'person')),
  team_id        uuid references team(id) on delete cascade,
  mitarbeiter_id uuid references mitarbeiter(id) on delete cascade,
  art            text not null check (art in ('plan', 'korrektur', 'rueckfrage', 'bestaetigt', 'frist', 'abweichung')),
  tag            date,
  bezug_id       uuid,
  buendel        text,
  inhalt         jsonb not null default '{}'::jsonb,
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz not null default now(),
  erledigt_am    timestamptz,
  constraint posteingang_an check (
       (an = 'buero'  and team_id is null     and mitarbeiter_id is null)
    or (an = 'team'   and team_id is not null and mitarbeiter_id is null)
    or (an = 'person' and team_id is null     and mitarbeiter_id is not null))
);
create unique index if not exists posteingang_buendel_idx on posteingang (firma_id, buendel) where buendel is not null;
create index if not exists posteingang_firma_zeit_idx on posteingang (firma_id, geaendert_am desc);
create index if not exists posteingang_bezug_idx on posteingang (bezug_id) where bezug_id is not null;

create table if not exists posteingang_gelesen (
  eintrag_id uuid not null references posteingang(id) on delete cascade,
  konto      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gelesen_am timestamptz not null default now(),
  primary key (eintrag_id, konto)
);
create index if not exists posteingang_gelesen_konto_idx on posteingang_gelesen (konto);

-- Lesen: das Büro alles der Firma (ein Teamgerät mit Firmen-Zugang ist Büro und braucht die Meldungen seines Teams);
-- der Chefmonteur die seiner Teams und die eigenen, der Monteur die eigenen.
alter table posteingang enable row level security;
drop policy if exists posteingang_lesen on posteingang;
create policy posteingang_lesen on posteingang for select to authenticated using (
  firma_id = aktuelle_firma() and (
    ist_buero()
    or (an = 'team' and aktuelle_rolle() = 'chef'
        and exists (select 1 from team t where t.id = posteingang.team_id and t.chefmonteur_id = eigene_person()))
    or (an = 'person' and mitarbeiter_id = eigene_person())
  ));
grant select on posteingang to authenticated;
revoke insert, update, delete on posteingang from authenticated;
revoke all on posteingang from anon;

-- Gelesen: jeder Zugang setzt seine eigenen, nur für Einträge, die er sehen darf. Nicht zurücknehmen.
alter table posteingang_gelesen enable row level security;
drop policy if exists posteingang_gelesen_lesen on posteingang_gelesen;
drop policy if exists posteingang_gelesen_setzen on posteingang_gelesen;
create policy posteingang_gelesen_lesen on posteingang_gelesen for select to authenticated using (konto = auth.uid());
create policy posteingang_gelesen_setzen on posteingang_gelesen for insert to authenticated
  with check (konto = auth.uid() and exists (select 1 from posteingang p where p.id = eintrag_id));
grant select, insert on posteingang_gelesen to authenticated;
revoke update, delete on posteingang_gelesen from authenticated;
revoke all on posteingang_gelesen from anon;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Ein Posten in ein Bündel
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- `vorher` bleibt der Stand vor der ersten Änderung, `nachher` der neueste. Sind beide gleich, fällt der Posten weg; ist das
-- Bündel leer, fällt es weg. Hat jemand das Bündel gelesen, wird es abgeschlossen und ein neues begonnen.
-- `neu_erlaubt` = false: nur in ein schon offenes Bündel schreiben (erstmals verplanter Tag, siehe oben).

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
  if e.id is not null and exists (select 1 from posteingang_gelesen g where g.eintrag_id = e.id) then
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

-- Name, wie ihn die App zeigt
create or replace function posteingang_baustelle(p_baustelle uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(nullif(b.bezeichnung, ''), concat_ws(' ', b.strasse, b.ort)) from baustelle b where b.id = p_baustelle),
                  'ohne Baustelle');
$$;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Plan: Einsätze (jahresplan)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Stand eines Einsatzes, wie ihn das Team braucht — ohne «Leute nötig» (Sache des Büros). null = nicht geplant.

create or replace function posteingang_einsatz(p_baustelle uuid, p_beginn smallint, p_treffpunkt text, p_hinweis text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object('baustelle', posteingang_baustelle(p_baustelle),
    'beginn', p_beginn, 'treffpunkt', p_treffpunkt, 'hinweis', p_hinweis));
$$;

-- Dasselbe aus den übrigen Einsätzen des Teams an dem Tag (ohne die Zeile, die sich gerade ändert)
create or replace function posteingang_einsatz_sonst(p_team uuid, p_baustelle uuid, p_tag date, p_ohne uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select posteingang_einsatz(j.baustelle_id, j.beginn_min, j.treffpunkt, j.hinweis)
    from jahresplan j
   where j.team_id = p_team and j.baustelle_id is not distinct from p_baustelle
     and p_tag between j.von and j.bis and j.id <> p_ohne
   order by j.von desc, j.id
   limit 1;
$$;

create or replace function posteingang_jahresplan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid := coalesce(new.id, old.id);
  f uuid := coalesce(new.firma_id, old.firma_id);
  tag date;
  z record;
  vorher jsonb;
  nachher jsonb;
begin
  begin
    foreach tag in array posteingang_tage() loop
      for z in
        select distinct t.team_id, t.baustelle_id
          from (values (old.team_id, old.baustelle_id, old.von, old.bis), (new.team_id, new.baustelle_id, new.von, new.bis))
               as t(team_id, baustelle_id, von, bis)
         where t.team_id is not null and tag between t.von and t.bis
      loop
        vorher := case when old.team_id = z.team_id and old.baustelle_id is not distinct from z.baustelle_id and tag between old.von and old.bis
                       then posteingang_einsatz(old.baustelle_id, old.beginn_min, old.treffpunkt, old.hinweis)
                       else posteingang_einsatz_sonst(z.team_id, z.baustelle_id, tag, rid) end;
        nachher := case when new.team_id = z.team_id and new.baustelle_id is not distinct from z.baustelle_id and tag between new.von and new.bis
                        then posteingang_einsatz(new.baustelle_id, new.beginn_min, new.treffpunkt, new.hinweis)
                        else posteingang_einsatz_sonst(z.team_id, z.baustelle_id, tag, rid) end;
        continue when vorher is not distinct from nachher;
        perform posteingang_posten(
          f, 'team', z.team_id, null, 'plan', 'plan:team:' || z.team_id || ':' || tag, tag,
          jsonb_build_object('team', (select bezeichnung from team where id = z.team_id)),
          'b:' || coalesce(z.baustelle_id::text, '-'), posteingang_baustelle(z.baustelle_id), vorher, nachher,
          -- neu angelegt an einem Tag ohne andere Einsätze des Teams: erstmals verplant, keine Umplanung
          tg_op <> 'INSERT' or exists (select 1 from jahresplan j where j.team_id = z.team_id and tag between j.von and j.bis and j.id <> rid));
      end loop;
    end loop;
  exception when others then
    raise warning 'Posteingang (jahresplan): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists jahresplan_posteingang on jahresplan;
create trigger jahresplan_posteingang after insert or update or delete on jahresplan
  for each row execute function posteingang_jahresplan();

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Plan: Leute (einsatz_person) und Abwesenheiten
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Stand einer Person für ein Team an einem Tag: da · abwesend (Art) · weg (in welches Team) · nicht (gehört nicht dazu).
-- `p_versetzt` = Team aus einsatz_person (null = wie immer), `p_abwesend` = Art der Abwesenheit (null = da).

create or replace function posteingang_person(p_team uuid, p_person uuid, p_tag date, p_versetzt uuid, p_abwesend text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select exists (select 1 from team_mitglied tm
                    where tm.team_id = p_team and tm.mitarbeiter_id = p_person
                      and (tm.von is null or tm.von <= p_tag) and (tm.bis is null or tm.bis >= p_tag)) as stamm
  )
  select case
    when (p_versetzt = p_team or (p_versetzt is null and s.stamm)) and p_abwesend is not null
      then jsonb_build_object('s', 'abwesend', 'art', p_abwesend)
    when p_versetzt = p_team or (p_versetzt is null and s.stamm) then jsonb_build_object('s', 'da')
    when s.stamm then jsonb_build_object('s', 'weg', 'nach', (select bezeichnung from team where id = p_versetzt))
    else jsonb_build_object('s', 'nicht')
  end
  from s;
$$;

-- In welchem Team die Person an dem Tag ist, und wo das Team arbeitet — für ihren eigenen Posteingang
create or replace function posteingang_team_von(p_person uuid, p_tag date, p_versetzt uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select coalesce(p_versetzt, (select tm.team_id from team_mitglied tm
                                  where tm.mitarbeiter_id = p_person
                                    and (tm.von is null or tm.von <= p_tag) and (tm.bis is null or tm.bis >= p_tag)
                                  order by tm.von nulls first limit 1)) as id
  )
  select case when t.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'team', (select bezeichnung from team where id = t.id),
    'baustelle', (select posteingang_baustelle(j.baustelle_id) from jahresplan j
                   where j.team_id = t.id and p_tag between j.von and j.bis order by j.von desc, j.id limit 1)))
  end
  from t;
$$;

-- Teams, die eine Änderung an Person + Tag betrifft: Stammteams und die Teams vorher/nachher
create or replace function posteingang_person_aendern(p_firma uuid, p_person uuid, p_tag date,
  v_vorher uuid, v_nachher uuid, a_vorher text, a_nachher text, p_eigene boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  wer text := (select m.name from mitarbeiter m where m.id = p_person);
begin
  if not (p_tag = any (posteingang_tage())) then return; end if;
  for t in
    select x from unnest(array[v_vorher, v_nachher]) x where x is not null
    union
    select tm.team_id from team_mitglied tm
     where tm.mitarbeiter_id = p_person and (tm.von is null or tm.von <= p_tag) and (tm.bis is null or tm.bis >= p_tag)
  loop
    perform posteingang_posten(
      p_firma, 'team', t, null, 'plan', 'plan:team:' || t || ':' || p_tag, p_tag,
      jsonb_build_object('team', (select bezeichnung from team where id = t)),
      'm:' || p_person, wer,
      posteingang_person(t, p_person, p_tag, v_vorher, a_vorher),
      posteingang_person(t, p_person, p_tag, v_nachher, a_nachher));
  end loop;
  -- Die Person selbst, wenn sie einen Zugang hat und ihr Team wechselt
  if p_eigene and exists (select 1 from benutzer b where b.mitarbeiter_id = p_person) then
    perform posteingang_posten(
      p_firma, 'person', null, p_person, 'plan', 'plan:person:' || p_person || ':' || p_tag, p_tag,
      jsonb_build_object('name', wer), 'team', wer,
      posteingang_team_von(p_person, p_tag, v_vorher), posteingang_team_von(p_person, p_tag, v_nachher));
  end if;
end;
$$;

create or replace function posteingang_einsatz_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gleich boolean := tg_op = 'UPDATE' and new.mitarbeiter_id = old.mitarbeiter_id and new.datum = old.datum;
begin
  begin
    if tg_op <> 'INSERT' then
      perform posteingang_person_aendern(old.firma_id, old.mitarbeiter_id, old.datum,
        old.team_id, case when gleich then new.team_id end,
        (select a.art from abwesenheit a where a.mitarbeiter_id = old.mitarbeiter_id and a.datum = old.datum and a.art <> 'feiertag'),
        (select a.art from abwesenheit a where a.mitarbeiter_id = old.mitarbeiter_id and a.datum = old.datum and a.art <> 'feiertag'),
        true);
    end if;
    if tg_op <> 'DELETE' and not gleich then
      perform posteingang_person_aendern(new.firma_id, new.mitarbeiter_id, new.datum, null, new.team_id,
        (select a.art from abwesenheit a where a.mitarbeiter_id = new.mitarbeiter_id and a.datum = new.datum and a.art <> 'feiertag'),
        (select a.art from abwesenheit a where a.mitarbeiter_id = new.mitarbeiter_id and a.datum = new.datum and a.art <> 'feiertag'),
        true);
    end if;
  exception when others then
    raise warning 'Posteingang (einsatz_person): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists einsatz_person_posteingang on einsatz_person;
create trigger einsatz_person_posteingang after insert or update or delete on einsatz_person
  for each row execute function posteingang_einsatz_person();

-- Abwesenheit: das Team erfährt, wer fehlt. «Feiertag für alle» ist keine Nachricht.
create or replace function posteingang_abwesenheit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gleich boolean := tg_op = 'UPDATE' and new.mitarbeiter_id = old.mitarbeiter_id and new.datum = old.datum;
  art_alt text := case when tg_op <> 'INSERT' and old.art <> 'feiertag' then old.art end;
  art_neu text := case when tg_op <> 'DELETE' and new.art <> 'feiertag' then new.art end;
  v uuid;
begin
  begin
    if tg_op <> 'INSERT' then
      v := (select e.team_id from einsatz_person e where e.mitarbeiter_id = old.mitarbeiter_id and e.datum = old.datum);
      perform posteingang_person_aendern(old.firma_id, old.mitarbeiter_id, old.datum, v, v,
        art_alt, case when gleich then art_neu end, false);
    end if;
    if tg_op <> 'DELETE' and not gleich then
      v := (select e.team_id from einsatz_person e where e.mitarbeiter_id = new.mitarbeiter_id and e.datum = new.datum);
      perform posteingang_person_aendern(new.firma_id, new.mitarbeiter_id, new.datum, v, v, null, art_neu, false);
    end if;
  exception when others then
    raise warning 'Posteingang (abwesenheit): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists abwesenheit_posteingang on abwesenheit;
create trigger abwesenheit_posteingang after insert or update or delete on abwesenheit
  for each row execute function posteingang_abwesenheit();

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Korrektur: das Büro ändert gemeldete Stunden (freigabe_log, ohne Freigaben)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Ein Bündel je Zeile der Meldung: Team und Person sehen, was vorher stand, was jetzt gilt und warum.

create or replace function posteingang_korrektur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  z record;
  kopf jsonb;
begin
  if new.feld = 'status' then return null; end if;
  begin
    select ze.firma_id, ze.mitarbeiter_id, tm.team_id, tm.datum, m.name, t.bezeichnung as team
      into z
      from zeiteintrag ze
      join tagesmeldung tm on tm.id = ze.tagesmeldung_id
      left join mitarbeiter m on m.id = ze.mitarbeiter_id
      left join team t on t.id = tm.team_id
     where ze.id = new.zeiteintrag_id;
    if z.firma_id is null then return null; end if;
    kopf := jsonb_strip_nulls(jsonb_build_object('name', z.name, 'datum', z.datum, 'team', z.team, 'grund', new.begruendung));
    if z.team_id is not null then
      perform posteingang_posten(z.firma_id, 'team', z.team_id, null, 'korrektur', 'korrektur:team:' || new.zeiteintrag_id,
        z.datum, kopf, new.feld, new.feld, to_jsonb(new.alt), to_jsonb(new.neu));
    end if;
    if exists (select 1 from benutzer b where b.mitarbeiter_id = z.mitarbeiter_id) then
      perform posteingang_posten(z.firma_id, 'person', null, z.mitarbeiter_id, 'korrektur', 'korrektur:person:' || new.zeiteintrag_id,
        z.datum, kopf, new.feld, new.feld, to_jsonb(new.alt), to_jsonb(new.neu));
    end if;
  exception when others then
    raise warning 'Posteingang (freigabe_log): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists freigabe_log_posteingang on freigabe_log;
create trigger freigabe_log_posteingang after insert on freigabe_log
  for each row execute function posteingang_korrektur();

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Büro: Regierapporte beim Kunden (zustellung_log)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Rückfrage → zu tun, bis der Rapport neu gesendet oder bestätigt ist. Bestätigt → zur Kenntnis. Frist abgelaufen → zu
-- tun, bis bestätigt.

create or replace function posteingang_zustellung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  kopf jsonb;
begin
  if new.ereignis not in ('rueckfrage', 'bestaetigt', 'frist_abgelaufen', 'gesendet') then return null; end if;
  begin
    select rr.firma_id, rr.nummer, rr.frist_bis, posteingang_baustelle(rr.baustelle_id) as baustelle
      into r from regierapport rr where rr.id = new.regierapport_id;
    if r.firma_id is null then return null; end if;
    kopf := jsonb_strip_nulls(jsonb_build_object('nummer', r.nummer, 'baustelle', r.baustelle, 'von', new.an));

    if new.ereignis in ('bestaetigt', 'gesendet') then
      update posteingang set erledigt_am = now()
       where bezug_id = new.regierapport_id and erledigt_am is null and erstellt_am <= coalesce(new.zeitpunkt, now())
         and art in ('rueckfrage', 'frist') and (new.ereignis = 'bestaetigt' or art = 'rueckfrage');
    end if;

    if new.ereignis = 'rueckfrage' then
      insert into posteingang (firma_id, an, art, bezug_id, buendel, inhalt)
      values (r.firma_id, 'buero', 'rueckfrage', new.regierapport_id, 'rueckfrage:' || new.id,
              kopf || jsonb_strip_nulls(jsonb_build_object('kommentar', left(new.detail ->> 'kommentar', 500))))
      on conflict do nothing;
    elsif new.ereignis = 'bestaetigt' then
      insert into posteingang (firma_id, an, art, bezug_id, buendel, inhalt)
      values (r.firma_id, 'buero', 'bestaetigt', new.regierapport_id, 'bestaetigt:' || new.regierapport_id, kopf)
      on conflict do nothing;
    elsif new.ereignis = 'frist_abgelaufen' then
      insert into posteingang (firma_id, an, art, bezug_id, buendel, inhalt)
      values (r.firma_id, 'buero', 'frist', new.regierapport_id, 'frist:' || new.regierapport_id,
              kopf || jsonb_strip_nulls(jsonb_build_object('frist_bis', r.frist_bis)))
      on conflict do nothing;
    end if;
  exception when others then
    raise warning 'Posteingang (zustellung_log): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists zustellung_log_posteingang on zustellung_log;
create trigger zustellung_log_posteingang after insert on zustellung_log
  for each row execute function posteingang_zustellung();

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 8. Büro: Meldung mit Abweichung (tagesmeldung)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Wie im Cockpit: «länger gearbeitet» ohne Kunde erklärt nur den langen Tag — keine Nachricht. Erledigt, sobald das Büro
-- über Regie entschieden oder einen Rapport geschrieben hat. Ersetzt das Team die Meldung, gilt die neue.

create or replace function posteingang_tagesmeldung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'DELETE' then
      delete from posteingang where bezug_id = old.id and art = 'abweichung';
      return null;
    end if;
    if tg_op = 'INSERT' then
      if new.normalfall or (new.abweichung_typ = 'laenger' and new.wer_hats_gewollt is distinct from 'kunde') then return null; end if;
      insert into posteingang (firma_id, an, art, tag, bezug_id, buendel, inhalt)
      values (new.firma_id, 'buero', 'abweichung', new.datum, new.id, 'abweichung:' || new.id,
              jsonb_strip_nulls(jsonb_build_object(
                'team', (select bezeichnung from team where id = new.team_id), 'team_id', new.team_id,
                'baustelle', case when new.baustelle_id is not null then posteingang_baustelle(new.baustelle_id) end,
                'typ', new.abweichung_typ, 'wer', new.wer_hats_gewollt, 'text', left(new.transkript, 300))))
      on conflict do nothing;
      return null;
    end if;
    -- UPDATE: Text kommt nach der Transkription; Regie-Entscheid schliesst ab
    if new.transkript is distinct from old.transkript then
      update posteingang set inhalt = jsonb_strip_nulls(inhalt || jsonb_build_object('text', left(new.transkript, 300)))
       where bezug_id = new.id and art = 'abweichung';
    end if;
    if new.regie_entscheid is not null and old.regie_entscheid is null then
      update posteingang set erledigt_am = now() where bezug_id = new.id and art = 'abweichung' and erledigt_am is null;
    end if;
  exception when others then
    raise warning 'Posteingang (tagesmeldung): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists tagesmeldung_posteingang on tagesmeldung;
create trigger tagesmeldung_posteingang after insert or update or delete on tagesmeldung
  for each row execute function posteingang_tagesmeldung();

create or replace function posteingang_regierapport()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.tagesmeldung_id is not null then
      update posteingang set erledigt_am = now()
       where bezug_id = new.tagesmeldung_id and art = 'abweichung' and erledigt_am is null;
    end if;
  exception when others then
    raise warning 'Posteingang (regierapport): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists regierapport_posteingang on regierapport;
create trigger regierapport_posteingang after insert on regierapport
  for each row execute function posteingang_regierapport();

-- Nur die Auslöser rufen das auf
revoke all on function posteingang_posten(uuid, text, uuid, uuid, text, text, date, jsonb, text, text, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function posteingang_person_aendern(uuid, uuid, date, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function posteingang_jahresplan() from public, anon, authenticated;
revoke all on function posteingang_einsatz_person() from public, anon, authenticated;
revoke all on function posteingang_abwesenheit() from public, anon, authenticated;
revoke all on function posteingang_korrektur() from public, anon, authenticated;
revoke all on function posteingang_zustellung() from public, anon, authenticated;
revoke all on function posteingang_tagesmeldung() from public, anon, authenticated;
revoke all on function posteingang_regierapport() from public, anon, authenticated;
revoke all on function posteingang_einsatz(uuid, smallint, text, text) from public, anon;
revoke all on function posteingang_einsatz_sonst(uuid, uuid, date, uuid) from public, anon, authenticated;
revoke all on function posteingang_person(uuid, uuid, date, uuid, text) from public, anon, authenticated;
revoke all on function posteingang_team_von(uuid, date, uuid) from public, anon, authenticated;
revoke all on function posteingang_baustelle(uuid) from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 9. Aufräumen: nach 90 Tagen weg; Demo-Firma beim Neuladen leer
-- ────────────────────────────────────────────────────────────────────────────────────────────

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
  return n;
end;
$$;
revoke all on function posteingang_aufraeumen() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('posteingang_aufraeumen', '30 3 * * *', $job$select public.posteingang_aufraeumen();$job$);
  else
    raise notice 'pg_cron fehlt: posteingang_aufraeumen() bleibt ohne täglichen Lauf.';
  end if;
end $$;

-- Demo: nach dem Laden ist nichts «geändert» (wie der Verlauf der Planung, 0039)
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
  delete from posteingang where firma_id = f;
  return n;
end;
$$;

notify pgrst, 'reload schema';
