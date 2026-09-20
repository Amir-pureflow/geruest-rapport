# Archiv: Regie, Zusatzaufträge, Kundenlink, Board

**Entfernt am 20.09.2026** auf Wunsch des Bauführers (Demo durch Erin): *«Regierapporte und alles, was damit zu tun
hat, brauche ich in der App nicht — SORBA macht das, das wäre doppelte Arbeit.»* Das Board (Jahresplan Team × KW) kam
gleich mit weg.

Aufgehoben für spätere Kunden. Nichts hier wird kompiliert oder ausgeliefert (`tsconfig.json` nimmt nur `src` und
`fixtures`). Zusätzlich liegt der letzte Stand **mit** Regie in der Git-Historie — vor dem Entfernen wurde der Stand
als Branch/Tag `mit-regie-und-board` gesichert (falls der Push das noch nicht hat: auf GitHub aus dem letzten Commit vor
dem 20.09. anlegen).

## Was drin ist (`original/`, Stand unmittelbar vor dem Entfernen)

| Bereich | Dateien |
|---|---|
| Zusatzauftrag (Stufe 1, Kundenbestellung) | `src/seiten/Zusatzauftrag.tsx`, `src/lib/zusatzauftrag.ts`, Warteschlange in `src/lib/db.ts` (`enqueueZusatzauftrag`, `flushAuftraege`) |
| Regierapporte | `src/seiten/RegieListe.tsx`, `RegieDetail.tsx`, `RegieVorschau.tsx`, `src/lib/regie.ts` (+ Tests) |
| SGUV-Tarifrechner | `src/lib/tarif.ts` (+ Tests, Referenzfall «Gerüst versetzen» = Fr. 955.93), `fixtures/tarife_sguv_2026.json` |
| Auswertung Regie pro Baustelle/Kunde/Monat | `src/seiten/Auswertung.tsx` |
| Kundenlink ohne Login (`/b/:token`) + Ansicht «Kunde» | `src/seiten/Bestaetigung.tsx`, `StartKunde.tsx`, Eintrag `kunde` in `src/lib/ansicht.ts` |
| Regieverdacht in der Wochenübersicht («Regierapport vorrechnen», «Keine Regie» mit Grund, CHF vorgerechnet) | `src/seiten/Cockpit.tsx` (Original) |
| Dashboard-Kacheln Regie, Trichter der Zusatzaufträge, Regie je Monat, Fristen | `src/seiten/Start.tsx`, `src/ui/Diagramm.tsx`, `src/lib/kennzahlen.ts` (Originale) |
| «Vom Kunden bestellt» auf der Chefmonteur-Startseite | `src/seiten/StartChef.tsx` (Original) |
| Board (Jahresplan Team × KW, Verschiebungen → `planaenderung`) | `src/seiten/Board.tsx` |
| Demo mit Zusatzaufträgen und Regierapporten in allen Stadien | `src/lib/demo.ts` (+ Test, Original) |
| Navigation, Routen, Ansichten | `src/ui/Shell.tsx`, `src/main.tsx`, `src/seiten/Ansicht.tsx` (Originale) |
| Doku | `CLAUDE.md` (Abschnitte Zusatzauftrag-Stand, Mehrkostenanzeige, Regieverdacht, Regierapport-PDF), `README.md`, `supabase/functions/README.md` |
| Datenbank | alle Migrationen 0001–0016 (Kopie) — die Regie-Tabellen `zusatzauftrag`, `regierapport`, `regie_position`, `zustellung_log`, die Sichten `zusatzauftrag_stand`, `regie_kennzahlen`, `regie_auswertung`, die RPC `regierapport_anlegen`, der Fristen-Cron (`regie_fristen_taeglich`) und die Spalten `tagesmeldung.regie_entscheid/regie_grund/…`, `kunde.anzeige_noetig/frist_tage/weitere_emails` |

| Verwaltung Kunden (Bauleitungs-Mail-Erklärung, weitere Empfänger, Rechnungsadresse fürs PDF, einzeln/gesammelt, Anzeige nötig, Frist) | `src/seiten/verwaltung/Kunden.tsx` |
| Edge Functions Regie: Kundenmail + Erinnerung, Kundenlink ohne Login, PDF wie SORBA, Mehrkostenanzeige, Leistungsbeschrieb per KI | `supabase/functions/regierapport-senden`, `bestaetigung`, `regierapport-pdf` (+ `_shared/rapport_pdf.ts`), `mehrkosten-anzeigen`, `beschrieb-vorschlagen` (Stand main 328ef46, 19.09.) |

Die Edge Functions im Supabase-Projekt selbst wurden nicht gelöscht — sie laufen weiter, werden aber von nichts mehr aufgerufen.

## Was in der Datenbank bleibt

Die Migrationen wurden **nicht** zurückgebaut — Tabellen, Sichten, RPCs und der pg_cron-Job existieren weiter, nur
ungenutzt. `demoZuruecksetzen()` leert die Regie-Tabellen weiterhin mit. Wer aufräumen will: Edge Functions im
Supabase-Dashboard löschen, `select cron.unschedule('regie_fristen_0600_sommer')` und `…_winter`, dann die Tabellen
droppen. Vorher `mitarbeiter.sprache` und alles Nicht-Regie-bezogene stehen lassen.

## Wiederherstellen (für einen neuen Kunden, der Regie in der App will)

1. Branch/Tag `mit-regie-und-board` anschauen — dort ist alles konsistent zusammengebaut, inkl. Verwaltung und Edge Functions.
2. Oder aus `original/` zurückkopieren: die gelöschten Dateien 1:1, bei den geänderten (Cockpit, Start, StartChef, Shell,
   main, ansicht, db, demo, kennzahlen, Diagramm) die Regie-Teile per Diff zurückholen — die Fassungen hier enthalten
   bereits die Neuerungen vom 20.09. (Zeiten von–bis, Gäste, Bemerkung zum Tag) **noch nicht** überall; ein Diff gegen
   den aktuellen Stand ist Pflicht.
3. `tarife_sguv_2026.json` gehört zurück nach `fixtures/` und die Tarif-Tests laufen lassen (Referenzfall Fr. 955.93).
4. Die Regeln aus dem archivierten `CLAUDE.md` gelten dann wieder: Stand wird abgeleitet, nie geklickt; kein «abgerechnet»
   in der App; Empfängerprüfung serverseitig; Fristen 3 Tage.
