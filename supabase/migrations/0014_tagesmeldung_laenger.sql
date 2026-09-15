-- 0014: Vierte Abweichungsart «länger gearbeitet» (laenger).
-- Ein Tag über dem normalen Pensum bekommt beim Erfassen eine benannte Quelle (wer wollte es, Sprachnotiz),
-- statt erst in der Wochenübersicht als «über 10 h» aufzufallen. Stunden werden dabei nie verändert (Regel #1).
-- laenger + Kunde = Regieverdacht; laenger + Chef/niemand = Lohnstunden, keine Regie.
alter table tagesmeldung drop constraint if exists tagesmeldung_abweichung_typ_check;
alter table tagesmeldung add constraint tagesmeldung_abweichung_typ_check
  check (abweichung_typ in ('zusaetzlich', 'warten', 'kaputt', 'laenger'));
comment on column tagesmeldung.abweichung_typ is 'zusaetzlich = Zusatzarbeit, warten = Wartezeit, kaputt = etwas kaputt/repariert, laenger = länger gearbeitet als der normale Tag';
