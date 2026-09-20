# Archiv: Regie, Zusatzaufträge, Kundenlink, Board

**Entfernt am 20.09.2026** auf Wunsch des Bauführers (Demo durch Erin): *«Regierapporte und alles, was damit zu tun
hat, brauche ich in der App nicht — SORBA macht das, das wäre doppelte Arbeit.»* Das Board (Jahresplan Team × KW) kam
gleich mit weg.

Aufgehoben für spätere Kunden. Nichts hier wird kompiliert oder ausgeliefert (`tsconfig.json` nimmt nur `src` und
`fixtures`, Vitest nur `src`). Zusätzlich liegt der letzte Stand **mit** Regie in der Git-Historie — vor dem Entfernen
wurde der Stand als Branch/Tag `mit-regie-und-board` gesichert (falls der Push das noch nicht hat: auf GitHub aus dem
letzten Commit vor dem 20.09. anlegen, das ist `328ef46`).

**Nachtrag 20.09., später am Abend:** Der Ausbau kam über «Add files via upload» auf GitHub — und die Weboberfläche
kann nur hinzufügen, nie löschen. Die neuen Fassungen (`db.ts` ohne Regie, `main.tsx` ohne Regie-Routen) waren also
oben, die alten Regie-Seiten lagen weiter in `src/`. `Zusatzauftrag.tsx` holte sich `enqueueZusatzauftrag`,
`offeneAuftraege` und `LokalerAuftrag` aus `db.ts`, wo es die nicht mehr gibt → `tsc --noEmit` brach ab und der
Vercel-Build war rot (`eb06fc9`). Dieser Commit holt das Verschieben nach; die Dateien sind hier, nicht gelöscht.

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

### Was als Datei hier liegt und was nur in der Historie steht

Die Tabelle oben sagt, **was** zur Regie gehörte. Als Datei liegt in `original/`:

- `src/seiten/`: `Zusatzauftrag.tsx`, `RegieListe.tsx`, `RegieDetail.tsx`, `RegieVorschau.tsx`, `Auswertung.tsx`,
  `Bestaetigung.tsx`, `StartKunde.tsx`, `Board.tsx` — die gelöschten Seiten, dazu `Cockpit.tsx`, `Start.tsx`,
  `StartSekretariat.tsx`, `verwaltung/Kunden.tsx` als Originale
- `src/lib/`: `zusatzauftrag.ts`, `regie.ts` (+ Test), `tarif.ts` (+ Test), `db.ts` (Original)
- `src/ui/Shell.tsx`, `fixtures/tarife_sguv_2026.json`, `CLAUDE.md`, die fünf Regie-Edge-Functions samt
  `_shared/rapport_pdf.ts` und ihrem `README.md`, `supabase/migrations/0016_zeiten_von_bis.sql`

Nur in der Git-Historie (Stand `328ef46`, `git show 328ef46:<pfad>`) stehen die **Originale der geänderten** Dateien
`src/main.tsx`, `src/seiten/Ansicht.tsx`, `src/seiten/StartChef.tsx`, `src/lib/demo.ts` (+ Test),
`src/lib/kennzahlen.ts`, `src/ui/Diagramm.tsx` und `README.md` sowie die Migrationen 0001–0015 (die liegen ohnehin
unverändert in `supabase/migrations/`).

`fixtures/tarife_sguv_2026.json` bleibt zusätzlich im echten `fixtures/` liegen: die Verwaltung liest daraus die
Personalkategorien für die Funktion eines Mitarbeiters (`src/seiten/verwaltung/Mitarbeiter.tsx`), das hat mit Regie
nichts zu tun. Die Kopie hier gehört zu `original/src/lib/tarif.ts`, damit dessen Import stimmt.

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
3. `tarif.ts` (+ Test) zurück nach `src/lib/` — `tarife_sguv_2026.json` liegt schon in `fixtures/`, die Kopie hier
   nicht mitnehmen. Dann die Tarif-Tests laufen lassen (Referenzfall Fr. 955.93).
4. Die Regeln aus dem archivierten `CLAUDE.md` gelten dann wieder: Stand wird abgeleitet, nie geklickt; kein «abgerechnet»
   in der App; Empfängerprüfung serverseitig; Fristen 3 Tage.
