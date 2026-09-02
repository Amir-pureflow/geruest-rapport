-- Phase 4 — Versand & Kundenbestätigung.
--
-- link_token: unerratbarer Token für den Kundenlink /b/:token (kein Login).
-- konfiguration: Schlüsselwerte NUR für Edge Functions (Service-Role) —
--   RLS aktiv OHNE Policies = für anon/authenticated unsichtbar.
-- Storage-Bucket «anhaenge»: das SORBA-PDF, das die Mail mitnimmt.

alter table regierapport
  add column if not exists link_token uuid not null unique default gen_random_uuid(),
  add column if not exists empfaenger_email text,
  add column if not exists anhang_pfad text;

create table if not exists konfiguration (
  schluessel text primary key,
  wert       text not null
);
alter table konfiguration enable row level security; -- bewusst keine Policies

insert into storage.buckets (id, name, public)
values ('anhaenge', 'anhaenge', false)
on conflict (id) do nothing;

create policy anhaenge_authenticated_all on storage.objects
  for all to authenticated
  using (bucket_id = 'anhaenge')
  with check (bucket_id = 'anhaenge');
