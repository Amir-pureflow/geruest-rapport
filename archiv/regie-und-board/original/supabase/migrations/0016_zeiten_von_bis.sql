-- 0016: Zeiten von–bis am Zeiteintrag (Feedback Bauführer 20.09.2026).
-- «Hie so ahpasse das si zite seuber chöi ihgeh ala 7-00 bis 12:00» — statt nur der Stundenzahl.
-- Bis zu zwei Spannen je Person und Tag (Vormittag, Nachmittag); Minuten seit Mitternacht, Integer.
-- normal_min/ueber_min bleiben die massgebenden Werte für Lohn und Regie; die Zeiten sind der Beleg,
-- woraus sie entstanden sind. Die App rechnet daraus OHNE Pausenabzug (bezahlte Pause 9:00–9:30 ist
-- freiwillig, Mittag ungeklärt) — der Mittag ist die Lücke zwischen Spanne 1 und 2.
-- Stundenzahl-Eingabe bleibt möglich: dann sind alle vier Spalten null.

alter table zeiteintrag
  add column if not exists von_min  int check (von_min  between 0 and 1440),
  add column if not exists bis_min  int check (bis_min  between 0 and 1440),
  add column if not exists von2_min int check (von2_min between 0 and 1440),
  add column if not exists bis2_min int check (bis2_min between 0 and 1440);

alter table zeiteintrag
  add constraint zeiteintrag_spanne1_chk check (
    (von_min is null and bis_min is null) or (von_min is not null and bis_min is not null and bis_min > von_min)
  ),
  add constraint zeiteintrag_spanne2_chk check (
    (von2_min is null and bis2_min is null)
    or (von2_min is not null and bis2_min is not null and bis2_min > von2_min and von_min is not null and von2_min >= bis_min)
  );

comment on column zeiteintrag.von_min  is 'Arbeitsbeginn in Minuten seit Mitternacht (Spanne 1). Null = nur Stundenzahl erfasst.';
comment on column zeiteintrag.bis_min  is 'Arbeitsende Spanne 1. Kein Pausenabzug — die App zählt, was eingetragen ist.';
comment on column zeiteintrag.von2_min is 'Beginn Spanne 2 (Nachmittag), muss nach bis_min liegen.';
comment on column zeiteintrag.bis2_min is 'Ende Spanne 2.';
