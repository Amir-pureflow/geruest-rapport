-- 0024: Französisch als Sprache der Mitarbeitenden (05.10.2026, Amir — fürs Launch-Video
-- und die Westschweiz). Azure hört fr-FR, Mistral übersetzt.

alter table mitarbeiter
  drop constraint if exists mitarbeiter_sprache_check;
alter table mitarbeiter
  add constraint mitarbeiter_sprache_check
  check (sprache in ('de', 'sq', 'pt', 'it', 'fr', 'ar', 'pl', 'en'));

alter table tagesmeldung
  drop constraint if exists tagesmeldung_transkript_sprache_check;
alter table tagesmeldung
  add constraint tagesmeldung_transkript_sprache_check
  check (transkript_sprache in ('de', 'sq', 'pt', 'it', 'fr', 'ar', 'pl', 'en'));
