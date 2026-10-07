-- 0026 (08.10.2026): Normaler Arbeitstag je Firma. Bis hier galt fest 8.4 h (504 min, Gerüst GmbH);
-- eine andere Firma arbeitet vielleicht 8.2 h. Alles über diesem Wert zählt als Überstunden
-- (Erfassung, Korrektur in der Wochenübersicht, Demo). Einstellbar in Verwaltung → Einstellungen.
-- Bereich 6.0–10.0 h; bestehende Firmen behalten 8.4 h.
alter table firma add column if not exists normaltag_min integer not null default 504;
alter table firma drop constraint if exists firma_normaltag_min_check;
alter table firma add constraint firma_normaltag_min_check check (normaltag_min between 360 and 600);
