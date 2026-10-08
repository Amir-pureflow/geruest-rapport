-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0028 · Zugang für Monteur und Chefmonteur: Einladung per Link, Gerät bleibt gekoppelt
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Bis jetzt meldet sich nur die **Firma** an (0019) und danach wählt man eine Ansicht. Wer am
-- Gerät sitzt, weiss die Datenbank nicht — im `freigabe_log` steht die Firma, nicht die Person.
--
-- Warum eine Einladung und kein Passwort je Monteur (Erin, 09.10.2026):
--   · Regel #4 — offline zuerst. Eine Anmeldung, die am Abend auf dem Gerüst eine Serverantwort
--     braucht, fällt durch. Darum meldet man sich **einmal** an und das Gerät bleibt gekoppelt.
--   · Regel #2 — keine Freitext-Eingabe. Der Monteur tippt weder Mailadresse noch Passwort,
--     er tippt **einen Link an**, den der Bauführer ihm per WhatsApp schickt.
--   · 45 Feste + ~30 Temporäre müssten sonst ins Büro. Die sind nie dort (Erin, 09.10.2026).
--
-- Ablauf:
--   1. Bauführer öffnet Verwaltung → Mitarbeitende → Person → «Zugang einladen».
--      Das legt eine Zeile in `einladung` an (Token = UUID, 24 h gültig, einmal verwendbar).
--   2. Er schickt den Link per WhatsApp (`wa.me`, Nummer aus `mitarbeiter.telefon`).
--   3. Der Monteur tippt den Link an → `/e/:token` → die Edge Function `einladung` löst ihn ein:
--      eigener Auth-Zugang für **dieses Gerät**, Zeile in `benutzer` (Firma!), Zeile in `geraet`.
--   4. Danach nie wieder anmelden. Die Sitzung liegt im Gerät, Erfassung läuft offline weiter.
--
-- Sperren: `geraet.gesperrt = true` **und** die Zeile in `benutzer` löschen. Ohne `benutzer`
-- gibt `aktuelle_firma()` null zurück und das Gerät sieht ab sofort keine einzige Zeile mehr.
--
-- ⚠ Was das **nicht** löst: Die Datenbank trennt weiterhin nur zwischen Firmen, nicht zwischen
--    Rollen innerhalb einer Firma (CLAUDE.md). Ein gekoppeltes Monteur-Gerät hat an der
--    Datenbank dieselben Rechte wie der Bauführer — eingeschränkt wird es nur in der
--    Oberfläche (`seitenFuer`). Rechte je Rolle sind der nächste Schritt; `geraet.ansicht`
--    hält die Rolle schon fest, damit die Regeln später daran andocken können.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Einladung — der Link, den der Bauführer verschickt
-- ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists einladung (
  id             uuid primary key default gen_random_uuid(),
  firma_id       uuid not null references firma (id) on delete cascade default aktuelle_firma(),
  mitarbeiter_id uuid not null references mitarbeiter (id) on delete cascade,
  -- Als wen wird gekoppelt? Mehr gibt es hier nicht: Büro-Ansichten melden sich mit Mail an.
  ansicht        text not null default 'monteur' check (ansicht in ('monteur', 'chef')),
  token          text not null unique,
  gueltig_bis    timestamptz not null default now() + interval '24 hours',
  eingeloest_am  timestamptz,
  erstellt_am    timestamptz not null default now()
);

create index if not exists einladung_firma_idx       on einladung (firma_id);
create index if not exists einladung_mitarbeiter_idx on einladung (mitarbeiter_id);

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Gerät — was gekoppelt ist, und wie man es wieder loswird
-- ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists geraet (
  id             uuid primary key default gen_random_uuid(),
  firma_id       uuid not null references firma (id) on delete cascade default aktuelle_firma(),
  mitarbeiter_id uuid not null references mitarbeiter (id) on delete cascade,
  ansicht        text not null check (ansicht in ('monteur', 'chef')),
  -- Der Auth-Zugang dieses einen Geräts. Beim Sperren bleibt die Zeile stehen (Nachweis),
  -- der Zugang selbst verliert aber seine Firma.
  auth_user_id   uuid references auth.users (id) on delete set null,
  -- Was der Monteur in der Hand hält, soweit der Browser es verrät («iPhone», «Android»).
  bezeichnung    text,
  gekoppelt_am   timestamptz not null default now(),
  letzte_nutzung timestamptz,
  gesperrt       boolean not null default false
);

create index if not exists geraet_firma_idx       on geraet (firma_id);
create index if not exists geraet_mitarbeiter_idx on geraet (mitarbeiter_id);

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Rechte — wie überall: nur die eigene Firma
-- ────────────────────────────────────────────────────────────────────────────────────────────
alter table einladung enable row level security;
alter table geraet    enable row level security;

drop policy if exists einladung_firma on einladung;
create policy einladung_firma on einladung
  for all to authenticated
  using (firma_id = aktuelle_firma())
  with check (firma_id = aktuelle_firma());

drop policy if exists geraet_firma on geraet;
create policy geraet_firma on geraet
  for all to authenticated
  using (firma_id = aktuelle_firma())
  with check (firma_id = aktuelle_firma());

-- Die Edge Function `einladung` läuft mit der Service-Role und umgeht RLS — sie muss die
-- `firma_id` von Hand setzen (CLAUDE.md). Sie tut das aus der Einladung selbst.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Gerät sperren — Handy verloren, Temporärer weg
-- ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Sperren heisst: die Zeile in `benutzer` löschen. Danach gibt `aktuelle_firma()` für diesen
 * Zugang null zurück und das Gerät sieht ab der nächsten Abfrage keine einzige Zeile mehr —
 * auch dann, wenn jemand den Token aus dem Gerät ausliest.
 *
 * Warum eine Funktion und kein `delete` aus der App: Auf `benutzer` darf die App nur die
 * eigene Zeile lesen (0019). Darum `security definer` — mit einer Prüfung, dass das Gerät
 * wirklich zur eigenen Firma gehört.
 *
 * Die Zeile in `geraet` bleibt stehen. Sie ist der Nachweis, dass dieses Gerät einmal
 * gekoppelt war — und wer es war.
 */
create or replace function geraet_sperren(p_geraet uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth uuid;
begin
  select auth_user_id into strict v_auth
    from geraet
   where id = p_geraet and firma_id = aktuelle_firma();

  update geraet set gesperrt = true where id = p_geraet;
  if v_auth is not null then
    delete from benutzer where auth_user_id = v_auth;
  end if;
exception
  when no_data_found then
    raise exception 'Dieses Gerät gehört nicht zu dieser Firma.';
end;
$$;

revoke all on function geraet_sperren(uuid) from public;
grant execute on function geraet_sperren(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Aufräumen: abgelaufene, nie eingelöste Einladungen verfallen lassen
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Kein Cron — die Liste ist winzig. Die Oberfläche zeigt abgelaufene Einladungen als «verfallen»,
-- und ein neuer Klick auf «Zugang einladen» ersetzt sie. Diese Funktion ist für den Fall, dass
-- jemand im SQL-Editor aufräumen will.
create or replace function einladungen_aufraeumen()
returns integer
language sql
security invoker
set search_path = public
as $$
  with weg as (
    delete from einladung
    where eingeloest_am is null and gueltig_bis < now() - interval '7 days'
    returning 1
  )
  select count(*)::integer from weg;
$$;
