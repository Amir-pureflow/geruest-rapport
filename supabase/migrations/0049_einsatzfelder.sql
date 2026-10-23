-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0049 · Einsatzfelder: Leute nötig, Beginn, Treffpunkt, Hinweis (24.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ein Einsatz (`jahresplan`) kannte nur Team, Baustelle, von und bis. Neu, alles freiwillig:
--   soll_leute  wie viele Leute der Einsatz braucht — Grundlage der Konfliktliste («Team 3: 2 von 4»)
--   beginn_min  Beginn in Minuten seit Mitternacht (Regel #6), leer = Arbeitsbeginn der Firma (0047)
--   treffpunkt  'baustelle' oder 'werkhof', leer = nicht angegeben
--   hinweis     kurzer Text vom Büro ans Team («Kran kommt um 9»), höchstens 200 Zeichen
--
-- Rechte: unverändert aus 0041 — nur das Büro schreibt Einsätze, alle Rollen der Firma lesen sie (der Chefmonteur soll
-- Beginn, Treffpunkt und Hinweis sehen). Der Verlauf (0038) nimmt die neuen Spalten über to_jsonb von selbst mit.
-- Wiederholbar.

alter table jahresplan add column if not exists soll_leute smallint;
alter table jahresplan add column if not exists beginn_min smallint;
alter table jahresplan add column if not exists treffpunkt text;
alter table jahresplan add column if not exists hinweis text;

alter table jahresplan drop constraint if exists jahresplan_soll_leute_check;
alter table jahresplan add constraint jahresplan_soll_leute_check check (soll_leute is null or soll_leute between 0 and 30);

alter table jahresplan drop constraint if exists jahresplan_beginn_min_check;
alter table jahresplan add constraint jahresplan_beginn_min_check check (beginn_min is null or beginn_min between 0 and 1439);

alter table jahresplan drop constraint if exists jahresplan_treffpunkt_check;
alter table jahresplan add constraint jahresplan_treffpunkt_check check (treffpunkt is null or treffpunkt in ('baustelle', 'werkhof'));

alter table jahresplan drop constraint if exists jahresplan_hinweis_check;
alter table jahresplan add constraint jahresplan_hinweis_check check (hinweis is null or char_length(hinweis) between 1 and 200);

notify pgrst, 'reload schema';
