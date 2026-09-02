-- Zusatzaufträge laufen wie Tagesmeldungen durch die Offline-Queue (CLAUDE.md #4/#5):
-- clientseitige UUID + unique = mehrfaches Senden ist folgenlos.
alter table zusatzauftrag add column if not exists client_uuid uuid unique;
