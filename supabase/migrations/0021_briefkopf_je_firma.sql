-- 0021: Briefkopf je Firma (02.10.2026).
--
-- Der Regierapport als PDF trug bisher einen einzigen Briefkopf für alle: Name, Adresse, Telefon,
-- Bank und Mehrwertsteuernummer kamen aus `konfiguration.FIRMA_*`. Mit mehreren Firmen in einer
-- Datenbank ist das falsch — das PDF ist genau das Dokument, das beim Kunden landet.
--
-- Jetzt stehen die Angaben in der Zeile der Firma. Sind sie leer, gelten weiterhin die globalen
-- Werte; so bricht nichts, solange eine Firma ihren Briefkopf noch nicht erfasst hat.
--
-- Nach dieser Migration müssen die beiden Edge Functions neu ausgeliefert werden
-- (`regierapport-pdf` und `regierapport-senden`), sie lesen die neuen Spalten.

alter table firma add column if not exists briefkopf_name    text;
alter table firma add column if not exists briefkopf_slogan  text;
alter table firma add column if not exists briefkopf_adresse text;
alter table firma add column if not exists briefkopf_tel     text;
alter table firma add column if not exists briefkopf_fax     text;
alter table firma add column if not exists briefkopf_mail    text;
alter table firma add column if not exists briefkopf_web     text;
alter table firma add column if not exists briefkopf_bank    text;
alter table firma add column if not exists briefkopf_mwst    text;

-- Die bisherigen globalen Werte beschreiben Arbnors Betrieb (erfasst 15.09.) — die gehören der
-- Gerüst GmbH. Nur setzen, was noch leer ist, damit ein zweiter Lauf nichts überschreibt.
do $$
declare
  w record;
begin
  select
    max(case when schluessel = 'FIRMA_NAME'    then wert end) as name,
    max(case when schluessel = 'FIRMA_SLOGAN'  then wert end) as slogan,
    max(case when schluessel = 'FIRMA_ADRESSE' then wert end) as adresse,
    max(case when schluessel = 'FIRMA_TEL'     then wert end) as tel,
    max(case when schluessel = 'FIRMA_FAX'     then wert end) as fax,
    max(case when schluessel = 'FIRMA_MAIL'    then wert end) as mail,
    max(case when schluessel = 'FIRMA_WEB'     then wert end) as web,
    max(case when schluessel = 'FIRMA_BANK'    then wert end) as bank,
    max(case when schluessel = 'FIRMA_MWST'    then wert end) as mwst
    into w
    from konfiguration;

  update firma set
    briefkopf_name    = coalesce(briefkopf_name, w.name, name),
    briefkopf_slogan  = coalesce(briefkopf_slogan, w.slogan),
    briefkopf_adresse = coalesce(briefkopf_adresse, w.adresse),
    briefkopf_tel     = coalesce(briefkopf_tel, w.tel),
    briefkopf_fax     = coalesce(briefkopf_fax, w.fax),
    briefkopf_mail    = coalesce(briefkopf_mail, w.mail),
    briefkopf_web     = coalesce(briefkopf_web, w.web),
    briefkopf_bank    = coalesce(briefkopf_bank, w.bank),
    briefkopf_mwst    = coalesce(briefkopf_mwst, w.mwst)
  where name = 'Gerüst GmbH';
end $$;

-- We-Plan bekommt vorerst nur den Namen. Adresse, Telefon und Bank trägt Amir ein
-- (Verwaltung → Einstellungen), erfundene Angaben gehören nicht auf ein Kundendokument.
update firma set briefkopf_name = coalesce(briefkopf_name, name) where name = 'We-Plan';

-- ── Probe ────────────────────────────────────────────────────────────────────────────────────
select name, briefkopf_name, briefkopf_adresse, briefkopf_tel from firma order by name;
