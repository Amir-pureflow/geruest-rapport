-- 0058 · «gemeldet um» = wann auf dem Teamgerät «Tag melden» gedrückt wurde (Prüfung 28.11.2026)
--
-- Die Tagesübersicht zeigte erfasst_am, also den Zeitpunkt, an dem die Meldung beim Server ANKAM. Nach einem Funkloch
-- über Nacht stand dort «gemeldet um 06:40» des nächsten Morgens, obwohl das Team um 17:05 gemeldet hatte.
--
-- Neu sendet das Gerät getippt_am mit. erfasst_am bleibt unverändert die Ankunftszeit beim Server (Beleg).
-- Die Uhr des Handys kann falsch gehen, darum begrenzt die Datenbank:
--   nicht später als jetzt, nicht früher als 14 Tage vor der Ankunft. Sonst gilt die Ankunftszeit.
-- Ältere App-Fassungen senden nichts → getippt_am bleibt leer, die App zeigt dann erfasst_am wie bisher.
-- Wiederholbar.

alter table tagesmeldung add column if not exists getippt_am timestamptz;
comment on column tagesmeldung.getippt_am is
  'Wann auf dem Teamgerät «Tag melden» gedrückt wurde (Uhr des Geräts, von der DB begrenzt: ≤ jetzt, ≥ jetzt − 14 Tage). erfasst_am = Ankunft beim Server.';

create or replace function tagesmeldung_getippt_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.getippt_am := old.getippt_am;   -- einmal gesetzt, bleibt es
    return new;
  end if;
  if new.getippt_am is not null and (new.getippt_am > now() + interval '2 minutes' or new.getippt_am < now() - interval '14 days') then
    new.getippt_am := null;            -- Handyuhr unplausibel → die Ankunftszeit gilt
  elsif new.getippt_am > now() then
    new.getippt_am := now();           -- Uhr bis 2 Min. vorgehend: auf jetzt
  end if;
  return new;
end;
$$;

drop trigger if exists tagesmeldung_getippt_pruefen on tagesmeldung;
create trigger tagesmeldung_getippt_pruefen before insert or update on tagesmeldung
  for each row execute function tagesmeldung_getippt_pruefen();

notify pgrst, 'reload schema';
