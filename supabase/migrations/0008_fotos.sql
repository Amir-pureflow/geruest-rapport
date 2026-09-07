-- 0008: Fotos zu Tagesmeldung und Regierapport.
-- Der Bauführer verlangt heute schon Bilder bei Regie (Arbnor, 27.08.). Der Chefmonteur
-- hängt sie auf dem Teamgerät an die Meldung; der Regierapport zeigt sie automatisch
-- (über tagesmeldung_id) und kann eigene nachgereichte Bilder tragen.
-- Dateien liegen im Bucket «anhaenge» unter fotos/<meldung-client_uuid>/<id>.jpg
-- bzw. fotos/rapport/<regierapport_id>/<id>.jpg. Regel #8: Belege werden nie gelöscht, solange offen.

create table if not exists foto (
  id              uuid primary key,
  tagesmeldung_id uuid references tagesmeldung(id),
  regierapport_id uuid references regierapport(id),
  pfad            text not null,
  erstellt_am     timestamptz not null default now(),
  erstellt_von    uuid,
  check (tagesmeldung_id is not null or regierapport_id is not null)
);

create index if not exists foto_tagesmeldung_idx on foto (tagesmeldung_id);
create index if not exists foto_regierapport_idx on foto (regierapport_id);

alter table foto enable row level security;
drop policy if exists foto_authenticated_all on foto;
create policy foto_authenticated_all on foto for all to authenticated using (true) with check (true);
