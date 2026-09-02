-- Gerüst Rapport — Grundschema (Bauplan §8)
-- Konventionen: Geld in Rappen (int), Zeit in Minuten (int), Mengen in Hundertsteln (int).
-- RLS ist überall aktiviert; feingranulare Policies folgen als eigene Migration,
-- sobald das Rollenmodell (Bauführer/Teamgerät/Sekretariat) angelegt ist.

-- ── Stammdaten ────────────────────────────────────────────────────────────────

create table kunde (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Ausgabeform der Regierapporte ist kundenabhängig (Konzept 5.5)
  praeferenz  text not null default 'einzel' check (praeferenz in ('einzel','sammel')),
  erstellt_am timestamptz not null default now()
);

create table baustelle (
  id                 uuid primary key default gen_random_uuid(),
  konto_nr           text not null unique,           -- z. B. '903673'
  strasse            text,
  plz                text,
  ort                text,
  status             text not null default 'aktiv' check (status in ('aktiv','fertig_gemeldet','abgeschlossen')),
  fertigstellung_am  date,                           -- aktiviert Regiesignal R2 (AGB 4.1)
  kunde_id           uuid references kunde(id),
  erstellt_am        timestamptz not null default now()
);

create table mitarbeiter (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  typ            text not null check (typ in ('intern','extern','temporaer')),
  funktion       text not null default 'monteur',    -- Tarifcode, siehe fixtures/tarife
  sprache        text not null default 'de' check (sprache in ('de','ar','pl','en')),
  temporaerbuero text,
  aktiv          boolean not null default true
);

-- 20 Teams à 2–3 Monteure, je ein Chefmonteur; mehrere Teams pro Baustelle möglich (Arbnor, 27.08.2026)
create table team (
  id             uuid primary key default gen_random_uuid(),
  bezeichnung    text not null,
  fahrzeug       text,
  chefmonteur_id uuid references mitarbeiter(id)
);

create table team_mitglied (
  team_id     uuid not null references team(id),
  mitarbeiter_id uuid not null references mitarbeiter(id),
  von            date not null default current_date,
  bis            date,
  primary key (team_id, mitarbeiter_id, von)
);

create table tarif (
  jahr          int  not null,
  code          text not null,
  bezeichnung   text not null,
  ansatz_rappen int  not null check (ansatz_rappen >= 0),
  einheit       text not null check (einheit in ('h','km','pauschal')),
  primary key (jahr, code)
);

-- ── Planung (digitales Board — Ebene 1: Jahres-/Terminplan) ──────────────────

create table jahresplan (
  id           uuid primary key default gen_random_uuid(),
  baustelle_id uuid not null references baustelle(id),
  team_id   uuid references team(id),
  von          date not null,
  bis          date not null,
  check (bis >= von)
);

-- Änderungen werden fortgeschrieben, nie überschrieben (Terminhistorie, R4b)
create table planaenderung (
  id            uuid primary key default gen_random_uuid(),
  jahresplan_id uuid not null references jahresplan(id),
  feld          text not null,
  alt           text,
  neu           text,
  geaendert_am  timestamptz not null default now(),
  geaendert_von uuid,
  grund         text
);

-- ── Erfassung ────────────────────────────────────────────────────────────────

create table tagesmeldung (
  id               uuid primary key default gen_random_uuid(),
  client_uuid      uuid not null unique,             -- Idempotenz der Offline-Queue!
  team_id       uuid references team(id),
  datum            date not null,
  baustelle_id     uuid references baustelle(id),
  normalfall       boolean not null default true,
  abweichung_typ   text check (abweichung_typ in ('zusaetzlich','warten','kaputt')),
  -- «Wer wollte das?» — Beobachtung, keine Beurteilung (Konzept 5.1)
  wer_hats_gewollt text check (wer_hats_gewollt in ('kunde','chef','niemand')),
  audio_pfad       text,                             -- Storage; Audio ist der Beleg
  foto_pfad        text,
  transkript       text,                             -- immer Deutsch
  transkript_quelle text,                            -- Originalsprache, falls übersetzt
  erfasst_von      uuid,
  erfasst_am       timestamptz not null default now(),
  status           text not null default 'offen' check (status in ('offen','freigegeben'))
);
create index tagesmeldung_datum_idx on tagesmeldung (datum);
create index tagesmeldung_baustelle_idx on tagesmeldung (baustelle_id, datum);

create table zeiteintrag (
  id              uuid primary key default gen_random_uuid(),
  tagesmeldung_id uuid not null references tagesmeldung(id),
  mitarbeiter_id  uuid not null references mitarbeiter(id),
  normal_min      int not null default 0 check (normal_min >= 0),
  ueber_min       int not null default 0 check (ueber_min >= 0),
  oev             boolean not null default false,
  km              int not null default 0 check (km >= 0),
  baustelle_id    uuid references baustelle(id),
  -- denormalisiert: Wert zum Zeitpunkt der Freigabe bleibt erhalten (Bauplan §8)
  konto_nr        text,
  status          text not null default 'offen' check (status in ('offen','freigegeben'))
);
create index zeiteintrag_meldung_idx on zeiteintrag (tagesmeldung_id);
create index zeiteintrag_mitarbeiter_idx on zeiteintrag (mitarbeiter_id);

-- ── Regie ────────────────────────────────────────────────────────────────────

-- Die Kundenbestellung, erfasst BEVOR gearbeitet wird (Stufe 1 — der Geldwert)
create table zusatzauftrag (
  id             uuid primary key default gen_random_uuid(),
  baustelle_id   uuid not null references baustelle(id),
  besteller_name text not null,
  besteller_rolle text,
  bestellt_am    timestamptz not null default now(),
  kanal          text not null check (kanal in ('telefon','mail','vor_ort')),
  taetigkeit     text not null check (taetigkeit in ('versetzen','ergaenzen','reparieren','teilabbau','reinigen','anderes')),
  geplant_fuer   date,
  notiz          text,
  status         text not null default 'offen' check (status in ('offen','ausgefuehrt','abgerechnet'))
);

-- Vorgerechneter Fall + Nachverfolgung. Der verbindliche Beleg entsteht in SORBA.
create table regierapport (
  id              uuid primary key default gen_random_uuid(),
  zusatzauftrag_id uuid references zusatzauftrag(id),
  baustelle_id    uuid not null references baustelle(id),
  nummer          text unique,
  status          text not null default 'entwurf'
                  check (status in ('entwurf','versendet','bestaetigt','rueckfrage','frist_abgelaufen')),
  betrag_rappen   int check (betrag_rappen >= 0),
  frist_bis       date,
  erstellt_am     timestamptz not null default now(),
  versendet_am    timestamptz,
  bestaetigt_am   timestamptz
);

create table regie_position (
  id                uuid primary key default gen_random_uuid(),
  regierapport_id   uuid not null references regierapport(id),
  tarif_code        text not null,
  bezeichnung       text not null,
  menge_hundertstel int not null check (menge_hundertstel >= 0),
  ansatz_rappen     int not null check (ansatz_rappen >= 0),
  betrag_rappen     int not null check (betrag_rappen >= 0)
);

-- Zustellnachweis — das Argument gegen «ein bisschen Kämpfen oder Verhandeln»
create table zustellung_log (
  id              uuid primary key default gen_random_uuid(),
  regierapport_id uuid not null references regierapport(id),
  an              text not null,
  ereignis        text not null check (ereignis in ('gesendet','zugestellt','geoeffnet','link_geklickt','bestaetigt','rueckfrage','erinnert')),
  zeitpunkt       timestamptz not null default now(),
  detail          jsonb
);

-- ── Kontrolle ────────────────────────────────────────────────────────────────

-- Jede Korrektur: wer, wann, von, auf, warum (CLAUDE.md #7)
create table freigabe_log (
  id             uuid primary key default gen_random_uuid(),
  zeiteintrag_id uuid not null references zeiteintrag(id),
  wer            uuid not null,
  wann           timestamptz not null default now(),
  feld           text not null,
  alt            text,
  neu            text,
  begruendung    text
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table kunde            enable row level security;
alter table baustelle        enable row level security;
alter table mitarbeiter      enable row level security;
alter table team             enable row level security;
alter table team_mitglied    enable row level security;
alter table tarif            enable row level security;
alter table jahresplan       enable row level security;
alter table planaenderung    enable row level security;
alter table tagesmeldung     enable row level security;
alter table zeiteintrag      enable row level security;
alter table zusatzauftrag    enable row level security;
alter table regierapport     enable row level security;
alter table regie_position   enable row level security;
alter table zustellung_log   enable row level security;
alter table freigabe_log     enable row level security;

-- Übergangs-Policies für den Pilotaufbau: eingeloggte Nutzer dürfen alles.
-- TODO (eigene Migration, vor dem ersten echten Nutzer):
--   Bauführer sieht seine Teams; Teamgerät nur das eigene Team
--   (insert auf tagesmeldung/zeiteintrag, kein select auf fremde Daten);
--   Sekretariat nur Freigegebenes; Kundenlink läuft NICHT über RLS,
--   sondern über eine Edge Function mit signiertem Token.
do $$
declare t text;
begin
  foreach t in array array[
    'kunde','baustelle','mitarbeiter','team','team_mitglied','tarif',
    'jahresplan','planaenderung','tagesmeldung','zeiteintrag',
    'zusatzauftrag','regierapport','regie_position','zustellung_log','freigabe_log'
  ] loop
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
