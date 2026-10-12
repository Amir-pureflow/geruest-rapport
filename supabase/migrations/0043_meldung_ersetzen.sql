-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0043 · «Frühere ersetzen» in einem Schritt (13.10.2026, Amir)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Das Teamgerät prüfte zuerst (Zeilen offen? korrigiert? Fotos? Sprachnotiz? Regierapport?) und löschte danach Zeilen
-- und Kopf in zwei Anfragen. Gab der Bauführer genau dazwischen frei, waren die offenen Zeilen schon weg, der Kopf
-- blieb — eine halbe Meldung. Jetzt prüft und löscht die Datenbank in einer Transaktion; die Zeilen sind dabei
-- gesperrt, ein gleichzeitiges `zeit_freigeben` wartet und findet danach nichts mehr (oder umgekehrt: die Freigabe war
-- zuerst, dann lehnt diese Funktion ab und es bleibt alles).
--
-- Rückgabe: 'entfernt' oder 'weg' (gab es nicht oder nicht in der eigenen Firma). Sonst eine Ausnahme mit dem Grund in
-- einfachen Worten — die App zeigt ihn dem Chefmonteur. Rechte wie 0041: Büro und Chefmonteur, nur die eigene Firma.
-- Wiederholbar.

create or replace function tagesmeldung_entfernen(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma uuid := aktuelle_firma();
  m record;
begin
  if v_firma is null or coalesce(aktuelle_rolle(), '') not in ('buero', 'chef') then
    raise exception 'Meldungen ersetzen darf nur das Teamgerät oder das Büro.' using errcode = '42501';
  end if;

  select t.id, t.audio_pfad into m from tagesmeldung t where t.id = p_id and t.firma_id = v_firma for update;
  if not found then
    return 'weg';
  end if;
  -- Zeilen sperren: niemand gibt frei oder korrigiert, solange hier geprüft und gelöscht wird
  perform 1 from zeiteintrag z where z.tagesmeldung_id = p_id for update;

  if exists (select 1 from zeiteintrag z where z.tagesmeldung_id = p_id and z.status <> 'offen') then
    raise exception 'Der Bauführer hat diese Meldung schon freigegeben.';
  end if;
  if exists (select 1 from freigabe_log l join zeiteintrag z on z.id = l.zeiteintrag_id where z.tagesmeldung_id = p_id) then
    raise exception 'Der Bauführer hat diese Meldung schon bearbeitet.';
  end if;
  if exists (select 1 from regierapport r where r.tagesmeldung_id = p_id) then
    raise exception 'Zu dieser Meldung gibt es schon einen Regierapport.';
  end if;
  if exists (select 1 from foto f where f.tagesmeldung_id = p_id) then
    raise exception 'Diese Meldung hat Fotos — sie bleiben als Beleg.';
  end if;
  if m.audio_pfad is not null then
    raise exception 'Diese Meldung hat eine Sprachnotiz — sie bleibt als Beleg.';
  end if;

  delete from zeiteintrag z where z.tagesmeldung_id = p_id;
  delete from tagesmeldung t where t.id = p_id;
  return 'entfernt';
end;
$$;

revoke all on function tagesmeldung_entfernen(uuid) from public, anon;
grant execute on function tagesmeldung_entfernen(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
