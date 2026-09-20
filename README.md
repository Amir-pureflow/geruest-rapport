# Rapporto

Zeiterfassung und Rapporte für eine Gerüstbaufirma — SORBA wird gefüttert,
nicht ersetzt. Fachkonzept und Bauplan liegen eine Ebene höher
(`../PRODUKTKONZEPT_ZEITERFASSUNG_RAPPORTE_REGIE.md`, `../BAUPLAN_UMSETZUNG.md`).
Arbeitsregeln für Claude Code: `CLAUDE.md`.

**Seit 20.09.2026 ohne Regie und Board** (Bauführer: SORBA macht die Regie). Der Code liegt in
`archiv/regie-und-board/` — für spätere Kunden.

## Setup

```bash
npm install
npm test          # Vitest: Lohn, Zeiten von–bis, Warteschlange, Demo
npm run dev       # http://localhost:3000 (Port 3000 = Supabase-Auth-Standard)
```

Ohne `.env` läuft die App im Offline-Modus — die Erfassung schreibt in die
lokale Warteschlange (IndexedDB), gesendet wird nichts. Für den Sync:

```bash
cp .env.example .env    # Supabase-URL + Anon-Key eintragen
```

## Supabase einrichten (einmalig)

1. Projekt anlegen (Region EU/CH-nah, z. B. `eu-central`).
2. SQL-Editor → Migrationen `supabase/migrations/0001` … `0016` in Reihenfolge ausführen.
3. URL + Anon-Key in `.env`.
4. Baustellen laden: `fixtures/baustellen.beispiel.csv` ist **Beispiel** —
   die echte 217er-Liste von Arbnor im selben Format ablegen als
   `fixtures/baustellen.csv` (nicht eingecheckt, enthält Kundendaten)
   und über Table Editor → Import in `baustelle` laden.
5. Authentication → «Allow anonymous sign-ins» einschalten (Ansichten statt Login).

## Stand — was läuft (20. September 2026)

| Bereich | Stand |
|---|---|
| Ansichten | Bauführer, Sekretariat, Chefmonteur, Monteur — kein Login, Wahl im Gerät |
| Team-Erfassung | Teamgerät: Baustellen-Kacheln, Anwesenheit + Gäste, **Stundenzahl oder Zeiten von–bis** (kein Pausenabzug, Mittag 12–13 als Lücke), Überstunden mit Sprachnotiz, Bemerkung zum Tag, Fotos, offline-Queue |
| Wochenübersicht | Raster Team × Tag, Überstunden gelb mit Notiz, Korrektur mit Grund, Freigabe je Tag / Team / alles ohne Hinweis |
| Tagesübersicht | Wer hat heute gemeldet, wer nicht |
| Export | Bauführer: SORBA-Raster. Sekretariat: Lohn-Excel, Überstunden, je Temporärbüro ein eigenes Excel |
| Verwaltung | Mitarbeitende, Teams mit Chefmonteur, Kunden, Baustellen, Demo |
| Demo-Betrieb | Ein Klick: 75 Mitarbeitende, 20 Teams, 5 Wochen Meldungen mit Überstunden und Notizen (`Verwaltung → Demo`) |
| Sprache | Aufnahme + Text vor dem Speichern (Mistral); 13 Sprachen laut Bauführer noch offen (Whisper/Google/Anthropic-Spike) |
| iPad | Büro-Ansichten mit Bereichsleiste ab iPad hochkant, Seitenleiste ab iPad quer / PC |

## Vor der ersten Vorführung

1. Migrationen bis `0016` im SQL-Editor ausführen
2. `Verwaltung → Demo → Demo-Betrieb laden` — dauert ~20 Sekunden
3. Auf dem Teamgerät `/erfassung` ein Team wählen; auf dem Bauführer-Gerät `/cockpit`

## Hinweise

- **OneDrive:** `node_modules/` liegt im Sync-Ordner. Falls OneDrive beim
  Installieren stört: Ordner von der Synchronisation ausnehmen oder das Repo
  z. B. nach `C:\dev\geruest-rapport` verschieben — Git macht den Umzug trivial.
- **Geklärt (27.08.):** 20 Teams à 2–3 Monteure, je ein Chefmonteur — `/erfassung`
  wird pro Team gebaut. 20 Geräte im Vollausbau, ~4 für Arbnors Pilot.
