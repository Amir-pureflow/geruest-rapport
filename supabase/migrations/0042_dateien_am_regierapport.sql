-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0042 · Dateien am Regierapport: nachgereichte Fotos und eigenes Dokument (13.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Der Rapport-Bildschirm lädt nachgereichte Fotos nach `fotos/rapport/<rapport_id>/…` und das eigene Dokument
-- (SORBA-PDF) seit heute nach `rapporte/<rapport_id>/…`. `anhang_gehoert_firma()` aus 0020 kannte beide Pfade nicht:
-- bei `fotos/` suchte sie eine Meldung mit der client_uuid «rapport», bei `rapporte/` nur `<id>.pdf` — das Hochladen
-- scheiterte (betrifft nur Firmen mit Regie). Dazu Rollen (0041): Rapport-Dateien nur fürs Büro; Chefmonteur und
-- Monteur sehen und laden nur, was zu Meldungen gehört (Sprachnotiz, Fotos).
-- Wiederholbar.

create or replace function anhang_gehoert_firma(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select case (storage.foldername(p_name))[1]
    when 'audio' then exists (
      select 1 from tagesmeldung m
       where m.firma_id = aktuelle_firma()
         and m.client_uuid::text = regexp_replace(storage.filename(p_name), '\.[^.]+$', '')
    )
    when 'fotos' then case
      when (storage.foldername(p_name))[2] = 'rapport' then ist_buero() and exists (
        select 1 from regierapport r
         where r.firma_id = aktuelle_firma()
           and r.id::text = (storage.foldername(p_name))[3]
      )
      else exists (
        select 1 from tagesmeldung m
         where m.firma_id = aktuelle_firma()
           and m.client_uuid::text = (storage.foldername(p_name))[2]
      )
    end
    -- rapporte/<id>.pdf (erzeugtes PDF) oder rapporte/<id>/<datei> (eigenes Dokument)
    when 'rapporte' then ist_buero() and exists (
      select 1 from regierapport r
       where r.firma_id = aktuelle_firma()
         and r.id::text = coalesce((storage.foldername(p_name))[2], regexp_replace(storage.filename(p_name), '\.[^.]+$', ''))
    )
    else false
  end;
$$;
