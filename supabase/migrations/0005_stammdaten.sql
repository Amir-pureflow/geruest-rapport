-- Stammdaten-Erweiterung für Verwaltung, Erfassung und Demo-Betrieb.
--
-- kunde:       Bauleitung als Ansprechperson + Mail — ohne Mail kein Versand.
-- mitarbeiter: übliche Anreise (öV / km) → Vorbelegung in der Team-Erfassung,
--              damit der Normalfall wirklich ein Knopf bleibt.
-- team:        aktiv-Flag (Teams ruhen in der Nebensaison).
-- tagesmeldung: Anzahl Sekunden der Sprachnotiz (Anzeige «▶ 18 Sek.»).

alter table kunde
  add column if not exists ansprechperson text,
  add column if not exists email          text,
  add column if not exists telefon        text;

alter table mitarbeiter
  add column if not exists oev_standard boolean not null default false,
  add column if not exists km_standard  int     not null default 0 check (km_standard >= 0),
  add column if not exists eintritt     date;

alter table team
  add column if not exists aktiv boolean not null default true;

alter table tagesmeldung
  add column if not exists audio_sekunden int check (audio_sekunden >= 0);

-- Sprachnotizen liegen im bestehenden Bucket «anhaenge» unter audio/<client_uuid>.webm
