# Edge Functions

Quelle der Wahrheit sind die Dateien hier im Repo. Änderungen zuerst hier, dann deployen.

Seit 20.09.2026 braucht die App nur noch **eine** Function:

| Function | JWT | Zweck |
|---|---|---|
| `transkribieren` | ja | Sprachnotiz → Text (Mistral, Voxtral). Zwei Wege: «Vorschau» direkt aus der Erfassung (`audio_base64` + `team_id`, Text wird vor dem Speichern geprüft) und nachträglich per `client_uuid` / `tagesmeldung_id` (offline erfasst, Fehler, «Text erstellen» im Cockpit). Sprache kommt aus `mitarbeiter.sprache`, wird nie geraten. |

Die Regie-Functions `regierapport-senden`, `bestaetigung`, `regierapport-pdf`, `mehrkosten-anzeigen` und
`beschrieb-vorschlagen` sind aus der App verschwunden (SORBA macht die Regie). Sie sind ggf. noch deployed und können im
Dashboard gelöscht werden; die Beschreibung steht in `archiv/regie-und-board/original/supabase/functions/README.md`.

## Deploy

Per Supabase-MCP (`deploy_edge_function`) oder CLI:

```
supabase functions deploy transkribieren
```

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

Die Mail-Schlüssel (`RESEND_API_KEY`, `MAIL_*`) und `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`APP_URL` (pg_net-Erinnerungen)
gehörten zur Regie und werden nicht mehr gelesen.

## Storage «anhaenge» (seit 0009)

Eingeloggte (auch anonyme) Sitzungen dürfen **lesen und hochladen, nicht ändern, nicht löschen** — Belege bleiben (CLAUDE.md #8).
`src/lib/db.ts` lädt ohne upsert und wertet «existiert schon» (409) als Erfolg.
