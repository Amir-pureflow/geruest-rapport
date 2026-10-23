-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0048 · Regie-Beträge liest nur das Büro (24.10.2026)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Gegenprüfung 24.10.2026 (live, nur gelesen): 0041 liess das Lesen für alle Rollen der Firma offen. Damit konnte jeder
-- persönliche Chefmonteur- oder Monteur-Zugang über die API Regierapporte mit Beträgen, die Positionen mit Ansätzen und
-- das Zustellprotokoll (Kommentare der Bauleitung) lesen — die Oberfläche zeigt ihm das nie. Vor den ersten persönlichen
-- Zugängen bei einer Firma mit Regie muss das dicht sein.
--
--   - `regierapport`, `regie_position`, `zustellung_log`: lesen nur Büro (RESTRICTIVE, zusätzlich zur Firmen-Regel).
--     Die Sichten mit Beträgen (regie_kennzahlen, regie_auswertung, regie_durchlauf) laufen mit security_invoker und
--     sind damit für alle anderen leer.
--   - Firmen-Zugänge (Teamgerät, Inhaber) gelten als Büro (0041) und sehen weiter alles.
--   - Der Chefmonteur braucht vom Regierapport nur den Stand, nie den Betrag: seine Startseite zeigt Aufträge der
--     Bauleitung, solange sie «bestellt» oder «gemeldet» sind. `zusatzauftrag_rapport()` liefert dafür Kennung, Nummer
--     und Stand (ohne Betrag) mit den Rechten der Datenbank, nur in der eigenen Firma; `zusatzauftrag_stand` rechnet
--     damit wie bisher. Ohne das stünde ein längst verrechneter Auftrag beim Chefmonteur wieder als «bestellt» da.
--   - «Frühere ersetzen» am Teamgerät fragt über `meldung_regierapporte()` nur die Zahl ab (src/lib/ersetzen.ts).
--     `tagesmeldung_entfernen()` (0043) prüft ohnehin selbst.
-- Wiederholbar.

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Lesen nur fürs Büro
-- ────────────────────────────────────────────────────────────────────────────────────────────

drop policy if exists regierapport_rolle_lesen on regierapport;
create policy regierapport_rolle_lesen on regierapport as restrictive for select to authenticated
  using (ist_buero());

drop policy if exists regie_position_rolle_lesen on regie_position;
create policy regie_position_rolle_lesen on regie_position as restrictive for select to authenticated
  using (ist_buero());

drop policy if exists zustellung_log_rolle_lesen on zustellung_log;
create policy zustellung_log_rolle_lesen on zustellung_log as restrictive for select to authenticated
  using (ist_buero());

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Stand des Regierapports zu einem Auftrag — ohne Betrag, nur eigene Firma
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function zusatzauftrag_rapport(p_zusatzauftrag uuid)
returns table (id uuid, nummer text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.nummer, r.status
    from regierapport r
   where r.zusatzauftrag_id = p_zusatzauftrag
     and r.firma_id = aktuelle_firma()
   order by r.erstellt_am desc
   limit 1;
$$;

revoke all on function zusatzauftrag_rapport(uuid) from public, anon;
grant execute on function zusatzauftrag_rapport(uuid) to authenticated, service_role;

-- Wie 0041, nur der Regierapport kommt jetzt aus zusatzauftrag_rapport() statt direkt aus der Tabelle.
create or replace view zusatzauftrag_stand with (security_invoker = true) as
 SELECT z.id,
    z.client_uuid,
    z.baustelle_id,
    z.besteller_name,
    z.besteller_rolle,
    z.bestellt_am,
    z.kanal,
    z.taetigkeit,
    z.geplant_fuer,
    z.notiz,
    z.status,
    z.erledigt_grund,
    z.erledigt_am,
    z.erledigt_von,
    b.konto_nr,
    b.bezeichnung AS baustelle_bezeichnung,
        CASE
            WHEN z.status = 'erledigt_ohne_regie'::text THEN 'erledigt_ohne_regie'::text
            WHEN r.status = 'bestaetigt'::text THEN 'bestaetigt'::text
            WHEN r.status = ANY (ARRAY['versendet'::text, 'rueckfrage'::text, 'frist_abgelaufen'::text]) THEN 'beim_kunden'::text
            WHEN r.id IS NOT NULL THEN 'im_regierapport'::text
            WHEN m.id IS NOT NULL THEN 'gemeldet'::text
            ELSE 'bestellt'::text
        END AS stand,
    m.datum AS gemeldet_am,
    m.team_bezeichnung AS gemeldet_von_team,
    r.id AS regierapport_id,
    r.nummer AS regierapport_nummer,
    r.status AS regierapport_status,
    z.status = 'offen'::text AND r.id IS NULL AND m.id IS NULL AND z.geplant_fuer IS NOT NULL AND z.geplant_fuer < (now() AT TIME ZONE 'Europe/Zurich'::text)::date AS ohne_meldung,
    b.kunde_id,
    k.name AS kunde_name,
    k.email AS kunde_email,
    k.ansprechperson AS kunde_ansprechperson,
    COALESCE(k.anzeige_noetig, true) AS anzeige_noetig,
    z.angezeigt_am,
    z.angezeigt_an
   FROM zusatzauftrag z
     JOIN baustelle b ON b.id = z.baustelle_id
     LEFT JOIN kunde k ON k.id = b.kunde_id
     LEFT JOIN LATERAL zusatzauftrag_rapport(z.id) r ON true
     LEFT JOIN LATERAL ( SELECT t.id,
            t.datum,
            tm.bezeichnung AS team_bezeichnung
           FROM tagesmeldung t
             LEFT JOIN team tm ON tm.id = t.team_id
          WHERE t.baustelle_id = z.baustelle_id AND t.datum >= (z.bestellt_am AT TIME ZONE 'Europe/Zurich'::text)::date AND (t.normalfall = false AND (t.abweichung_typ = ANY (ARRAY['zusaetzlich'::text, 'kaputt'::text])) OR (EXISTS ( SELECT 1
                   FROM zeiteintrag ze
                  WHERE ze.tagesmeldung_id = t.id AND ze.ueber_min > 0)))
          ORDER BY t.datum
         LIMIT 1) m ON true;

-- ────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Gibt es zu einer Meldung einen Regierapport? Nur die Zahl, nur eigene Firma
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function meldung_regierapporte(p_meldung uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from regierapport r
   where r.tagesmeldung_id = p_meldung
     and r.firma_id = aktuelle_firma();
$$;

revoke all on function meldung_regierapporte(uuid) from public, anon;
grant execute on function meldung_regierapporte(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
