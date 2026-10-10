-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0035 · Funktionen mit Sonderrechten: nie ohne Anmeldung (10.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `revoke … from public` (0009, 0034) nimmt die Rechte, die Supabase der Rolle `anon` ausdrücklich gibt,
-- nicht weg. So war z. B. `zugang_umbenennen` mit dem öffentlichen Schlüssel aus der App aufrufbar —
-- jeder hätte die Login-Adresse eines Kontos ändern können (Prüfung 10.10.2026, nichts passiert).
--
-- Hier: kein Aufruf ohne Anmeldung. Reine Hilfsfunktionen, die nur andere Funktionen mit Sonderrechten
-- aufrufen (dort laufen sie als Besitzer), auch nicht mit Anmeldung. Was die App braucht, bleibt für
-- `authenticated`. `aktuelle_firma` und `anhang_gehoert_firma` bleiben, wie sie sind: die Regeln (RLS)
-- rufen sie bei jeder Abfrage auf.

revoke execute on function zugang_umbenennen(text, text) from public, anon, authenticated;
revoke execute on function konto_von(uuid, uuid)          from public, anon, authenticated;
revoke execute on function konten_recht(text)             from public, anon, authenticated;

revoke execute on function konten_der_firma()                    from anon;
revoke execute on function konto_anlegen(uuid, text, text, text) from anon;
revoke execute on function konto_rolle(uuid, text)               from anon;
revoke execute on function konto_passwort(uuid, text)            from anon;
revoke execute on function konto_loeschen(uuid)                  from anon;

revoke execute on function zeit_freigeben(uuid[], uuid, text)      from anon;
revoke execute on function zeit_korrigieren(uuid, int, uuid, text) from anon;
revoke execute on function zeit_team_setzen(uuid, int, uuid, text) from anon;
revoke execute on function regierapport_nummer_naechste(int)       from anon;
revoke execute on function regie_fristen_pruefen()                 from anon;
revoke execute on function regie_erinnerungen_anstossen()          from anon;
revoke execute on function regie_fristen_taeglich()                from anon;

-- Aus der ersten Fassung von 0034, von der App nicht mehr gebraucht
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'buero_firma') then
    execute 'revoke execute on function buero_firma() from public, anon, authenticated';
  end if;
end $$;
