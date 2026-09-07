# Edge Functions

Quelle der Wahrheit sind die Dateien hier im Repo. Änderungen zuerst hier, dann deployen.

| Function | JWT | Zweck |
|---|---|---|
| `regierapport-senden` | ja | Mail via Resend (fester Betreff pro Baustelle), Anhang, Frist +3 Tage, `zustellung_log` |
| `bestaetigung` | **nein** | Kundenlink `/b/:token`: GET liefert Rapport, Positionen, Fotos (signierte Links, 1 h); POST bestätigt / Rückfrage |

Deploy per Supabase-MCP (`deploy_edge_function`, `verify_jwt` wie in der Tabelle) oder CLI:

```
supabase functions deploy regierapport-senden
supabase functions deploy bestaetigung --no-verify-jwt
```

Schlüssel (`RESEND_API_KEY`, `MAIL_ABSENDER`) liegen in der Tabelle `konfiguration`
(RLS ohne Policies — nur die Service-Role in der Function liest sie), nicht im Code.
