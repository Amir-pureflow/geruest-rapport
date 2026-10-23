-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0050 · Ort der Baustelle und des Werkhofs (24.10.2026, Amir: Karte, Navigieren)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Strasse, PLZ und Ort einer Baustelle gibt es seit 0001 (bisher nie von der App geschrieben). Neu die Koordinaten:
--   lat, lon          WGS84, aus der Adresssuche des Bundes (geo.admin.ch) — das Büro bestätigt jeden Treffer
--   lage_quelle       'suche' (Treffer gewählt) oder 'von_hand' (Pin auf der Karte gesetzt, Areale ohne Hausnummer)
--   lage_geprueft_am  wann
-- Dazu der Werkhof der Firma (Treffpunkt, Pin auf der Tageskarte): werkhof_adresse, werkhof_lat, werkhof_lon.
--
-- Rechte unverändert (0041): Baustellen und Firmen-Einstellungen schreibt nur das Büro, lesen alle Rollen der Firma —
-- der Chefmonteur braucht die Adresse für «Navigieren». Keine Standortverfolgung von Personen (CLAUDE.md «Nicht bauen»).
-- Wiederholbar.

alter table baustelle add column if not exists lat double precision;
alter table baustelle add column if not exists lon double precision;
alter table baustelle add column if not exists lage_quelle text;
alter table baustelle add column if not exists lage_geprueft_am timestamptz;

alter table baustelle drop constraint if exists baustelle_lage_check;
-- Ausdrücklich «is not null»: eine Prüfregel lässt durch, was NULL ergibt («null in (…)» ist NULL, nicht falsch) —
-- sonst gingen eine Koordinate allein oder Koordinaten ohne Quelle durch (im zurückgerollten Test gesehen).
alter table baustelle add constraint baustelle_lage_check check (
  (lat is null and lon is null and lage_quelle is null)
  or (lat is not null and lon is not null and lage_quelle is not null
      and lat between -90 and 90 and lon between -180 and 180 and lage_quelle in ('suche', 'von_hand'))
);

alter table firma add column if not exists werkhof_adresse text;
alter table firma add column if not exists werkhof_lat double precision;
alter table firma add column if not exists werkhof_lon double precision;

alter table firma drop constraint if exists firma_werkhof_check;
alter table firma add constraint firma_werkhof_check check (
  (werkhof_lat is null and werkhof_lon is null)
  or (werkhof_lat is not null and werkhof_lon is not null and werkhof_lat between -90 and 90 and werkhof_lon between -180 and 180)
);

notify pgrst, 'reload schema';
