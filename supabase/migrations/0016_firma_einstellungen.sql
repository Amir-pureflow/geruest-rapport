-- 0016: Ein Code, pro Firma andere Schalter (Entscheid 02.10.2026).
-- Jede Firma hat ihr eigenes Supabase-Projekt; diese drei Zeilen sagen, wie die App dort arbeitet.
--   MODUS_ERFASSUNG          wochenblatt | regie   (Teamgerät: nur Normal+Überstunden, oder mit Abweichungs-Ablauf)
--   MODUS_MEHRKOSTENANZEIGE  aus | an              (Knopf «Bauleitung informieren» am Zusatzauftrag)
--   MODUS_SEKRETARIAT        stunden | voll        (Sekretariat: nur Stunden/Export, oder mit Regie)
-- Standard = der Stand für Gerüst GmbH (Arbnor): Wochenblatt, keine Anzeige, Sekretariat nur Stunden.
insert into konfiguration (schluessel, wert) values
  ('MODUS_ERFASSUNG', 'wochenblatt'),
  ('MODUS_MEHRKOSTENANZEIGE', 'aus'),
  ('MODUS_SEKRETARIAT', 'stunden')
on conflict (schluessel) do nothing;

-- Die App liest diese drei Schlüssel mit der anonymen Sitzung — alles andere in `konfiguration`
-- (Schlüssel für Mail und KI) bleibt wie bisher nur für die Service-Role sichtbar.
drop policy if exists konfiguration_modus_lesen on konfiguration;
create policy konfiguration_modus_lesen on konfiguration
  for select to authenticated
  using (schluessel like 'MODUS\_%');

drop policy if exists konfiguration_modus_schreiben on konfiguration;
create policy konfiguration_modus_schreiben on konfiguration
  for all to authenticated
  using (schluessel like 'MODUS\_%')
  with check (schluessel like 'MODUS\_%');
