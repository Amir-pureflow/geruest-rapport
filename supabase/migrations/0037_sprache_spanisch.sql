-- 0037: Spanisch als Sprache der Mitarbeitenden (11.10.2026, Amir: «Spanisch hinzufügen, es muss perfekt
-- verstanden werden»). Azure hört es-ES, Mistral übersetzt ins Schweizer Hochdeutsch. Wiederholbar.

alter table mitarbeiter
  drop constraint if exists mitarbeiter_sprache_check;
alter table mitarbeiter
  add constraint mitarbeiter_sprache_check
  check (sprache in ('de', 'sq', 'pt', 'it', 'fr', 'es', 'ar', 'pl', 'en'));

alter table tagesmeldung
  drop constraint if exists tagesmeldung_transkript_sprache_check;
alter table tagesmeldung
  add constraint tagesmeldung_transkript_sprache_check
  check (transkript_sprache in ('de', 'sq', 'pt', 'it', 'fr', 'es', 'ar', 'pl', 'en'));
