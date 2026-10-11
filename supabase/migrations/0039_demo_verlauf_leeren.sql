-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0039 · Demo: Verlauf der Planung nach «Demo laden» leeren (11.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- «Demo laden» löscht alle Einsätze und legt sie neu an — der Auslöser aus 0038 schreibt das alles in `plan_verlauf`.
-- Für «Plan geändert» auf dem Teamgerät (Stand vor 72 h gegen jetzt) war danach jeder Demo-Einsatz «neu», und eine
-- Umplanung in der Vorführung erschien nicht als Änderung. Die App ruft diese Funktion am Ende von «Demo laden» und
-- «Alles leeren» auf. Nur für die Demo-Firma (We-Plan, wie DEMO_FIRMEN in src/lib/demo.ts) — echte Firmen behalten
-- ihren Verlauf immer. Wiederholbar.

create or replace function demo_verlauf_leeren()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := aktuelle_firma();
  n integer;
begin
  if f is null or not exists (select 1 from firma where id = f and name = 'We-Plan') then
    raise exception 'Nur in der Demo-Firma';
  end if;
  delete from plan_verlauf where firma_id = f;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function demo_verlauf_leeren() from public, anon;
grant execute on function demo_verlauf_leeren() to authenticated;
