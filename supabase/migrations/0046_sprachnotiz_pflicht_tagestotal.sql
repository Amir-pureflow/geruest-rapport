-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0046 · «Sprachnotiz Pflicht ab» als Tagestotal einer Person (14.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir 14.10.: «Bei Arbnor bitte ab 9 h muss man erklären.» 0045 zählte Überstunden-Minuten (0/15/30/60) — 9.0 h sind
-- bei 8.4 h Arbeitstag aber 36 Minuten, und gedacht wird in Tagesstunden wie bei «Gelb markieren ab» (0028, Gerüst
-- 9.0 h). Darum ab hier gleich gebaut: `notiz_pflicht_ab_min` = Tagestotal einer Person in Minuten, ab dem die
-- Sprachnotiz Pflicht ist; null = jede Überstunde. Bereich 6.0–12.0 h.
-- Umrechnung: bisherige Überstunden-Minuten + normaler Arbeitstag (We-Plan 30 Min. → 534 = 8.9 h, unverändert in der
-- Wirkung); Gerüst GmbH auf Wunsch 540 = 9.0 h. Neue Firmen: 9.0 h. Wiederholbar.

alter table firma drop constraint if exists firma_notiz_pflicht_chk;
alter table firma alter column notiz_pflicht_ab_min drop not null;

-- Nur Werte aus 0045 (Überstunden-Minuten, höchstens 60) umrechnen — ein zweiter Lauf findet keine mehr
update firma
   set notiz_pflicht_ab_min = case when notiz_pflicht_ab_min = 0 then null else coalesce(normaltag_min, 504) + notiz_pflicht_ab_min end
 where notiz_pflicht_ab_min is not null and notiz_pflicht_ab_min <= 60;

-- Gerüst GmbH (Arbnor): ab 9.0 h erklären
update firma set notiz_pflicht_ab_min = 540 where id = 'd356f4a2-2d1e-4624-92c1-57b08cc67b13';

alter table firma alter column notiz_pflicht_ab_min set default 540;
alter table firma add constraint firma_notiz_pflicht_chk check (notiz_pflicht_ab_min is null or notiz_pflicht_ab_min between 360 and 720);
comment on column firma.notiz_pflicht_ab_min is 'Sprachnotiz bei Überstunden Pflicht ab diesem Tagestotal einer Person in Minuten (null = jede Überstunde)';

notify pgrst, 'reload schema';
