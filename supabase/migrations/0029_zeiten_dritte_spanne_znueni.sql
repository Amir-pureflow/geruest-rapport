-- 0029 (09.10.2026): Dritte Zeitspanne am Zeiteintrag — für den Znüni-Abzug.
-- Die Pause 9:00–9:30 ist bezahlt und zählt mit: das Team trägt einfach 7:00–12:00 ein. Zahlt der Bauherr sie
-- nicht, zieht das Teamgerät oder der Bauführer (Wochenübersicht) sie auf Knopfdruck ab — der Vormittag wird
-- zu 7:00–9:00 und 9:30–12:00, mit dem Nachmittag sind das drei Spannen. Rückgängig = wieder zusammenfügen.
-- Kein automatischer Abzug (Entscheid Amir, 09.10.2026).
-- Die App schickt von3_min/bis3_min nur mit, wenn es eine dritte Spanne gibt: ohne diese Migration geht jede
-- gewöhnliche Meldung weiter durch — nur eine Meldung mit abgezogener Pause UND Nachmittag wartet auf dem Gerät.
-- Idempotent: mehrfaches Ausführen ist folgenlos.

alter table zeiteintrag
  add column if not exists von3_min int check (von3_min between 0 and 1440),
  add column if not exists bis3_min int check (bis3_min between 0 and 1440);

-- Reihenfolge der Spannen: ersetzt zeiteintrag_spanne2_chk aus 0016 (Spanne 2 unverändert) und prüft dazu
-- Spanne 3 — beide Werte oder keiner, nach Spanne 2, und nur, wenn es Spanne 2 gibt.
-- Bestehende Zeilen haben keine dritte Spanne und erfüllen die Regel darum schon.
alter table zeiteintrag drop constraint if exists zeiteintrag_spanne2_chk;
alter table zeiteintrag drop constraint if exists zeiteintrag_spannen_chk;
alter table zeiteintrag
  add constraint zeiteintrag_spannen_chk check (
    (
      (von2_min is null and bis2_min is null)
      or (von2_min is not null and bis2_min is not null and bis2_min > von2_min and von_min is not null and von2_min >= bis_min)
    )
    and (
      (von3_min is null and bis3_min is null)
      or (von3_min is not null and bis3_min is not null and bis3_min > von3_min and von2_min is not null and bis2_min is not null and von3_min >= bis2_min)
    )
  );

comment on column zeiteintrag.von3_min is 'Beginn Spanne 3 — nur nach einem Znüni-Abzug (Vormittag geteilt), muss nach bis2_min liegen.';
comment on column zeiteintrag.bis3_min is 'Ende Spanne 3.';
comment on column zeiteintrag.von2_min is 'Beginn Spanne 2 (Nachmittag, oder 9:30 nach einem Znüni-Abzug), muss nach bis_min liegen.';
