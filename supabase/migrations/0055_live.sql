-- Live-Aktualisierung (Amir/Arbnor, 11.11.2026): meldet der Chefmonteur, sieht der Bauführer es sofort.
-- Die Büroseiten hören über Supabase Realtime auf diese Tabellen und laden neu, sobald sich etwas ändert.
-- RLS gilt auch für Realtime: jede Firma bekommt nur Änderungen an ihren eigenen Zeilen.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['tagesmeldung','zeiteintrag','foto','fehlmeldung','regierapport','zusatzauftrag','jahresplan','planaenderung','abwesenheit'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
