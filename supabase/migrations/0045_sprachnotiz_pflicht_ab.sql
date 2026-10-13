-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0045 · Sprachnotiz bei Überstunden erst ab einer Grenze Pflicht (14.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir 14.10.: «Ab wie viel Überstunden muss man reden?» — bis hier ab der ersten Minute (0.1 h reichte). Jetzt hat
-- jede Firma ihre Grenze: ab so vielen Minuten Überstunden einer Person ist die Sprachnotiz beim Melden Pflicht,
-- darunter freiwillig. Zur Wahl 0 (immer), 15, 30, 60 Minuten; Standard 30 für alle Firmen (Amir: «ja» zu 30 Min.).
-- Gezählt und angezeigt werden Überstunden weiter ab dem normalen Arbeitstag; Regie braucht immer eine Notiz.
-- Rechte: wie die übrigen Firmen-Einstellungen (nur das Büro ändert `firma`, 0041). Wiederholbar.

alter table firma add column if not exists notiz_pflicht_ab_min int not null default 30;
comment on column firma.notiz_pflicht_ab_min is 'Sprachnotiz bei Überstunden Pflicht ab so vielen Minuten Überstunden einer Person (0 = immer)';

alter table firma drop constraint if exists firma_notiz_pflicht_chk;
alter table firma add constraint firma_notiz_pflicht_chk check (notiz_pflicht_ab_min in (0, 15, 30, 60));

notify pgrst, 'reload schema';
