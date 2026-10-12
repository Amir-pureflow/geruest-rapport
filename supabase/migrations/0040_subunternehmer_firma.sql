-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0040 · Firma der Subunternehmer (13.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Wer den Lieferwagen der Firma braucht (0036), bezahlt ihn — das Back-Office muss wissen, welcher Subunternehmer-Firma
-- es die Fr. 100 abzieht. Bei Externen (Anstellung «extern») wird darum die Firma erfasst, wie das Temporärbüro bei
-- Temporären. Eigene Spalte statt `temporaerbuero`: der Export macht aus jedem Temporärbüro ein eigenes Lohn-Blatt,
-- Subunternehmer gehören nicht dorthin. Rechte: wie die ganze Tabelle (Tabellenrechte + Regel `mitarbeiter_firma`).
-- Wiederholbar.

alter table mitarbeiter add column if not exists subunternehmer_firma text;
comment on column mitarbeiter.subunternehmer_firma is 'Firma eines Subunternehmers (nur bei typ = extern), z. B. für den Lieferwagen-Abzug';
