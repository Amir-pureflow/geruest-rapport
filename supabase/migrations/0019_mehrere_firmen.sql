-- 0019: Mehrere Firmen in einer Datenbank (Entscheid 02.10.2026, Amir).
--
-- Vorher: eine Datenbank je Firma. Das hiess pro Kunde ein Supabase-Projekt, ein Deployment,
-- jede Migration von Hand, ein Abonnement. Amir zu Recht: «das ist doch gar nicht gut.»
--
-- Jetzt: eine Datenbank für alle. Jeder Datensatz trägt seine Firma, und die Datenbank setzt die
-- Trennung durch — nicht die Oberfläche. Wer als Gerüst GmbH angemeldet ist, bekommt We-Plans
-- Zeilen gar nicht erst zu sehen, auch nicht mit dem öffentlichen Schlüssel und einem eigenen
-- Programm. Eine neue Firma ist danach eine Zeile und ein Zugang, kein Projekt.
--
-- Die Schalter (Regie oder Wochenblatt, Sekretariat, Mehrkostenanzeige) wandern aus
-- `konfiguration` in die Zeile der Firma. Erst dadurch kann dieselbe App der einen Firma die
-- Regie-Fassung zeigen und der anderen das Wochenblatt.
--
-- REIHENFOLGE, bitte einhalten:
--   1. Supabase › Authentication › Sign In / Providers › Email: «Confirm email» AUS.
--   2. Die beiden Firmen-Zugänge anlegen (macht Claude, ein Befehl).
--   3. Diese Migration ausführen. Sie sucht die Zugänge an ihrer Mailadresse.
--   4. Die neue App-Fassung ausliefern.
-- Läuft sie vor Schritt 2, bleiben die Firmen ohne Zugang. Das ist kein Schaden: einfach die
-- Zugänge anlegen und den letzten Block dieser Datei nochmals ausführen.
--
-- Was diese Migration NICHT macht: innerhalb einer Firma unterscheidet sie weiterhin niemanden.
-- Bauführer, Sekretariat und Teamgerät teilen sich den Zugang der Firma. Persönliche Konten und
-- Rechte je Rolle sind der nächste Schritt; `benutzer` ist dafür schon vorbereitet.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Firma und Zugang
-- ════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists firma (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  aktiv boolean not null default true,
  -- Die Schalter, bisher global in `konfiguration` (Migration 0017)
  modus_erfassung         text    not null default 'wochenblatt' check (modus_erfassung in ('wochenblatt', 'regie')),
  modus_sekretariat       text    not null default 'stunden'     check (modus_sekretariat in ('stunden', 'voll')),
  modus_mehrkostenanzeige boolean not null default false,
  erstellt_am timestamptz not null default now()
);

-- Welcher Zugang gehört zu welcher Firma. Später kommt hier die Rolle je Person dazu.
create table if not exists benutzer (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  firma_id     uuid not null references firma (id) on delete cascade,
  bezeichnung  text,
  erstellt_am  timestamptz not null default now()
);

create index if not exists benutzer_firma_idx on benutzer (firma_id);

/**
 * Die Firma der angemeldeten Sitzung. Jede Regel unten vergleicht damit.
 *
 * `security definer`, weil die Regel auf `benutzer` sonst sich selbst prüfen müsste.
 * `stable`, damit Postgres sie je Abfrage einmal auswertet und nicht je Zeile.
 * Gibt null zurück, wenn niemand angemeldet ist — dann trifft keine Regel zu und man sieht nichts.
 */
create or replace function aktuelle_firma()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select firma_id from benutzer where auth_user_id = auth.uid();
$$;

revoke all on function aktuelle_firma() from public;
grant execute on function aktuelle_firma() to authenticated;

alter table firma    enable row level security;
alter table benutzer enable row level security;

drop policy if exists firma_eigene on firma;
create policy firma_eigene on firma
  for select to authenticated
  using (id = aktuelle_firma());

-- Die Schalter darf die Firma selbst umlegen (Verwaltung → Einstellungen), sonst nichts.
drop policy if exists firma_eigene_aendern on firma;
create policy firma_eigene_aendern on firma
  for update to authenticated
  using (id = aktuelle_firma())
  with check (id = aktuelle_firma());

drop policy if exists benutzer_eigener on benutzer;
create policy benutzer_eigener on benutzer
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Die beiden Firmen
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Gerüst GmbH (Arbnor): Wochenblatt, keine Regie. We-Plan: die volle Fassung mit Regie.

insert into firma (name, modus_erfassung, modus_sekretariat, modus_mehrkostenanzeige) values
  ('Gerüst GmbH', 'wochenblatt', 'stunden', false),
  ('We-Plan',     'regie',       'voll',    true)
on conflict (name) do nothing;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Firmenspalte auf den Daten
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Direkt auf den Tabellen, die die App abfragt. Die Kindtabellen (Zeilen, die ohne ihren Vater
-- keinen Sinn haben) erben über ihren Vater — eine Spalte weniger, die falsch sein kann.

do $$
declare t text;
begin
  foreach t in array array[
    'mitarbeiter', 'team', 'baustelle', 'kunde', 'jahresplan',
    'tagesmeldung', 'zeiteintrag', 'zusatzauftrag', 'regierapport'
  ] loop
    execute format('alter table %I add column if not exists firma_id uuid references firma (id)', t);
    execute format('create index if not exists %I on %I (firma_id)', t || '_firma_idx', t);
  end loop;
end $$;

-- ── Bestehende Daten zuordnen ────────────────────────────────────────────────────────────────
-- Der ganze Demobetrieb gehört zu We-Plan. Arbnors echtes Team und seine zwei Leute zur Gerüst GmbH.
do $$
declare
  v_weplan uuid;
  v_geruest uuid;
  t text;
begin
  select id into v_weplan  from firma where name = 'We-Plan';
  select id into v_geruest from firma where name = 'Gerüst GmbH';

  -- Erst alles pauschal zu We-Plan …
  foreach t in array array[
    'mitarbeiter', 'team', 'baustelle', 'kunde', 'jahresplan',
    'tagesmeldung', 'zeiteintrag', 'zusatzauftrag', 'regierapport'
  ] loop
    execute format('update %I set firma_id = $1 where firma_id is null', t) using v_weplan;
  end loop;

  -- … dann Arbnors echte Daten herausnehmen. Über die Namen, nicht über Nummern:
  -- die Namen stehen in Arbnors Nachricht vom 02.10. und sind eindeutig.
  update mitarbeiter set firma_id = v_geruest where name in ('Nuhi Vaiti', 'Ismail Vaiti');
  update team         set firma_id = v_geruest where bezeichnung = 'Team Vaiti';
end $$;

-- ── Kontonummern gehören der Firma, nicht der Datenbank ──────────────────────────────────────
-- `baustelle.konto_nr` war weltweit eindeutig. Mit mehreren Firmen ist das falsch: jede Firma
-- nummeriert ihre Baustellen selbst, und zwei Firmen dürfen dieselbe Nummer führen.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'baustelle'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (konto_nr)'
  loop
    execute format('alter table baustelle drop constraint %I', r.conname);
  end loop;
end $$;

alter table baustelle drop constraint if exists baustelle_firma_konto_nr_key;
alter table baustelle add constraint baustelle_firma_konto_nr_key unique (firma_id, konto_nr);

-- ── Die Gerüst GmbH braucht ihre eigenen Baustellen ──────────────────────────────────────────
-- Die 217 Konten stammen aus Arbnors Liste, hängen aber am Demobetrieb von We-Plan (Meldungen,
-- Jahresplan, Rapporte zeigen darauf). Darum bleiben die Originale bei We-Plan, und die Gerüst
-- GmbH bekommt dieselben Konten als eigene Zeilen — ohne Kunde, den trägt Arbnor selbst ein.
do $$
declare
  v_weplan uuid;
  v_geruest uuid;
begin
  select id into v_weplan  from firma where name = 'We-Plan';
  select id into v_geruest from firma where name = 'Gerüst GmbH';

  insert into baustelle (konto_nr, strasse, plz, ort, bezeichnung, status, kunde_id, firma_id)
  select b.konto_nr, b.strasse, b.plz, b.ort, b.bezeichnung, 'aktiv', null, v_geruest
    from baustelle b
   where b.firma_id = v_weplan
     and not exists (select 1 from baustelle x where x.firma_id = v_geruest and x.konto_nr = b.konto_nr);
end $$;

-- Ab jetzt Pflicht: eine Zeile ohne Firma wäre eine Zeile, die niemand sieht und niemand löscht.
do $$
declare t text;
begin
  foreach t in array array[
    'mitarbeiter', 'team', 'baustelle', 'kunde', 'jahresplan',
    'tagesmeldung', 'zeiteintrag', 'zusatzauftrag', 'regierapport'
  ] loop
    execute format('alter table %I alter column firma_id set not null', t);
    -- Neue Zeilen bekommen die Firma der Sitzung, ohne dass die App etwas mitschicken muss.
    execute format('alter table %I alter column firma_id set default aktuelle_firma()', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Die Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Zuerst die Übergangsregeln von 0001 weg («eingeloggt darf alles»). Sie werden mit allen
-- anderen bestehenden Regeln dieser Tabellen entfernt — Regeln gelten als ODER, eine einzige
-- gebliebene Regel mit `using (true)` würde alles andere wirkungslos machen.

do $$
declare r record;
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename = any (array[
         'kunde', 'baustelle', 'mitarbeiter', 'team', 'team_mitglied', 'jahresplan',
         'planaenderung', 'tagesmeldung', 'zeiteintrag', 'zusatzauftrag', 'regierapport',
         'regie_position', 'zustellung_log', 'freigabe_log', 'foto'
       ])
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── Tabellen mit eigener Firmenspalte ────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'mitarbeiter', 'team', 'baustelle', 'kunde', 'jahresplan',
    'tagesmeldung', 'zeiteintrag', 'zusatzauftrag', 'regierapport'
  ] loop
    execute format(
      'create policy %I on %I for all to authenticated using (firma_id = aktuelle_firma()) with check (firma_id = aktuelle_firma())',
      t || '_firma', t
    );
  end loop;
end $$;

-- ── Kindtabellen: über den Vater ─────────────────────────────────────────────────────────────
create policy team_mitglied_firma on team_mitglied
  for all to authenticated
  using      (exists (select 1 from team t where t.id = team_mitglied.team_id and t.firma_id = aktuelle_firma()))
  with check (exists (select 1 from team t where t.id = team_mitglied.team_id and t.firma_id = aktuelle_firma()));

create policy freigabe_log_firma on freigabe_log
  for all to authenticated
  using      (exists (select 1 from zeiteintrag z where z.id = freigabe_log.zeiteintrag_id and z.firma_id = aktuelle_firma()))
  with check (exists (select 1 from zeiteintrag z where z.id = freigabe_log.zeiteintrag_id and z.firma_id = aktuelle_firma()));

create policy regie_position_firma on regie_position
  for all to authenticated
  using      (exists (select 1 from regierapport r where r.id = regie_position.regierapport_id and r.firma_id = aktuelle_firma()))
  with check (exists (select 1 from regierapport r where r.id = regie_position.regierapport_id and r.firma_id = aktuelle_firma()));

create policy zustellung_log_firma on zustellung_log
  for all to authenticated
  using      (exists (select 1 from regierapport r where r.id = zustellung_log.regierapport_id and r.firma_id = aktuelle_firma()))
  with check (exists (select 1 from regierapport r where r.id = zustellung_log.regierapport_id and r.firma_id = aktuelle_firma()));

create policy planaenderung_firma on planaenderung
  for all to authenticated
  using      (exists (select 1 from jahresplan j where j.id = planaenderung.jahresplan_id and j.firma_id = aktuelle_firma()))
  with check (exists (select 1 from jahresplan j where j.id = planaenderung.jahresplan_id and j.firma_id = aktuelle_firma()));

-- Ein Foto hängt entweder an einer Tagesmeldung oder an einem Regierapport.
create policy foto_firma on foto
  for all to authenticated
  using (
    exists (select 1 from tagesmeldung m where m.id = foto.tagesmeldung_id and m.firma_id = aktuelle_firma())
    or exists (select 1 from regierapport r where r.id = foto.regierapport_id and r.firma_id = aktuelle_firma())
  )
  with check (
    exists (select 1 from tagesmeldung m where m.id = foto.tagesmeldung_id and m.firma_id = aktuelle_firma())
    or exists (select 1 from regierapport r where r.id = foto.regierapport_id and r.firma_id = aktuelle_firma())
  );

-- `tarif` bleibt für alle lesbar: das sind die SGUV-Ansätze, kein Firmengeheimnis.
-- Die Übergangsregel von 0001 wird dort nicht angefasst.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Die Zugänge mit den Firmen verbinden
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Sucht die Konten an ihrer Mailadresse. Fehlt eines, passiert hier nichts — dann das Konto
-- anlegen und nur diesen Block nochmals ausführen.

insert into benutzer (auth_user_id, firma_id, bezeichnung)
select u.id, f.id, f.name
  from auth.users u
  join firma f on f.name = case u.email
                             when 'arbnor@rapporto.pureflow-ai.com'  then 'Gerüst GmbH'
                             when 'we-plan@rapporto.pureflow-ai.com' then 'We-Plan'
                           end
 where u.email in ('arbnor@rapporto.pureflow-ai.com', 'we-plan@rapporto.pureflow-ai.com')
on conflict (auth_user_id) do update set firma_id = excluded.firma_id, bezeichnung = excluded.bezeichnung;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 6. Aufräumen
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Die Schalter stehen jetzt bei der Firma. Die alten globalen Zeilen würden sonst widersprechen.
delete from konfiguration where schluessel in
  ('MODUS_ERFASSUNG', 'MODUS_SEKRETARIAT', 'MODUS_MEHRKOSTENANZEIGE', 'MODUS_ANMELDUNG');

drop policy if exists konfiguration_modus_lesen on konfiguration;
drop policy if exists konfiguration_modus_schreiben on konfiguration;

-- Anonyme Sitzungen sind ab jetzt wertlos: ohne Eintrag in `benutzer` gibt es keine Firma und
-- damit keine einzige sichtbare Zeile. Im Supabase-Dashboard darf «Allow anonymous sign-ins»
-- deshalb ausgeschaltet werden.
