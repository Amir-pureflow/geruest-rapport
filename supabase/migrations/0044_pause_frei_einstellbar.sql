-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0044 · Pause am Morgen frei einstellbar: Beginn und Dauer (13.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir 13.10.: «Option flexibler machen für andere Firmen.» Bis hier begann die Pause immer um 9:00 (fest im Code),
-- wählbar war nur das Ende 9:15 oder 9:30 (0036, Bereich 9:05–10:00). Jetzt hat jede Firma ihren Beginn
-- (`znueni_von_min`, Standard 9:00) und eine Dauer von 5 bis 60 Minuten, ganz im Vormittag (Beginn 7:00–11:30,
-- Ende spätestens 12:00). Gerüst GmbH bleibt 9:00–9:15, immer abgezogen (= 4.75 h vom Vormittag 7–12).
-- Wiederholbar.

alter table firma add column if not exists znueni_von_min int not null default 540;
comment on column firma.znueni_von_min is 'Beginn der Pause am Morgen in Minuten seit Mitternacht (Standard 540 = 9:00)';

alter table firma drop constraint if exists firma_znueni_bis_chk;
alter table firma drop constraint if exists firma_znueni_chk;
alter table firma add constraint firma_znueni_chk check (
  znueni_von_min between 420 and 690
  and znueni_bis_min >= znueni_von_min + 5
  and znueni_bis_min <= least(znueni_von_min + 60, 720)
);

notify pgrst, 'reload schema';
