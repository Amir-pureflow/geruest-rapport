-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0036 · Wünsche aus dem Meeting mit Arbnor und Mehmeti (10.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Notizen: `Rapporto\Gerüst GMBH\Meeting Arbnor & Mehmeti 2026-10-10.pdf`. Wiederholbar (if not exists /
-- drop … if exists). Die App läuft auch ohne diese Migration weiter wie bisher; die neuen Funktionen
-- werden erst sichtbar, wenn sie eingespielt ist.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Znüni je Firma
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
