-- 0012: Regierapport als PDF (Aufbau wie der SORBA-Ausdruck) + Briefkopf-Daten.
-- Angewendet auf dem Projekt am 14.09.2026 via MCP (Name «regierapport_pdf»).

-- Pfad des erzeugten PDFs im Bucket «anhaenge» (rapporte/<id>.pdf); wird von den Edge Functions gesetzt.
alter table regierapport add column if not exists pdf_pfad text;

-- Rechnungsadresse des Kunden (mehrzeilig), steht im PDF unter «Rechnungsadresse».
alter table kunde add column if not exists adresse text;

-- Firmendaten für den Briefkopf. Werte aus Arbnors PDF-Vorlage; in der Verwaltung bzw. per SQL anpassbar.
insert into konfiguration (schluessel, wert) values
  ('FIRMA_NAME', 'Gerüst GmbH'),
  ('FIRMA_SLOGAN', 'Gerüstbau'),
  ('FIRMA_ADRESSE', 'Weltpoststrasse 19/21 • 3015 Bern'),
  ('FIRMA_TEL', '031 000 00 00'),
  ('FIRMA_FAX', ''),
  ('FIRMA_MAIL', 'info@geruestgmbh.ch'),
  ('FIRMA_WEB', 'www.geruestgmbh.ch'),
  ('FIRMA_BANK', ''),
  ('FIRMA_MWST', '')
on conflict (schluessel) do nothing;
