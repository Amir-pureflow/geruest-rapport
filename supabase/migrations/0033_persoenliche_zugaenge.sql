-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0033 · Persönliche Zugänge für Chefmonteur und Monteur — statt Einladungslink (09.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die Einladung per WhatsApp-Link (0032) ist verworfen (Erin, 09.10.2026: «das wollen wir nicht
-- mehr machen»). Stattdessen bekommt jede Person einen eigenen Zugang mit E-Mail und Passwort,
-- angelegt von Hand im Supabase-Dashboard. Das Gerät bleibt danach angemeldet (wie bisher).
--
-- Neu in `benutzer`: zu welcher **Person** und welcher **Ansicht** ein Zugang gehört. Steht dort
-- eine Ansicht, wählt die App sie nach der Anmeldung selbst (`personLaden()` in konto.ts) und
-- bietet keine andere an. Firmen-Zugänge (Büro) lassen beide Felder leer und wählen frei.
--
-- ⚠ Weiterhin nur Oberfläche: Die Datenbank trennt zwischen Firmen, nicht zwischen Rollen. Ein
--    Monteur-Zugang hat an der Datenbank dieselben Rechte wie der Firmen-Zugang (CLAUDE.md).
--
-- Reihenfolge:
--   1. Dashboard › Authentication › Users › «Add user» › «Create new user», je Person,
--      «Auto Confirm User» an. Passwörter nie in eine Datei.
--        nuhi.vaiti@rapporto.pureflow-ai.com    (Chefmonteur)
--        ismail.vaiti@rapporto.pureflow-ai.com  (Monteur)
--   2. Diese Datei im SQL-Editor ausführen. Gibt es einen Zugang noch nicht, wird er übersprungen —
--      anlegen und Abschnitt 3 nochmals ausführen. Die Datei darf beliebig oft laufen.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Einladung und Gerät aus 0032 wieder entfernen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Es wurde nie eine Einladung eingelöst (die Edge Function war nie ausgeliefert).
drop function if exists geraet_sperren(uuid);
drop function if exists einladungen_aufraeumen();
drop table if exists geraet;
drop table if exists einladung;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Person und Ansicht am Zugang
-- ────────────────────────────────────────────────────────────────────────────────────────────
alter table benutzer add column if not exists mitarbeiter_id uuid references mitarbeiter (id) on delete set null;
alter table benutzer add column if not exists ansicht text;

alter table benutzer drop constraint if exists benutzer_ansicht_check;
alter table benutzer add constraint benutzer_ansicht_check
  check (ansicht is null or ansicht in ('bauf', 'sekretariat', 'chef', 'monteur'));

-- Lesen darf die App nur die eigene Zeile (Policy `benutzer_eigener` aus 0019) — das reicht.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Die beiden Leute der Gerüst GmbH verknüpfen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Person über den Namen innerhalb der Firma — so stehen sie seit 0019 in `mitarbeiter`.
insert into benutzer (auth_user_id, firma_id, bezeichnung, mitarbeiter_id, ansicht)
select u.id, f.id, m.name, m.id, z.ansicht
  from (values
          ('nuhi.vaiti@rapporto.pureflow-ai.com',   'Nuhi Vaiti',   'chef'),
          ('ismail.vaiti@rapporto.pureflow-ai.com', 'Ismail Vaiti', 'monteur')
       ) as z (email, name, ansicht)
  join auth.users  u on lower(u.email) = z.email
  join firma       f on f.name = 'Gerüst GmbH'
  join mitarbeiter m on m.name = z.name and m.firma_id = f.id
on conflict (auth_user_id) do update
  set firma_id       = excluded.firma_id,
      bezeichnung    = excluded.bezeichnung,
      mitarbeiter_id = excluded.mitarbeiter_id,
      ansicht        = excluded.ansicht;

-- Kontrolle: zwei Zeilen erwartet. Fehlt eine, ist der Zugang noch nicht angelegt.
select u.email, b.ansicht, m.name as person, f.name as firma
  from benutzer b
  join auth.users u on u.id = b.auth_user_id
  join firma f      on f.id = b.firma_id
  left join mitarbeiter m on m.id = b.mitarbeiter_id
 where b.ansicht is not null;
