-- 0015: Erfassung nur noch Normal + Überstunden (Entscheid 17.09.2026, kein Abweichungs-Ablauf mehr).
-- Ein Zusatzauftrag gilt als «gemeldet», sobald auf der Baustelle nach der Bestellung ein Tag mit Überstunden
-- gemeldet ist — oder (alte Daten) eine Abweichung «zusaetzlich»/«kaputt». Spalten der Sicht unverändert.
create or replace view zusatzauftrag_stand
with (security_invoker = true) as
select
  z.id, z.client_uuid, z.baustelle_id, z.besteller_name, z.besteller_rolle, z.bestellt_am,
  z.kanal, z.taetigkeit, z.geplant_fuer, z.notiz, z.status,
  z.erledigt_grund, z.erledigt_am, z.erledigt_von,
  b.konto_nr, b.bezeichnung as baustelle_bezeichnung,
  case
    when z.status = 'erledigt_ohne_regie' then 'erledigt_ohne_regie'
    when r.status = 'bestaetigt' then 'bestaetigt'
    when r.status in ('versendet','rueckfrage','frist_abgelaufen') then 'beim_kunden'
    when r.id is not null then 'im_regierapport'
    when m.id is not null then 'gemeldet'
    else 'bestellt'
  end as stand,
  m.datum as gemeldet_am,
  m.team_bezeichnung as gemeldet_von_team,
  r.id as regierapport_id,
  r.nummer as regierapport_nummer,
  r.status as regierapport_status,
  (z.status = 'offen' and r.id is null and m.id is null and z.geplant_fuer is not null and z.geplant_fuer < current_date) as ohne_meldung,
  b.kunde_id,
  k.name  as kunde_name,
  k.email as kunde_email,
  k.ansprechperson as kunde_ansprechperson,
  coalesce(k.anzeige_noetig, true) as anzeige_noetig,
  z.angezeigt_am,
  z.angezeigt_an
from zusatzauftrag z
join baustelle b on b.id = z.baustelle_id
left join kunde k on k.id = b.kunde_id
left join lateral (
  select r.id, r.nummer, r.status
  from regierapport r
  where r.zusatzauftrag_id = z.id
  order by r.erstellt_am desc
  limit 1
) r on true
left join lateral (
  select t.id, t.datum, tm.bezeichnung as team_bezeichnung
  from tagesmeldung t
  left join team tm on tm.id = t.team_id
  where t.baustelle_id = z.baustelle_id
    and t.datum >= (z.bestellt_am at time zone 'Europe/Zurich')::date
    and (
      (t.normalfall = false and t.abweichung_typ in ('zusaetzlich','kaputt'))
      or exists (select 1 from zeiteintrag ze where ze.tagesmeldung_id = t.id and ze.ueber_min > 0)
    )
  order by t.datum
  limit 1
) m on true;

grant select on zusatzauftrag_stand to authenticated;
