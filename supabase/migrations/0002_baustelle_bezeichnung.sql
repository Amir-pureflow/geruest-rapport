-- Die echte 217er-Liste (Foto vom 02.09.2026, Quelle laut Fusszeile:
-- N:\EXCEL\DOKUMENT\SEKRETAR\RAPP2.XLS) führt pro Konto nur EINE Textspalte —
-- die Bezeichnung. Sie ist meist Ort+Strasse, aber nicht immer: die Liste
-- enthält auch interne Konten («Vorofferten», «KVA Bern Unterhaltsarbeiten»,
-- «Rückführung Material entwendet»). Die UI zeigt darum `bezeichnung`;
-- strasse/plz/ort bleiben optionale Anreicherung.
alter table baustelle add column if not exists bezeichnung text;

-- Bestehende Zeilen: Bezeichnung aus Strasse+Ort zusammensetzen, falls leer
update baustelle
set bezeichnung = trim(coalesce(strasse,'') || ' ' || coalesce(ort,''))
where bezeichnung is null;
