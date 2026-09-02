# Edge Functions — geplant

| Function | Phase | Aufgabe |
|---|---|---|
| `transkription` | 6 | Audio aus Storage → STT-Adapter (Anbieter offen) → Claude: deutscher Text + `{taetigkeit, grund, wer}` + R6-Signale. Sprache aus `mitarbeiter.sprache`, nie geraten |
| `regie-regeln` | 4 | R1–R6 über einer Tagesmeldung auswerten → Ampelstatus + Begründung |
| `tarif-rechner` | 4 | Serverseitige Variante von `src/lib/tarif.ts` (gleiche Fixtures, gleiche Tests) |
| `pdf` | 4 | Rapport-/Begleit-PDF aus Vorlage (pdf-lib) |
| `bestaetigung` | 4 | Signierten Kundentoken prüfen, Rapportdaten liefern, [Bestätigen]/[Rückfrage] entgegennehmen → `zustellung_log` |
| `mail-webhook` | 4 | Resend/Postmark-Webhooks (zugestellt/geöffnet/geklickt) → `zustellung_log` |

Konvention: Geld in Rappen, Zeit in Minuten — wie im Frontend (CLAUDE.md #6).
