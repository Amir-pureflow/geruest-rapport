# Edge Functions

Quelle der Wahrheit sind die Dateien hier im Repo. Änderungen zuerst hier, dann deployen.

Seit 20.09.2026 braucht die App nur noch **eine** Function:

| Function | JWT | Zweck |
|---|---|---|
| `push-senden` | **nein** | Benachrichtigungen «Plan für morgen» (16:00) und «Plan geändert» an die Teamgeräte (Web Push, 0052). Ruft nur die Datenbank auf (pg_net) — Zugang über `x-push-geheim` = `PUSH_GEHEIM` aus `konfiguration`. Verschlüsselung und Signatur in `_shared/webpush.ts` (nur WebCrypto, gegen http_ece und echten Chrome-Empfang geprüft). |
| `wetter-laden` | **nein** | Wetter der MeteoSchweiz-Lokalprognose (Open Data) für Baustellen und Gebiete (0054). Alle zwei Stunden von der Datenbank aufgerufen (pg_cron → `wetter_anstossen` → pg_net), `{"teil":"tage"}` und `{"teil":"boeen"}` getrennt. Zugang über `x-wetter-geheim` = `WETTER_GEHEIM` aus `konfiguration`. |
| `transkribieren` | ja | Sprachnotiz → Text (Mistral, Voxtral). Zwei Wege: «Vorschau» direkt aus der Erfassung (`audio_base64` + `team_id`, Text wird vor dem Speichern geprüft) und nachträglich per `client_uuid` / `tagesmeldung_id` (offline erfasst, Fehler, «Text erstellen» im Cockpit). Sprache kommt aus `mitarbeiter.sprache`, wird nie geraten. |

Die Regie-Functions `regierapport-senden`, `bestaetigung`, `regierapport-pdf`, `mehrkosten-anzeigen` und
`beschrieb-vorschlagen` sind aus der App verschwunden (SORBA macht die Regie). Sie sind ggf. noch deployed und können im
Dashboard gelöscht werden; die Beschreibung steht in `archiv/regie-und-board/original/supabase/functions/README.md`.

## Zugang (seit 13.10.2026)

Jede Function mit Service-Role prüft zuerst `aufrufer(req)` aus `_shared/zugang.ts` (Firma + Rolle der Sitzung) und
vergleicht die `firma_id` der betroffenen Zeile. Nur `bestaetigung` (Kundenlink) läuft ohne JWT — dort ist der
`link_token` der Zugang, und Antworten zählen nur, solange der Rapport beim Kunden ist.

## Deploy

Per Supabase-MCP (`deploy_edge_function`) oder CLI:

```
npx supabase functions deploy transkribieren --project-ref rilknynqwzamgpimniyz --use-api
npx supabase functions deploy bestaetigung --project-ref rilknynqwzamgpimniyz --use-api --no-verify-jwt
npx supabase functions deploy push-senden --project-ref rilknynqwzamgpimniyz --use-api --no-verify-jwt
npx supabase functions deploy wetter-laden --project-ref rilknynqwzamgpimniyz --use-api --no-verify-jwt
```

`_shared/*.ts` wird mitgebündelt. Vorher die laufende Fassung mit `functions download` holen und vergleichen.

Ohne CLI/MCP: Dashboard → Edge Functions → Function öffnen → Code aus `index.ts` einfügen → Deploy.

## Migrationen (ohne CLI)

Jede Datei unter `supabase/migrations/` wird im Dashboard → **SQL Editor** eingefügt und mit «Run» ausgeführt — in
Nummernreihenfolge. Neu am 20.09.: `0016_zeiten_von_bis.sql` (Zeiten von–bis am Zeiteintrag).

## Schlüssel in `konfiguration`

Die Tabelle hat RLS ohne Policies — nur die Service-Role (in der Function) liest sie.

| Schlüssel | Pflicht | Zweck |
|---|---|---|
| `MISTRAL_API_KEY` | für Transkription | Mistral (Paris, EU). Ohne Schlüssel bleibt die Sprachnotiz nur zum Anhören. |
| `TRANSKRIPT_MODELL` | nein | Standard `voxtral-mini-latest` |
| `UEBERSETZUNG_MODELL` | nein | Standard `mistral-small-latest` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | für Benachrichtigungen | Web Push (RFC 8292), base64url: öffentlich 65 Byte, privat 32 Byte (d). Den öffentlichen holt die App über `push_schluessel()`. Neue Schlüssel = alle Geräte müssen neu einschalten. |
| `PUSH_GEHEIM` | für Benachrichtigungen | Zufallswert; die Datenbank schickt ihn an `push-senden` mit |
| `WETTER_GEHEIM` | für das Wetter | Zufallswert (legt 0054 selbst an); die Datenbank schickt ihn an `wetter-laden` mit |
| `SUPABASE_URL` | für Benachrichtigungen | Adresse des Projekts — dorthin ruft pg_net die Function auf |
| `VAPID_KONTAKT` | nein | Kontakt für die Push-Dienste (sonst `APP_URL`) |

Die Mail-Schlüssel (`RESEND_API_KEY`, `MAIL_*`) und `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`APP_URL` (pg_net-Erinnerungen)
gehörten zur Regie und werden nicht mehr gelesen.

## Storage «anhaenge» (seit 0009)

Eingeloggte (auch anonyme) Sitzungen dürfen **lesen und hochladen, nicht ändern, nicht löschen** — Belege bleiben (CLAUDE.md #8).
`src/lib/db.ts` lädt ohne upsert und wertet «existiert schon» (409) als Erfolg.
