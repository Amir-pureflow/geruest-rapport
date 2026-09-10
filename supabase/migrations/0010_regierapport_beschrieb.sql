-- 0010: Leistungsbeschrieb am Regierapport — der Text, den der Bauführer in SORBA einträgt.
-- Vorschlag aus Sprachnotiz, Positionen und Fotos (Edge Function `beschrieb-vorschlagen`, Mistral),
-- vom Bauführer geprüft und gespeichert. Steht danach in der Kundenmail und auf dem Kundenlink.
-- Eingespielt am 10.09.2026 per Supabase-MCP.
alter table regierapport add column if not exists beschrieb text;
alter table regierapport add column if not exists beschrieb_quelle text check (beschrieb_quelle in ('ki','hand'));
