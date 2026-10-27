-- 0054 Wetter in der Planung (25.10.2026, Amir: «eine Wettervorschau pro Baustelle in der Planung, z. B. Regen oder
-- Sturm am Mittwoch»).
--
-- Quelle: MeteoSchweiz, Lokalprognose (Open Data, frei auch für Firmen, «Quelle: MeteoSchweiz» muss sichtbar sein).
-- Rund 6000 Punkte (Wetterstationen, Postleitzahlen, Berge), 9 Tage, stündlich neu. Die Edge Function `wetter-laden`
-- holt alle zwei Stunden die Tageswerte (Symbol, Höchst-/Tiefstwert, Regen) und die Böenspitzen (06–18 Uhr) — nur für
-- die Punkte, die eine Baustelle oder ein Werkhof braucht — und legt sie in `wetter` ab.
--
-- Welcher Punkt gehört zu einer Baustelle? Mit Koordinaten der nächste PLZ-Mittelpunkt, sonst der Punkt der PLZ.
-- Ohne beides kein Wetter (dann zeigt die Planung das Wetter im Gebiet der Firma).
--
-- Für die App: `wetter_tage(von, bis)` — Wetter der eingeplanten Baustellen der eigenen Firma und des Gebiets der Firma
-- (Werkhof, sonst Mitte der Baustellen mit Ort).

create table if not exists wetter_ort (
  typ        smallint not null,           -- 1 Wetterstation, 2 Postleitzahl (Berge lassen wir weg)
  punkt_id   integer  not null,           -- nur je Typ eindeutig
  plz        text,
  name       text not null,
  lat        double precision not null,
  lon        double precision not null,
  geladen_am timestamptz not null default now(),
  primary key (typ, punkt_id)
);
create index if not exists wetter_ort_plz on wetter_ort (plz) where typ = 2;
alter table wetter_ort enable row level security; -- keine Policies: nur die Function (service_role) liest und schreibt

create table if not exists wetter (
  typ      smallint not null,
  punkt_id integer  not null,
  datum    date     not null,
  symbol   smallint,      -- MeteoSchweiz-Piktogramm-Nummer, tagsüber (jp2000d0)
  tmax     real,          -- °C, Tageshöchstwert Ortszeit (tre200px)
  tmin     real,          -- °C, Tagestiefstwert Ortszeit (tre200pn)
  regen_mm real,          -- mm, Tagessumme Ortszeit (rka150p0)
  boe_kmh  real,          -- km/h, stärkste Böe 06–18 Uhr Ortszeit (fu3010h1)
  lauf     timestamptz,   -- Prognoselauf (UTC)
  primary key (typ, punkt_id, datum)
);
alter table wetter enable row level security;
drop policy if exists wetter_lesen on wetter;
create policy wetter_lesen on wetter for select to authenticated using (true); -- öffentliches Wetter, keine Firmendaten

-- Wetterpunkt eines Ortes: mit Koordinaten der nächste PLZ-Mittelpunkt, sonst die PLZ selbst
create or replace function wetter_punkt(p_plz text, p_lat double precision, p_lon double precision)
returns table (typ smallint, punkt_id integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_lat is not null and p_lon is not null then
    return query
      select o.typ, o.punkt_id from wetter_ort o
       where o.typ = 2
       order by (o.lat - p_lat) ^ 2 + ((o.lon - p_lon) * 0.68) ^ 2  -- 0.68 ≈ cos 47°: Längengrade sind hier kürzer
       limit 1;
    return;
  end if;
  if p_plz is not null then
    return query select o.typ, o.punkt_id from wetter_ort o where o.typ = 2 and o.plz = p_plz order by o.punkt_id limit 1;
  end if;
end;
$$;
revoke all on function wetter_punkt(text, double precision, double precision) from public, anon, authenticated;

-- Gebiet einer Firma: Werkhof, sonst die Mitte ihrer Baustellen mit Koordinaten
create or replace function wetter_gebiet(p_firma uuid)
returns table (lat double precision, lon double precision)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(f.werkhof_lat, b.lat), coalesce(f.werkhof_lon, b.lon)
    from firma f
    left join lateral (select avg(x.lat) as lat, avg(x.lon) as lon from baustelle x
                        where x.firma_id = f.id and x.lat is not null and x.lon is not null) b on true
   where f.id = p_firma and coalesce(f.werkhof_lat, b.lat) is not null;
$$;
revoke all on function wetter_gebiet(uuid) from public, anon, authenticated;

-- Für die Function: welche Punkte gebraucht werden (alle Firmen) — offene Baustellen mit Ort und das Gebiet jeder Firma
create or replace function wetter_punkte_noetig()
returns table (typ smallint, punkt_id integer)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.typ, p.punkt_id
    from baustelle b
    cross join lateral wetter_punkt(b.plz, b.lat, b.lon) p
   where b.status <> 'abgeschlossen' and (b.lat is not null or b.plz is not null)
  union
  select p.typ, p.punkt_id
    from firma f
    cross join lateral wetter_gebiet(f.id) g
    cross join lateral wetter_punkt(null, g.lat, g.lon) p;
$$;
revoke all on function wetter_punkte_noetig() from public, anon, authenticated;
grant execute on function wetter_punkte_noetig() to service_role;

-- Für die App: Wetter der Baustellen, die zwischen p_von und p_bis eingeplant sind, und des Gebiets der Firma
-- (baustelle_id null). Nur die eigene Firma.
create or replace function wetter_tage(p_von date, p_bis date)
returns table (baustelle_id uuid, datum date, symbol smallint, tmax real, tmin real, regen_mm real, boe_kmh real, lauf timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f uuid := aktuelle_firma();
begin
  if f is null or p_bis < p_von or p_bis - p_von > 31 then return; end if;
  return query
    with orte as (
      select b.id as bid, p.typ, p.punkt_id
        from baustelle b
        cross join lateral wetter_punkt(b.plz, b.lat, b.lon) p
       where b.firma_id = f
         and exists (select 1 from jahresplan j where j.baustelle_id = b.id and j.von <= p_bis and j.bis >= p_von)
      union all
      select null::uuid, p.typ, p.punkt_id
        from wetter_gebiet(f) g
        cross join lateral wetter_punkt(null, g.lat, g.lon) p
    )
    select o.bid, w.datum, w.symbol, w.tmax, w.tmin, w.regen_mm, w.boe_kmh, w.lauf
      from orte o
      join wetter w on w.typ = o.typ and w.punkt_id = o.punkt_id
     where w.datum between p_von and p_bis;
end;
$$;
revoke all on function wetter_tage(date, date) from public, anon;
grant execute on function wetter_tage(date, date) to authenticated;

-- Geheimnis für den Aufruf der Function (wie PUSH_GEHEIM) — zufällig, nie angezeigt
insert into konfiguration (schluessel, wert)
values ('WETTER_GEHEIM', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (schluessel) do nothing;

-- Alle zwei Stunden: Tageswerte und Böen in zwei Aufrufen (jeder bleibt so unter der Rechenzeit der Function)
create or replace function wetter_anstossen()
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
  select wert into geheim from konfiguration where schluessel = 'WETTER_GEHEIM';
  if basis is null or geheim is null then return; end if;
  perform net.http_post(
    url     := rtrim(basis, '/') || '/functions/v1/wetter-laden',
    body    := '{"teil":"tage"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-wetter-geheim', geheim),
    timeout_milliseconds := 60000);
  perform net.http_post(
    url     := rtrim(basis, '/') || '/functions/v1/wetter-laden',
    body    := '{"teil":"boeen"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-wetter-geheim', geheim),
    timeout_milliseconds := 60000);
  -- Vergangenes weg (gestern bleibt für den Vergleich)
  delete from wetter where datum < (now() at time zone 'Europe/Zurich')::date - 1;
end;
$$;
revoke all on function wetter_anstossen() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wetter_laden', '25 */2 * * *', $job$select public.wetter_anstossen();$job$);
  else
    raise notice 'pg_cron fehlt: wetter_anstossen() läuft nicht von selbst.';
  end if;
end $$;
