-- 0028 (09.10.2026): «Gelb markieren ab» je Firma. Die Gerüst GmbH (Arbnor) will einen Tag erst gelb sehen,
-- wenn eine Person auf 9.0 h kommt — darunter sieht er aus wie jeder andere gemeldete Tag (Übersicht,
-- Wochenübersicht, Tagesübersicht). Überstunden zählen weiter ab dem normalen Arbeitstag (normaltag_min, 0026):
-- das hier ist nur die Markierung, nicht der Lohn.
-- null = wie der normale Arbeitstag, jede Überstunde wird gelb (bisheriges Verhalten, alle bestehenden Firmen).
-- Bereich 6.0–10.0 h: über 10 h bleibt ein Tag damit immer markiert. Einstellbar in Verwaltung → Einstellungen.
alter table firma add column if not exists markieren_ab_min integer;
alter table firma drop constraint if exists firma_markieren_ab_min_check;
alter table firma add constraint firma_markieren_ab_min_check check (markieren_ab_min is null or markieren_ab_min between 360 and 600);
