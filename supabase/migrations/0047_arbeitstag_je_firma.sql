-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0047 · Arbeitszeiten je Firma: Arbeitsbeginn und Mittag (15.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Amir 15.10.: «dass die Firma die Arbeitszeiten, Mittag und alles auch noch selbst bestimmen kann … für jede Firma
-- anders konfiguriert». Bis hier fest im Code: Arbeitsbeginn 7:00, Mittag 12:00–13:00 (unbezahlt). Jetzt je Firma:
--   arbeitsbeginn_min  5:00–10:00
--   mittag_von_min     10:00–15:00, frühestens 2 h nach Arbeitsbeginn
--   mittag_bis_min     15 Min. bis 2 h nach mittag_von_min
-- Daraus macht das Teamgerät die Vorgabe (Vormittag Beginn–Mittag, Nachmittag ab Mittagsende, das Ende trägt das Team
-- ein), den Mittag-Hinweis und die Wechselzeiten bei zwei Baustellen. Der Mittag wird nie abgezogen — er ist eine Lücke.
-- Die Pause am Morgen (0044) muss im Vormittag der Firma liegen statt fest in 7:00–12:00.
-- Standard = Gerüst GmbH wie bisher (7:00, 12–13). Wiederholbar.

alter table firma add column if not exists arbeitsbeginn_min int not null default 420;
alter table firma add column if not exists mittag_von_min int not null default 720;
alter table firma add column if not exists mittag_bis_min int not null default 780;
comment on column firma.arbeitsbeginn_min is 'Arbeitsbeginn in Minuten seit Mitternacht (Standard 420 = 7:00) — Vorgabe im Teamgerät';
comment on column firma.mittag_von_min is 'Beginn des unbezahlten Mittags in Minuten seit Mitternacht (Standard 720 = 12:00) — nie abgezogen, nur als Lücke vorgegeben';
comment on column firma.mittag_bis_min is 'Ende des unbezahlten Mittags in Minuten seit Mitternacht (Standard 780 = 13:00)';

alter table firma drop constraint if exists firma_arbeitstag_chk;
alter table firma add constraint firma_arbeitstag_chk check (
  arbeitsbeginn_min between 300 and 600
  and mittag_von_min between 600 and 900
  and mittag_von_min >= arbeitsbeginn_min + 120
  and mittag_bis_min between mittag_von_min + 15 and mittag_von_min + 120
);

-- Pause am Morgen: statt fest 7:00–12:00 im Vormittag der Firma (5 bis 60 Minuten wie in 0044)
alter table firma drop constraint if exists firma_znueni_chk;
alter table firma add constraint firma_znueni_chk check (
  znueni_von_min >= arbeitsbeginn_min
  and znueni_bis_min >= znueni_von_min + 5
  and znueni_bis_min <= least(znueni_von_min + 60, mittag_von_min)
);

notify pgrst, 'reload schema';
