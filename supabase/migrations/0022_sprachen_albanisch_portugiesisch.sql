-- 0022: Albanisch und Portugiesisch als Sprache der Mitarbeitenden (04.10.2026, Amir).
--
-- Bisher liess die Datenbank nur de/ar/pl/en zu. Im Betrieb sprechen viele Monteure Albanisch,
-- und Portugiesisch kommt dazu. Die Sprache steht im Mitarbeiterprofil und sagt der
-- Transkription, in welcher Sprache die Sprachnotiz gesprochen ist (CLAUDE.md Regel #9:
-- nie pro Aufnahme raten).
--
-- Nach dieser Migration die Edge Function `transkribieren` neu ausliefern, sie kennt die beiden
-- Sprachen sonst nicht und fällt auf Deutsch zurück.

alter table mitarbeiter drop constraint if exists mitarbeiter_sprache_check;
alter table mitarbeiter add constraint mitarbeiter_sprache_check
  check (sprache in ('de', 'sq', 'pt', 'ar', 'pl', 'en'));

alter table tagesmeldung drop constraint if exists tagesmeldung_transkript_sprache_check;
alter table tagesmeldung add constraint tagesmeldung_transkript_sprache_check
  check (transkript_sprache in ('de', 'sq', 'pt', 'ar', 'pl', 'en'));

-- ── Probe ────────────────────────────────────────────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) as regel
  from pg_constraint
 where conname in ('mitarbeiter_sprache_check', 'tagesmeldung_transkript_sprache_check');
