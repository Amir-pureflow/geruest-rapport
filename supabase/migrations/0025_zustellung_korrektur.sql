-- 0025 (08.10.2026): «Zurück auf Entwurf» nach einer Rückfrage schreibt den Verlaufseintrag «korrektur»
-- (RegieDetail.tsx, korrigieren()). Der Check aus 0009 kannte den Wert nicht → Fehler beim Korrigieren:
-- «new row for relation "zustellung_log" violates check constraint "zustellung_log_ereignis_check"».
alter table zustellung_log drop constraint if exists zustellung_log_ereignis_check;
alter table zustellung_log
  add constraint zustellung_log_ereignis_check
  check (ereignis in ('gesendet','zugestellt','geoeffnet','link_geklickt','bestaetigt','rueckfrage','erinnert','frist_abgelaufen','korrektur'));
