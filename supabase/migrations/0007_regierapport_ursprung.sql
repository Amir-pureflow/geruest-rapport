-- 0007: Regierapport kennt seinen Ursprung — die Tagesmeldung, aus der er entstanden ist.
-- Damit kommt der Bauführer vom Rapport zurück zu «was hat das Team an dem Tag gemeldet»
-- (Sprachnotiz, Stunden pro Person, Wer wollte das) und in die passende Woche.

alter table regierapport
  add column if not exists tagesmeldung_id uuid references tagesmeldung(id);

-- Bestehende Rapporte nachziehen: Abweichungs-Meldung auf derselben Baustelle am geplanten Tag des Auftrags.
update regierapport r
set tagesmeldung_id = (
  select t.id
  from tagesmeldung t
  join zusatzauftrag z on z.id = r.zusatzauftrag_id
  where t.baustelle_id = r.baustelle_id
    and t.normalfall = false
    and t.datum = z.geplant_fuer
  order by t.erfasst_am
  limit 1
)
where r.tagesmeldung_id is null and r.zusatzauftrag_id is not null;
