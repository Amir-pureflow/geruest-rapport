-- 0006: Zusatzauftrag — Stand wird aus den Daten abgeleitet, nicht geklickt.
--
-- Vorher: status offen → ausgeführt → abgerechnet per Knopf (Platzhalter aus Phase 0).
-- Problem: «ausgeführt» weiss die App aus der Team-Meldung, «abgerechnet» passiert in SORBA
-- und kann hier nicht gewusst werden. Handklicks = zweite Wahrheit ohne Protokoll.
--
-- Nachher: gespeichert wird nur noch 'offen' oder 'erledigt_ohne_regie' (mit Pflichtgrund, wer, wann).
-- Alles andere liefert die Sicht zusatzauftrag_stand aus Tagesmeldung und Regierapport:
--   bestellt → gemeldet → im_regierapport → beim_kunden → bestaetigt   |   erledigt_ohne_regie

alter table zusatzauftrag
  add column if not exists erledigt_grund text
    check (erledigt_grund in ('abgesagt','pauschale','kulanz','doppelt')),
  add column if not exists erledigt_am timestamptz,
  add column if not exists erledigt_von uuid;

-- Alt-Stände zurück auf 'offen': der abgeleitete Stand ergibt sich aus Meldung/Regierapport.
update zusatzauftrag set status = 'offen' where status in ('ausgefuehrt','abgerechnet');

alter table zusatzauftrag drop constraint if exists zusatzauftrag_status_check;
alter table zusatzauftrag
  add constraint zusatzauftrag_status_check check (status in ('offen','erledigt_ohne_regie'));

-- Wer «erledigt ohne Regie» sagt, muss den Grund nennen (Protokoll, CLAUDE.md #7 sinngemäss).
alter table zusatzauftrag drop constraint if exists zusatzauftrag_erledigt_grund_pflicht;
alter table zusatzauftrag
  add constraint zusatzauftrag_erledigt_grund_pflicht
  check (status <> 'erledigt_ohne_regie' or (erledigt_grund is not null and erledigt_am is not null));

-- Sicht: Zusatzauftrag + abgeleiteter Stand. security_invoker → RLS der Basistabellen gilt.
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
  -- geplanter Tag vorbei, keine Meldung, kein Rapport: der Moment zum Nachfragen (kein Urteil)
  (z.status = 'offen' and r.id is null and m.id is null and z.geplant_fuer is not null and z.geplant_fuer < current_date) as ohne_meldung
from zusatzauftrag z
join baustelle b on b.id = z.baustelle_id
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
    and t.normalfall = false
    and t.abweichung_typ in ('zusaetzlich','kaputt')
    and t.datum >= (z.bestellt_am at time zone 'Europe/Zurich')::date
  order by t.datum
  limit 1
) m on true;

grant select on zusatzauftrag_stand to authenticated;
