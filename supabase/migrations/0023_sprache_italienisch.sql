-- 0023: Italienisch als Sprache der Mitarbeitenden (04.10.2026, Amir).
--
-- Ergänzt 0022 (Albanisch/Portugiesisch): auch Monteure mit Italienisch sollen die Sprachnotiz
-- in ihrer Sprache sprechen, prüfen und bestätigen können. Azure hört it-IT, Mistral übersetzt.

alter table mitarbeiter
  drop constraint if exists mitarbeiter_sprache_check;
alter table mitarbeiter
  add constraint mitarbeiter_sprache_check
  check (sprache in ('de', 'sq', 'pt', 'it', 'ar', 'pl', 'en'));

alter table tagesmeldung
  drop constraint if exists tagesmeldung_transkript_sprache_check;
alter table tagesmeldung
  add constraint tagesmeldung_transkript_sprache_check
  check (transkript_sprache in ('de', 'sq', 'pt', 'it', 'ar', 'pl', 'en'));
