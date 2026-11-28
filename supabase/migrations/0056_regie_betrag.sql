-- 0056 · Regie-Betrag aus den Zeilen, auf 5 Rappen, beim Bestätigen eingefroren (Prüfung 28.11.2026)
--
-- Gefunden in der Prüfung (Branch `pruefung`, tests/rls/kundenlink.test.ts, tests/einheit/regie.test.ts):
--  1. Nach «bestätigt» konnte das Büro Betrag und Positionen noch ändern, und nirgends stand, WELCHER Betrag
--     bestätigt wurde.
--  2. Den Kopf-Betrag hat der Browser in 3–6 einzelnen Anfragen ohne Fehlerprüfung nachgeführt. Brach eine ab,
--     standen auf PDF und Kunden-Link andere Totale als unter den Zeilen. Ein Doppelklick konnte Etappe,
--     Lieferwagen oder Miete doppelt anlegen.
--  3. Das Bestätigen hat erst den Stand geprüft und dann ohne Bedingung geschrieben.
--  4. Entscheid Amir: das Total wird auf 5 Rappen gerundet.
--
-- Darum führt ab jetzt die Datenbank:
--  - Materialmiete-Zeile und Kopf-Betrag rechnen sich nach JEDER Änderung an den Positionen neu, in derselben
--    Transaktion. Kopf = Summe der Zeilen, auf 5 Rappen gerundet.
--  - Positionen lassen sich nur im Entwurf ändern. Etappe, Lieferwagen und Materialmiete gibt es je höchstens einmal.
--  - «bestätigt» nur aus einem Stand beim Kunden. Der Betrag wird dabei festgehalten (bestaetigt_betrag_rappen),
--    danach sind Stand, Betrag und Positionen gesperrt.
--
-- Bestehende Rapporte werden NICHT umgerechnet: Was beim Kunden liegt oder bestätigt ist, behält seinen Betrag.
-- Ein alter Entwurf rundet sich bei seiner nächsten Änderung.
-- Gleiche Regeln in der App (src/lib/tarif.ts rund5, materialmiete) und im PDF/Link (_shared/tarifklassen.ts).
-- Der Satz 9 % muss mit fixtures/tarife_sguv_2026.json übereinstimmen (Test: tests/rls/regie_betrag.test.ts).

alter table regierapport add column if not exists bestaetigt_betrag_rappen int;
comment on column regierapport.bestaetigt_betrag_rappen is
  'Betrag in Rappen, den der Kunde bestätigt hat — wird beim Übergang auf «bestaetigt» von der DB gesetzt (0056).';

-- Auf 5 Rappen runden (kaufmännisch, ab 2.5 Rappen aufwärts)
create or replace function regie_rund5(p_rappen bigint)
returns int
language sql
immutable
as $$ select (sign(p_rappen) * round(abs(p_rappen) / 5.0) * 5)::int $$;

-- Miete-Zeile und Kopf eines Rapports nachführen. Läuft als Definer, damit es auch dann rechnet, wenn eine
-- Sitzung nur einzelne Zeilen sieht. Der Aufruf kommt nur aus dem Trigger.
create or replace function regie_betrag_nachfuehren(p_rapport uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  basis bigint;
  miete int;
  total bigint;
begin
  select coalesce(sum(betrag_rappen), 0) into basis
  from regie_position where regierapport_id = p_rapport and tarif_code <> 'materialmiete';
  miete := round(basis * 9 / 100.0)::int;   -- 9 % pro Monat (tarife_sguv_2026.json: materialmiete_prozent)
  update regie_position set betrag_rappen = miete, ansatz_rappen = miete, menge_hundertstel = 100
  where regierapport_id = p_rapport and tarif_code = 'materialmiete' and betrag_rappen <> miete;
  select coalesce(sum(betrag_rappen), 0) into total from regie_position where regierapport_id = p_rapport;
  update regierapport set betrag_rappen = regie_rund5(total)
  where id = p_rapport and status = 'entwurf' and betrag_rappen is distinct from regie_rund5(total);
end;
$$;
revoke all on function regie_betrag_nachfuehren(uuid) from public, anon, authenticated;

-- Vor jeder Änderung an Positionen: nur im Entwurf, Einmal-Positionen nur einmal
create or replace function regie_position_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rid uuid := coalesce(new.regierapport_id, old.regierapport_id);
  stand text;
begin
  -- Nachführen der Miete-Zeile aus regie_betrag_nachfuehren (verschachtelt): ist schon geprüft
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  select status into stand from regierapport where id = rid;
  if stand is not null and stand <> 'entwurf' then
    raise exception 'Regierapport ist nicht mehr im Entwurf (Stand «%») — Positionen sind gesperrt', stand
      using errcode = 'P0001', hint = 'Zuerst auf Entwurf zurücknehmen. Ein bestätigter Rapport bleibt, wie er ist.';
  end if;
  if tg_op = 'UPDATE' and new.regierapport_id <> old.regierapport_id then
    raise exception 'Positionen können nicht in einen anderen Rapport verschoben werden';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.tarif_code in ('etappe', 'materialmiete', 'lieferwagen_35')
     and exists (select 1 from regie_position p
                 where p.regierapport_id = new.regierapport_id and p.tarif_code = new.tarif_code
                   and p.id <> new.id) then
    raise exception 'Position «%» ist schon vorhanden', new.tarif_code using errcode = '23505';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists regie_position_pruefen on regie_position;
create trigger regie_position_pruefen before insert or update or delete on regie_position
  for each row execute function regie_position_pruefen();

-- Nach jeder Änderung an Positionen: Miete und Kopf nachführen (einmal je Anweisung und Rapport).
-- Übergangstabellen brauchen je Ereignis einen eigenen Trigger
create or replace function regie_position_nachfuehren_neu() returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for rid in select distinct regierapport_id from neu_tab loop perform regie_betrag_nachfuehren(rid); end loop;
  return null;
end; $$;
create or replace function regie_position_nachfuehren_alt() returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for rid in select distinct regierapport_id from alt_tab loop perform regie_betrag_nachfuehren(rid); end loop;
  return null;
end; $$;

drop trigger if exists regie_position_nachfuehren_ins on regie_position;
drop trigger if exists regie_position_nachfuehren_upd on regie_position;
drop trigger if exists regie_position_nachfuehren_del on regie_position;
create trigger regie_position_nachfuehren_ins after insert on regie_position
  referencing new table as neu_tab for each statement execute function regie_position_nachfuehren_neu();
create trigger regie_position_nachfuehren_upd after update on regie_position
  referencing new table as neu_tab for each statement execute function regie_position_nachfuehren_neu();
create trigger regie_position_nachfuehren_del after delete on regie_position
  referencing old table as alt_tab for each statement execute function regie_position_nachfuehren_alt();

-- Kopf: Betrag im Entwurf immer aus den Zeilen; «bestätigt» nur vom Kunden-Stand; danach gesperrt
create or replace function regierapport_betrag_schutz()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  total bigint;
begin
  if old.status = 'bestaetigt' then
    if new.status is distinct from old.status
       or new.betrag_rappen is distinct from old.betrag_rappen
       or new.bestaetigt_betrag_rappen is distinct from old.bestaetigt_betrag_rappen
       or new.bestaetigt_am is distinct from old.bestaetigt_am then
      raise exception 'Regierapport ist bestätigt — Stand und Betrag sind gesperrt' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = 'bestaetigt' then
    if old.status not in ('versendet', 'rueckfrage', 'frist_abgelaufen') then
      raise exception 'Bestätigen geht nur, solange der Rapport beim Kunden ist (Stand «%»)', old.status using errcode = 'P0001';
    end if;
    new.bestaetigt_betrag_rappen := old.betrag_rappen;   -- der Betrag, den der Kunde gesehen hat
    new.betrag_rappen := old.betrag_rappen;
    new.bestaetigt_am := coalesce(new.bestaetigt_am, now());
    return new;
  end if;
  new.bestaetigt_betrag_rappen := null;

  -- Im Entwurf und beim Versenden gilt der Betrag aus den Zeilen, egal was der Browser schickt
  if (new.status = 'entwurf' or old.status = 'entwurf')
     and exists (select 1 from regie_position where regierapport_id = new.id) then
    select coalesce(sum(betrag_rappen), 0) into total from regie_position where regierapport_id = new.id;
    new.betrag_rappen := regie_rund5(total);
  elsif old.status <> 'entwurf' then
    new.betrag_rappen := old.betrag_rappen;   -- beim Kunden: Betrag bleibt
  end if;
  return new;
end;
$$;

drop trigger if exists regierapport_betrag_schutz on regierapport;
create trigger regierapport_betrag_schutz before update on regierapport
  for each row execute function regierapport_betrag_schutz();

-- Ein bestätigter Rapport lässt sich nicht löschen
create or replace function regierapport_loeschen_schutz()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'bestaetigt' then
    raise exception 'Bestätigter Regierapport kann nicht gelöscht werden' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
drop trigger if exists regierapport_loeschen_schutz on regierapport;
create trigger regierapport_loeschen_schutz before delete on regierapport
  for each row execute function regierapport_loeschen_schutz();

notify pgrst, 'reload schema';
