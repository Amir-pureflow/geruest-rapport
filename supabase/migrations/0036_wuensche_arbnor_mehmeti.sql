-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0036 · Wünsche aus dem Meeting mit Arbnor und Mehmeti (10.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Notizen: `Rapporto\Gerüst GMBH\Meeting Arbnor & Mehmeti 2026-10-10.pdf`. Wiederholbar (if not exists /
-- drop … if exists). Die App läuft auch ohne diese Migration weiter wie bisher; die neuen Funktionen
-- werden erst sichtbar, wenn sie eingespielt ist.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Pause am Morgen je Firma (Spalten heissen «znueni_…» wie im Code)
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Standard (wie bisher): 9:00–9:30, bezahlt, abgezogen nur auf Knopfdruck («− Pause»).
-- Gerüst GmbH (Arbnor, 10./11.10.2026): 9:00–9:15, wird IMMER abgezogen — Vormittag 7–12 = 4.75 h bezahlt.
-- Der Beginn ist immer 9:00; gespeichert wird nur das Ende.
alter table firma add column if not exists znueni_bis_min int  not null default 570;
alter table firma add column if not exists znueni_immer   boolean not null default false;
alter table firma drop constraint if exists firma_znueni_bis_chk;
alter table firma add constraint firma_znueni_bis_chk check (znueni_bis_min between 545 and 600);

update firma set znueni_bis_min = 555, znueni_immer = true
 where id = 'd356f4a2-2d1e-4624-92c1-57b08cc67b13';  -- Gerüst GmbH

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Lieferwagen für Subunternehmer
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Arbnor (10.10.2026): Nimmt ein Team mit Subunternehmern (Anstellung «extern») den Lieferwagen der Firma mit,
-- kostet das pro Tag einen festen Betrag (Gerüst GmbH: Fr. 100). Beim Melden ein Haken «Lieferwagen der Firma
-- gebraucht»; das Sekretariat sieht die Tage im Export (Blatt «Lieferwagen», pro Team und Tag einmal).
-- Betrag in Rappen, 0 = aus (kein Haken). Andere Firmen starten mit «aus».
alter table firma add column if not exists lieferwagen_tag_rp int not null default 0;
alter table firma drop constraint if exists firma_lieferwagen_tag_rp_chk;
alter table firma add constraint firma_lieferwagen_tag_rp_chk check (lieferwagen_tag_rp between 0 and 100000);
alter table tagesmeldung add column if not exists lieferwagen boolean not null default false;
create index if not exists tagesmeldung_lieferwagen_idx on tagesmeldung (datum) where lieferwagen;

update firma set lieferwagen_tag_rp = 10000
 where id = 'd356f4a2-2d1e-4624-92c1-57b08cc67b13' and lieferwagen_tag_rp = 0;  -- Gerüst GmbH

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Abwesenheiten
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- Arbnor (10.10.2026): Das Sekretariat trägt Ferien, Krankheit, Unfall, Todesfall usw. je Mitarbeiter ein — mit
-- Wirkung auf Stunden und Lohn. Eine Zeile pro Person und Tag (Zeiträume legt die App als einzelne Werktage an).
-- `minuten` = bezahlte Zeit des Tages, Vorschlag ist der normale Arbeitstag der Firma (normaltag_min, z. B. 8.4 h);
-- halber Tag oder unbezahlt (0) gehen auch. Das Teamgerät hakt Abwesende an dem Tag ab.
create table if not exists abwesenheit (
  id             uuid primary key default gen_random_uuid(),
  firma_id       uuid not null default aktuelle_firma() references firma(id) on delete cascade,
  mitarbeiter_id uuid not null references mitarbeiter(id) on delete cascade,
  datum          date not null,
  art            text not null check (art in ('ferien','krank','unfall','militaer','feiertag','todesfall','freitag','unbezahlt')),
  minuten        int  not null default 0 check (minuten between 0 and 720),
  erfasst_von    uuid default auth.uid(),
  erfasst_am     timestamptz not null default now(),
  unique (mitarbeiter_id, datum)
);
create index if not exists abwesenheit_firma_datum_idx on abwesenheit (firma_id, datum);

alter table abwesenheit enable row level security;
drop policy if exists abwesenheit_firma on abwesenheit;
create policy abwesenheit_firma on abwesenheit for all to authenticated
  using (firma_id = aktuelle_firma())
  with check (
    firma_id = aktuelle_firma()
    and exists (select 1 from mitarbeiter m where m.id = abwesenheit.mitarbeiter_id and m.firma_id = aktuelle_firma())
  );
