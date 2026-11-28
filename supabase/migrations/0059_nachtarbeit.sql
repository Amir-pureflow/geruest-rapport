-- 0059 · Nachtarbeit: Ende einer Zeit am nächsten Tag (Entscheid Amir 28.11.2026: zählt zum Starttag)
--
-- Bisher liess sich 22:00–02:00 gar nicht erfassen («bis vor von»). Neu speichert die App das Ende als Minuten über
-- 24 h: 22:00–02:00 = von 1320, bis 1560. Die Meldung gehört zum Starttag, die Stunden auch.
-- Die App erlaubt das nur für die letzte Zeit des Tages und höchstens 14 h (src/lib/zeiten.ts bisMitNacht).
-- Hier: die Enden (bis_min, bis2_min, bis3_min) dürfen bis 2880 (48 h) gehen, Beginne bleiben 0–1440.
-- Die bestehende Regel «Ende nach Beginn, Zeiten nacheinander» (zeiteintrag_spannen_chk, 0029) bleibt unverändert.
-- Wiederholbar.

do $$
declare
  c record;
begin
  -- Die alten Grenzen 0–1440 auf den Enden finden (Namen hat Postgres beim Anlegen vergeben) und entfernen
  for c in
    select conname from pg_constraint
    where conrelid = 'zeiteintrag'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mbis[23]?_min\M' and pg_get_constraintdef(oid) ~ '1440'
      and pg_get_constraintdef(oid) !~ '\mvon[23]?_min\M'
  loop
    execute format('alter table zeiteintrag drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table zeiteintrag drop constraint if exists zeiteintrag_bis_nacht_chk;
alter table zeiteintrag add constraint zeiteintrag_bis_nacht_chk check (
  (bis_min  is null or bis_min  between 0 and 2880) and
  (bis2_min is null or bis2_min between 0 and 2880) and
  (bis3_min is null or bis3_min between 0 and 2880)
);

comment on column zeiteintrag.bis_min is 'Arbeitsende Spanne 1 in Minuten ab Mitternacht des Meldetags; über 1440 = am nächsten Tag (Nachtarbeit, 0059).';

notify pgrst, 'reload schema';
