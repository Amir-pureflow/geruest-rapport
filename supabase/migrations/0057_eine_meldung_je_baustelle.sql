-- 0057 · Eine Meldung je Team, Tag und Baustelle (Entscheid Amir 28.11.2026: «nur einmal melden oder ersetzen»)
--
-- Gefunden in der Prüfung (tests/rls/geraete.test.ts): Zwei Geräte (oder ein Gerät nach einem Funkloch) melden
-- dasselbe Team am selben Tag auf derselben Baustelle. Beide Meldungen zählten, die Stunden standen doppelt in Lohn und
-- Regie. Die Erfassung bot dafür sogar «Zusätzlich speichern» an, gedacht für eine ZWEITE Baustelle.
--
-- Ab jetzt lehnt die Datenbank eine zweite normale Meldung (normalfall) für dasselbe Team, denselben Tag und dieselbe
-- Baustelle ab. Abweichungen und Zusatzarbeit (normalfall = false) und eine zweite Baustelle am selben Tag gehen weiter.
-- Dasselbe Gerät darf dieselbe Meldung beliebig oft wieder senden (gleiche client_uuid, Funkloch).
--
-- Warum ein Trigger und kein eindeutiger Index: Ein Index liesse sich auf einer Datenbank mit alten Doppelmeldungen gar
-- nicht anlegen. Alte Doppelte bleiben, wie sie sind (der Bauführer sieht sie in der Wochenübersicht), neue gibt es
-- nicht mehr. Gleichzeitige Meldungen warten über eine Sperre je Team, Tag und Baustelle aufeinander.
--
-- Die App erkennt den Fehlercode RPD01. Die Meldung bleibt mit dem Grund auf dem Gerät, es geht nichts verloren
-- (src/lib/db.ts fehlerDeuten). Der Chefmonteur kann dann «Frühere ersetzen» wählen.

create or replace function tagesmeldung_eine_je_baustelle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  andere uuid;
begin
  if not new.normalfall then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id and new.datum is not distinct from old.datum
     and new.baustelle_id is not distinct from old.baustelle_id and new.normalfall is not distinct from old.normalfall then
    return new;
  end if;
  -- Gleichzeitige Meldungen für dasselbe Team, denselben Tag und dieselbe Baustelle nacheinander prüfen
  perform pg_advisory_xact_lock(hashtextextended('tagesmeldung|' || new.team_id::text || '|' || new.datum::text || '|' || coalesce(new.baustelle_id::text, '-'), 0));
  select t.id into andere
  from tagesmeldung t
  where t.team_id = new.team_id
    and t.datum = new.datum
    and t.baustelle_id is not distinct from new.baustelle_id
    and t.normalfall
    and t.id <> new.id
    and t.client_uuid is distinct from new.client_uuid
  limit 1;
  if andere is not null then
    raise exception 'Für diese Baustelle hat das Team an diesem Tag schon gemeldet.'
      using errcode = 'RPD01',
            detail = 'tagesmeldung ' || andere::text,
            hint = 'Frühere ersetzen oder den Bauführer bitten, die Meldung in der Wochenübersicht zu ändern.';
  end if;
  return new;
end;
$$;

drop trigger if exists tagesmeldung_eine_je_baustelle on tagesmeldung;
create trigger tagesmeldung_eine_je_baustelle before insert or update on tagesmeldung
  for each row execute function tagesmeldung_eine_je_baustelle();
