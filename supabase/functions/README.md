# Edge Functions

Quelle der Wahrheit sind die Dateien hier im Repo. Änderungen zuerst hier, dann deployen.

| Function | JWT | Zweck |
|---|---|---|
| `regierapport-senden` | ja | Mail via Resend (fester Betreff pro Baustelle + Rapportnummer), Anhang, Frist +3 Tage, `zustellung_log`. Empfänger wird **serverseitig** geprüft. Modus `erinnerung` für die Nachfass-Mail. |
| `bestaetigung` | **nein** | Kundenlink `/b/:token`: GET liefert Rapport, Positionen, Fotos (signierte Links, 1 h); POST bestätigt / Rückfrage |

## Deploy

Per Supabase-MCP (`deploy_edge_function`, `verify_jwt` wie in der Tabelle) oder CLI:

```
supabase functions deploy regierapport-senden
supabase functions deploy bestaetigung --no-verify-jwt
```

Ohne CLI/MCP: Dashboard → Edge Functions → Function öffnen → Code aus `index.ts` einfügen → Deploy.
`verify_jwt` steht in den Function-Einstellungen (bei `bestaetigung` **aus**).

## Migrationen (ohne CLI)

Es gibt hier keine Möglichkeit, `supabase db push` auszuführen. Jede Datei unter `supabase/migrations/`
wird im Dashboard → **SQL Editor** eingefügt und mit «Run» ausgeführt — in Nummernreihenfolge.
`0009_verbesserungen.sql` ist idempotent (mehrfaches Ausführen ist folgenlos) und rein additiv.

Reihenfolge für 0009:

1. Dashboard → **Database → Extensions**: `pg_cron` einschalten (Fristenlauf) und `pg_net` (Erinnerungsmails aus der Datenbank).
   Beides ist optional — ohne `pg_cron` ruft n8n täglich `select regie_fristen_taeglich();` auf, ohne `pg_net` schickt n8n die Erinnerungen (siehe unten).
2. SQL Editor → Inhalt von `0009_verbesserungen.sql` einfügen → Run. Bei fehlendem `pg_cron` erscheint nur ein `NOTICE`; nach dem Einschalten die Datei nochmals ausführen, damit der Cron-Job angelegt wird.
3. Tabelle `konfiguration` ergänzen (SQL Editor, Werte einsetzen):

   ```sql
   insert into konfiguration (schluessel, wert) values
     ('SUPABASE_URL',       'https://<projekt>.supabase.co'),
     ('SUPABASE_ANON_KEY',  '<anon key aus Settings → API>'),
     ('APP_URL',            'https://<app-domain>'),                -- Basis für den Kundenlink in Erinnerungsmails
     ('MAIL_TESTEMPFAENGER','amir@pureflow-ai.com,zweite@adresse.ch')  -- optional, siehe unten
   on conflict (schluessel) do update set wert = excluded.wert;
   ```

4. `regierapport-senden` neu deployen (Modus `erinnerung`, Empfängerprüfung).
5. Prüfen: `select * from regie_kennzahlen;` liefert eine Zeile; `select regie_fristen_taeglich();` läuft ohne Fehler;
   `select * from cron.job;` zeigt `regie_fristen_0600_sommer` und `regie_fristen_0600_winter` (nur mit pg_cron).

## Schlüssel in `konfiguration`

Die Tabelle hat RLS ohne Policies — nur die Service-Role (in der Function) und `security definer`-Funktionen lesen sie.

| Schlüssel | Pflicht | Zweck |
|---|---|---|
| `RESEND_API_KEY` | ja | Resend |
| `MISTRAL_API_KEY` | für Transkription | Mistral (Paris, EU). Ohne Schlüssel bleibt die Sprachnotiz nur zum Anhören. |
| `TRANSKRIPT_MODELL` | nein | Standard `voxtral-mini-latest` |
| `UEBERSETZUNG_MODELL` | nein | Standard `mistral-small-latest` |
| `MAIL_ABSENDER` | empfohlen | z. B. `Rapporto <regie@pureflow-ai.com>` (Domain muss bei Resend verifiziert sein) |
| `MAIL_FIRMA` | nein | Firmenname in Fusszeile und Absender-Rückfall |
| `MAIL_TESTEMPFAENGER` | nein | Kommagetrennte Adressen, an die ein Rapport **zusätzlich zur Kunden-Mail** gesendet werden darf (Pilot, eigene Tests). Alles andere lehnt die Function mit 403 ab. Erlaubt sind ausserdem `kunde.weitere_emails` (Migration 0014) und jede Adresse mit derselben Domain wie `kunde.email`. |
| `MAIL_ANTWORT_AN` | empfohlen | Reply-To, wenn die Sitzung keine E-Mail hat (Ansicht ohne Login): Antworten der Bauleitung landen dort, z. B. `arbnor.arifi@geruestgmbh.ch`. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | für pg_net | Damit `regie_erinnerungen_anstossen()` die Function aus der Datenbank aufrufen kann. Der anon key genügt (`verify_jwt` akzeptiert ihn); der Service-Role-Key gehört **nicht** in diese Tabelle. |
| `APP_URL` | für Erinnerungen | Basis-URL der App für den Kundenlink, wenn kein `basis_url` im Aufruf steckt (Cron kennt keinen Browser). |

## Empfängerregel (seit 0009)

Die App darf im Feld «E-Mail der Bauleitung» nichts Beliebiges eintragen. Die Function lädt Baustelle → Kunde und erlaubt:

- die hinterlegte `kunde.email` (Standard, wenn `empfaenger_email` im Body fehlt),
- eine Adresse aus `MAIL_TESTEMPFAENGER`.

`zusatzauftrag` kennt nur `besteller_name` / `besteller_rolle`, keine Mail — darum gibt es keinen Besteller-Sonderfall.
Fehlt beim Kunden die Mail: 400 mit Hinweis auf Verwaltung → Kunden. Der verwendete Empfänger wird am Rapport gespeichert (`empfaenger_email`).

## Fristen und Erinnerungen

- `regie_fristen_pruefen()`: `versendet` + `frist_bis < heute` → Status `frist_abgelaufen`, Chronik `frist_abgelaufen`.
- `regie_erinnerungen_anstossen()`: für jeden `frist_abgelaufen`-Rapport ohne `erinnert`-Eintrag seit dem Versand ein `net.http_post`
  an `…/functions/v1/regierapport-senden` mit `{ "modus": "erinnerung", "regierapport_id": "…" }`. Die Function schreibt `erinnert`;
  schlägt der Aufruf fehl, kommt der Rapport am nächsten Tag wieder dran. Ohne `pg_net` gibt die Funktion 0 zurück.
- `regie_fristen_taeglich()`: beides nacheinander; das ruft pg_cron um 04:00 und 05:00 UTC auf (= 06:00 Europe/Zurich in Sommer- bzw. Winterzeit;
  der zweite Lauf findet nichts mehr).

**Variante ohne pg_cron/pg_net — n8n:**

1. Schedule-Trigger täglich 06:00 Europe/Zurich.
2. Postgres-Node (oder Supabase-Node «RPC»): `select regie_fristen_pruefen();`
3. Postgres-Node: `select id from regierapport r where status = 'frist_abgelaufen' and empfaenger_email is not null and not exists (select 1 from zustellung_log l where l.regierapport_id = r.id and l.ereignis = 'erinnert' and l.zeitpunkt >= coalesce(r.versendet_am, r.erstellt_am));`
4. Pro Zeile HTTP-Request `POST https://<projekt>.supabase.co/functions/v1/regierapport-senden`, Header `apikey` + `Authorization: Bearer <anon key>`,
   Body `{ "modus": "erinnerung", "regierapport_id": "{{ $json.id }}", "basis_url": "https://<app-domain>" }`.

Manuell testen: `select regie_fristen_taeglich();` im SQL Editor — Rückgabe `{"frist_abgelaufen": n, "erinnerungen": m}`.

## Storage «anhaenge» (seit 0009)

Eingeloggte (auch anonyme) Sitzungen dürfen **lesen und hochladen, nicht ändern, nicht löschen** — Belege bleiben (CLAUDE.md #8).
Folgen für den Code:

- Uploads mit `upsert: true` scheitern (brauchen Update-Recht). `src/lib/db.ts` lädt ohne upsert und wertet «existiert schon» (409) als Erfolg.
- `storage.remove(...)` scheitert leise; Stellen, die Dateien entfernen wollen (z. B. «Entwurf verwerfen» in `RegieDetail.tsx`), sollen das nicht mehr versuchen — die Datei bleibt, nur die Verknüpfung geht weg.

## Zustellbarkeit (Spam)

Solange `MAIL_ABSENDER` auf `onboarding@resend.dev` steht, landen die Mails bei vielen Empfängern im Spam: geteilter
Test-Absender, keine eigene Domain-Reputation. Abhilfe in Resend → Domains: eigene Subdomain (z. B. `mail.pureflow-ai.com`,
später `mail.rapporto.ch`) anlegen, die drei DNS-Einträge (MX, SPF-TXT, DKIM-TXT) beim DNS-Anbieter (pureflow-ai.com: Hostpoint)
setzen, verifizieren, dann `MAIL_ABSENDER = Rapporto <regie@mail.pureflow-ai.com>`. Zusätzlich in Resend das Click- und
Open-Tracking für die Domain abschalten — die umgeschriebenen Links sehen für Mailfilter wie Phishing aus.
