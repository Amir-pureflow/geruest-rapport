-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0053 · «Fehlt melden» mit Ersatzvorschlag (25.10.2026, Caturix-Analyse Schritt 6, K03 ohne Sprachnachricht)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Heute ruft der Chefmonteur um 6:45 im Büro an, wenn jemand nicht kommt. Neu tippt er auf der Karte «Heute» oder
-- «Morgen» auf den Namen und «Fehlt». Das Büro sieht es sofort im Posteingang; die Planung zählt die Person an dem Tag
-- nicht mehr mit und schlägt Ersatz vor. Freiwillig: wer lieber anruft, ruft an.
--
-- Eine Fehlmeldung ist KEINE Abwesenheit: Abwesenheiten zählen für den Lohn (bezahlte Stunden), die trägt nur das Büro ein.
-- Sie bleibt «offen», bis das Büro sie erledigt — als Abwesenheit eintragen (dann «bestätigt», auch automatisch, sobald
-- für Person und Tag eine Abwesenheit entsteht) oder «ist doch da» (verworfen). Keine Diagnose, kein Grund (nDSG).
--
-- Schreiben nur über die Funktionen: der Chefmonteur für sein Team, für heute oder den nächsten Arbeitstag, und nur für
-- Leute, die an dem Tag in seinem Team sind; zurücknehmen, solange offen. Das Büro für jedes Team ab heute.
-- Wiederholbar.

create table if not exists fehlmeldung (
  id             uuid primary key default gen_random_uuid(),
  firma_id       uuid not null references firma(id) on delete cascade,
  mitarbeiter_id uuid not null references mitarbeiter(id) on delete cascade,
  team_id        uuid not null references team(id) on delete cascade,
  datum          date not null,
  status         text not null default 'offen' check (status in ('offen', 'bestaetigt', 'verworfen')),
  gemeldet_von   uuid default auth.uid(),
  gemeldet_am    timestamptz not null default now(),
  erledigt_von   uuid,
  erledigt_am    timestamptz,
  unique (mitarbeiter_id, datum)
);
create index if not exists fehlmeldung_firma_datum_idx on fehlmeldung (firma_id, datum);

alter table fehlmeldung enable row level security;
drop policy if exists fehlmeldung_lesen on fehlmeldung;
create policy fehlmeldung_lesen on fehlmeldung for select to authenticated using (firma_id = aktuelle_firma());
grant select on fehlmeldung to authenticated;
revoke insert, update, delete on fehlmeldung from authenticated;
revoke all on fehlmeldung from anon;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Melden, zurücknehmen, erledigen
-- ────────────────────────────────────────────────────────────────────────────────────────────

-- Ist die Person an dem Tag in diesem Team? Eingeteilt (einsatz_person) oder fest im Team und nicht anderswo eingeteilt.
create or replace function fehlmeldung_im_team(p_person uuid, p_team uuid, p_datum date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select e.team_id = p_team from einsatz_person e where e.mitarbeiter_id = p_person and e.datum = p_datum),
    exists (select 1 from team_mitglied tm where tm.team_id = p_team and tm.mitarbeiter_id = p_person
             and (tm.von is null or tm.von <= p_datum) and (tm.bis is null or tm.bis >= p_datum)));
$$;

create or replace function fehlt_melden(p_person uuid, p_team uuid, p_datum date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := aktuelle_firma();
  r text := aktuelle_rolle();
  heute date := heute_ch();
  art_da text;
  neu uuid;
begin
  if f is null or auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if not exists (select 1 from team t where t.id = p_team and t.firma_id = f and t.aktiv
                   and (r = 'buero' or (r = 'chef' and t.chefmonteur_id = eigene_person()))) then
    raise exception 'Für dieses Team nicht erlaubt' using errcode = '42501';
  end if;
  if not exists (select 1 from mitarbeiter m where m.id = p_person and m.firma_id = f and m.aktiv) then
    raise exception 'Person nicht gefunden' using errcode = '42501';
  end if;
  if p_datum < heute or (r <> 'buero' and p_datum not in (heute, naechster_arbeitstag(heute))) then
    raise exception 'Nur für heute oder den nächsten Arbeitstag' using errcode = '22023';
  end if;
  if not fehlmeldung_im_team(p_person, p_team, p_datum) then
    raise exception 'Die Person ist an dem Tag nicht in diesem Team' using errcode = '22023';
  end if;
  select a.art into art_da from abwesenheit a where a.mitarbeiter_id = p_person and a.datum = p_datum;
  if art_da is not null then
    raise exception 'Ist für den Tag schon als abwesend eingetragen' using errcode = '22023';
  end if;
  -- Nochmals melden (z. B. nach «ist doch da») öffnet die Meldung wieder
  insert into fehlmeldung (firma_id, mitarbeiter_id, team_id, datum)
  values (f, p_person, p_team, p_datum)
  on conflict (mitarbeiter_id, datum) do update
     set team_id = excluded.team_id, status = 'offen', gemeldet_von = auth.uid(), gemeldet_am = now(),
         erledigt_von = null, erledigt_am = null
  returning id into neu;
  return neu;
end;
$$;

-- Zurücknehmen (vertippt, kam doch): der Chefmonteur seines Teams, solange offen; das Büro immer
create or replace function fehlt_zuruecknehmen(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := aktuelle_rolle();
begin
  delete from fehlmeldung fm
   where fm.id = p_id and fm.firma_id = aktuelle_firma()
     and (r = 'buero' or (r = 'chef' and fm.status = 'offen'
          and exists (select 1 from team t where t.id = fm.team_id and t.chefmonteur_id = eigene_person())));
  if not found then
    raise exception 'Nicht (mehr) möglich' using errcode = '42501';
  end if;
end;
$$;

-- Büro: erledigt — 'bestaetigt' (Abwesenheit eingetragen) oder 'verworfen' (ist doch da)
create or replace function fehlmeldung_erledigen(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ist_buero() then raise exception 'Nur das Büro' using errcode = '42501'; end if;
  if p_status not in ('bestaetigt', 'verworfen') then raise exception 'Unbekannter Stand' using errcode = '22023'; end if;
  update fehlmeldung set status = p_status, erledigt_von = auth.uid(), erledigt_am = now()
   where id = p_id and firma_id = aktuelle_firma();
end;
$$;

revoke all on function fehlmeldung_im_team(uuid, uuid, date) from public, anon, authenticated;
revoke all on function fehlt_melden(uuid, uuid, date) from public, anon;
revoke all on function fehlt_zuruecknehmen(uuid) from public, anon;
revoke all on function fehlmeldung_erledigen(uuid, text) from public, anon;
grant execute on function fehlt_melden(uuid, uuid, date) to authenticated;
grant execute on function fehlt_zuruecknehmen(uuid) to authenticated;
grant execute on function fehlmeldung_erledigen(uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Posteingang des Büros und Abwesenheit
-- ────────────────────────────────────────────────────────────────────────────────────────────

alter table posteingang drop constraint if exists posteingang_art_check;
alter table posteingang add constraint posteingang_art_check
  check (art in ('plan', 'korrektur', 'rueckfrage', 'bestaetigt', 'frist', 'abweichung', 'fehlt'));

create or replace function posteingang_fehlmeldung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'DELETE' then
      delete from posteingang where bezug_id = old.id and art = 'fehlt';
      return null;
    end if;
    if new.status = 'offen' and (tg_op = 'INSERT' or old.status <> 'offen' or old.gemeldet_am is distinct from new.gemeldet_am) then
      -- Neu gemeldet (oder wieder geöffnet): frischer, ungelesener Eintrag
      delete from posteingang where bezug_id = new.id and art = 'fehlt';
      insert into posteingang (firma_id, an, art, tag, bezug_id, inhalt)
      values (new.firma_id, 'buero', 'fehlt', new.datum, new.id, jsonb_strip_nulls(jsonb_build_object(
        'name', (select name from mitarbeiter where id = new.mitarbeiter_id),
        'team', (select bezeichnung from team where id = new.team_id), 'team_id', new.team_id,
        'mitarbeiter_id', new.mitarbeiter_id, 'gemeldet_am', new.gemeldet_am)));
    elsif new.status <> 'offen' then
      update posteingang set erledigt_am = now() where bezug_id = new.id and art = 'fehlt' and erledigt_am is null;
    end if;
  exception when others then
    raise warning 'Posteingang (fehlmeldung): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists fehlmeldung_posteingang on fehlmeldung;
create trigger fehlmeldung_posteingang after insert or update or delete on fehlmeldung
  for each row execute function posteingang_fehlmeldung();

-- Trägt das Büro für Person und Tag eine Abwesenheit ein, ist die Fehlmeldung erledigt
create or replace function fehlmeldung_abwesenheit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update fehlmeldung set status = 'bestaetigt', erledigt_von = auth.uid(), erledigt_am = now()
     where mitarbeiter_id = new.mitarbeiter_id and datum = new.datum and status = 'offen';
  exception when others then
    raise warning 'Fehlmeldung (abwesenheit): %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists abwesenheit_fehlmeldung on abwesenheit;
create trigger abwesenheit_fehlmeldung after insert or update on abwesenheit
  for each row execute function fehlmeldung_abwesenheit();

revoke all on function posteingang_fehlmeldung() from public, anon, authenticated;
revoke all on function fehlmeldung_abwesenheit() from public, anon, authenticated;

-- Demo: Fehlmeldungen gehören zum Verlauf, der nach dem Laden leer ist (0039/0051)
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
  delete from fehlmeldung where firma_id = f;
  delete from posteingang where firma_id = f;
  return n;
end;
$$;

notify pgrst, 'reload schema';
