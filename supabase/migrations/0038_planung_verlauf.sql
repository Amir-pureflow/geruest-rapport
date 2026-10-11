-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0038 · Verlauf der Planung (11.10.2026, Mehmeti/Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- «Während der Woche gibt es Änderungen, und wenn die Woche vorbei ist, sieht die Einsatzplanung komplett anders aus
-- als geplant. Solange die Woche läuft, ist sie Entwurf. Archiv: zurückgehen und sehen, wo die Teams waren —
-- Historie.» (Meeting 10.10.2026)
--
-- Jede Änderung an Einsätzen (`jahresplan`) und an der Einteilung je Person und Tag (`einsatz_person`) schreibt die
-- Datenbank selbst mit — auch Löschen, auch aus einer alten App-Fassung. Daraus zeigt die Planung den Verlauf der
-- Woche und den «Plan vom Montag» (Stand zu Wochenbeginn, rückwärts aus dem Verlauf). Was wirklich war, kommt aus den
-- Meldungen. Nur lesen für die App; geschrieben wird nur über den Auslöser. Wiederholbar.

create table if not exists plan_verlauf (
  id           uuid primary key default gen_random_uuid(),
  firma_id     uuid not null references firma(id) on delete cascade,
  tabelle      text not null check (tabelle in ('jahresplan', 'einsatz_person')),
  datensatz_id uuid not null,
  aktion       text not null check (aktion in ('neu', 'geaendert', 'geloescht')),
  vorher       jsonb,
  nachher      jsonb,
  zeit         timestamptz not null default now(),
  von_wem      uuid default auth.uid()
);
create index if not exists plan_verlauf_firma_zeit_idx on plan_verlauf (firma_id, zeit);

alter table plan_verlauf enable row level security;
drop policy if exists plan_verlauf_lesen on plan_verlauf;
create policy plan_verlauf_lesen on plan_verlauf for select to authenticated using (firma_id = aktuelle_firma());
grant select on plan_verlauf to authenticated;
revoke insert, update, delete on plan_verlauf from authenticated;
revoke all on plan_verlauf from anon;

-- Auslöser: schreibt jede Änderung mit (als Besitzer, darum ohne eigene Schreibregel für die App)
create or replace function plan_verlauf_schreiben()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into plan_verlauf (firma_id, tabelle, datensatz_id, aktion, nachher)
    values (new.firma_id, tg_table_name, new.id, 'neu', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      insert into plan_verlauf (firma_id, tabelle, datensatz_id, aktion, vorher, nachher)
      values (new.firma_id, tg_table_name, new.id, 'geaendert', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into plan_verlauf (firma_id, tabelle, datensatz_id, aktion, vorher)
    values (old.firma_id, tg_table_name, old.id, 'geloescht', to_jsonb(old));
    return old;
  end if;
end;
$$;
revoke all on function plan_verlauf_schreiben() from public, anon, authenticated;

drop trigger if exists jahresplan_verlauf on jahresplan;
create trigger jahresplan_verlauf after insert or update or delete on jahresplan
  for each row execute function plan_verlauf_schreiben();

drop trigger if exists einsatz_person_verlauf on einsatz_person;
create trigger einsatz_person_verlauf after insert or update or delete on einsatz_person
  for each row execute function plan_verlauf_schreiben();

notify pgrst, 'reload schema';
