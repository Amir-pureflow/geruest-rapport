-- 0031 (09.10.2026): Korrekturen in der Wochenübersicht teilen Normal/Überstunden nach dem normalen
-- Arbeitstag der Firma (firma.normaltag_min, 0026) — nicht mehr fest nach 8.0 h (480, aus 0009).
-- Vorher wurde z. B. bei der Gerüst GmbH (8.4 h) eine Korrektur auf 8.4 h als 8.0 normal + 0.4 Überstunden
-- gespeichert. Die App teilt in ihrem Ersatzweg (ohne diese Funktionen) schon nach normaltag_min.
-- Dazu: nur Einträge der eigenen Firma — die Funktionen laufen als security definer, die Tabellenregeln
-- greifen darin nicht. Alte Zeilen ohne firma_id bleiben korrigierbar.
-- Gleiche Namen, Parameter und Rückgaben wie 0009: die App muss nichts ändern.

create or replace function zeit_korrigieren(p_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alt_normal int;
  alt_ueber  int;
  normaltag  int;
  neu_normal int;
  neu_ueber  int;
begin
  if p_wer is null then
    raise exception 'zeit_korrigieren: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_korrigieren: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_korrigieren: Gesamtminuten müssen >= 0 sein';
  end if;

  select z.normal_min, z.ueber_min, coalesce(f.normaltag_min, 504)
    into alt_normal, alt_ueber, normaltag
  from zeiteintrag z
  left join firma f on f.id = z.firma_id
  where z.id = p_id and (z.firma_id is null or z.firma_id = aktuelle_firma())
  for update of z;
  if not found then
    raise exception 'zeit_korrigieren: Zeiteintrag % nicht gefunden', p_id;
  end if;

  neu_normal := least(p_total_min, normaltag);
  neu_ueber  := greatest(0, p_total_min - normaltag);

  if neu_normal <> alt_normal then
    insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
    values (p_id, p_wer, 'normal_min', alt_normal::text, neu_normal::text, trim(p_grund));
  end if;
  if neu_ueber <> alt_ueber then
    insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
    values (p_id, p_wer, 'ueber_min', alt_ueber::text, neu_ueber::text, trim(p_grund));
  end if;

  update zeiteintrag z set normal_min = neu_normal, ueber_min = neu_ueber where z.id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'normal_min', neu_normal,
    'ueber_min', neu_ueber,
    'total_min', neu_normal + neu_ueber
  );
end;
$$;

create or replace function zeit_team_setzen(p_tagesmeldung_id uuid, p_total_min int, p_wer uuid, p_grund text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  z record;
  anzahl int := 0;
  normaltag  int;
  neu_normal int;
  neu_ueber  int;
begin
  if p_wer is null then
    raise exception 'zeit_team_setzen: p_wer (wer korrigiert) fehlt';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'zeit_team_setzen: Begründung ist Pflicht (wer/wann/von/auf/warum)';
  end if;
  if p_total_min is null or p_total_min < 0 then
    raise exception 'zeit_team_setzen: Gesamtminuten müssen >= 0 sein';
  end if;

  select coalesce(f.normaltag_min, 504) into normaltag
  from tagesmeldung t
  left join firma f on f.id = t.firma_id
  where t.id = p_tagesmeldung_id and (t.firma_id is null or t.firma_id = aktuelle_firma());
  if not found then
    raise exception 'zeit_team_setzen: Meldung % nicht gefunden', p_tagesmeldung_id;
  end if;

  neu_normal := least(p_total_min, normaltag);
  neu_ueber  := greatest(0, p_total_min - normaltag);

  for z in
    select id, normal_min, ueber_min
    from zeiteintrag
    where tagesmeldung_id = p_tagesmeldung_id and status = 'offen'
    for update
  loop
    if z.normal_min = neu_normal and z.ueber_min = neu_ueber then
      continue;
    end if;
    if z.normal_min <> neu_normal then
      insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
      values (z.id, p_wer, 'normal_min', z.normal_min::text, neu_normal::text, trim(p_grund));
    end if;
    if z.ueber_min <> neu_ueber then
      insert into freigabe_log (zeiteintrag_id, wer, feld, alt, neu, begruendung)
      values (z.id, p_wer, 'ueber_min', z.ueber_min::text, neu_ueber::text, trim(p_grund));
    end if;
    update zeiteintrag set normal_min = neu_normal, ueber_min = neu_ueber where id = z.id;
    anzahl := anzahl + 1;
  end loop;

  return anzahl;
end;
$$;
