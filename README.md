# Gerüst Rapport

Zeiterfassung, Rapporte und Regie für eine Gerüstbaufirma — SORBA wird gefüttert,
nicht ersetzt. Fachkonzept und Bauplan liegen eine Ebene höher
(`../PRODUKTKONZEPT_ZEITERFASSUNG_RAPPORTE_REGIE.md`, `../BAUPLAN_UMSETZUNG.md`).
Arbeitsregeln für Claude Code: `CLAUDE.md`.

## Setup

```bash
npm install
npm test          # Tarifrechner-Tests (Referenzfall Fr. 955.93)
npm run dev       # http://localhost:3000 (Port 3000 = Supabase-Auth-Standard)
```

Ohne `.env` läuft die App im Offline-Modus — die Erfassung schreibt in die
lokale Warteschlange (IndexedDB), gesendet wird nichts. Für den Sync:

```bash
cp .env.example .env    # Supabase-URL + Anon-Key eintragen
```

## Supabase einrichten (einmalig)

1. Projekt anlegen (Region EU/CH-nah, z. B. `eu-central`) — Datenstandort ist
   eine offene Entscheidung im Konzept (Kap. 8.6).
2. SQL-Editor → Inhalt von `supabase/migrations/0001_init.sql` ausführen
   (oder `supabase db push` mit der CLI).
3. URL + Anon-Key in `.env`.
4. Baustellen laden: `fixtures/baustellen.beispiel.csv` ist **Beispiel** —
   die echte 217er-Liste von Arbnor im selben Format ablegen als
   `fixtures/baustellen.csv` (nicht eingecheckt, enthält Kundendaten)
   und über Table Editor → Import in `baustelle` laden.

## Stand — was läuft (September 2026)

| Bereich | Stand |
|---|---|
| Login | Magic Link, kein Passwort |
| Zusatzarbeit (Stufe 1) | Formular in 20 Sek., Tipp-Suche über die 217 Konten, offline-fähig |
| Team-Erfassung (Phase 2) | Teamgerät: Baustellen-Kacheln aus Plan und Historie, Anwesenheit, Stunden-Pfeile, öV/km, Abweichung → «Wer wollte das?» → Sprachnotiz, offline-Queue mit Audio-Upload |
| Wochenübersicht (Phase 3) | Matrix pro Team, benannte Auslöser statt Urteile, Sammelfreigabe, ±30-Min-Korrektur mit Protokoll, Sprachnotiz-Wiedergabe |
| Regierapport (Phase 4) | Aus der gelben Karte → Entwurf → Versand (Resend), fester Betreff, Zustell-Chronik, Frist, Kundenlink ohne Login |
| Export (Phase 5) | SORBA-Rasteransicht (kein Import möglich → sehend tippen), Excel mit Lohn / Temporärbüro / Raster |
| Board | Jahresplan Team × KW, Verschiebungen werden protokolliert |
| Verwaltung | Mitarbeitende, Teams mit Chefmonteur, Kunden mit Bauleitungs-Mail, Baustellen mit Fertigstellungsmeldung |
| Demo-Betrieb | Ein Klick: 75 Mitarbeitende, 20 Teams, 30 Kunden, 5 Wochen Meldungen, Regie in allen Stadien (`Verwaltung → Demo`) |
| Sprache (Phase 6) | Aufnahme + Wiedergabe fertig; Transkription/Übersetzung folgt nach dem Anbieter-Spike |

Tests: `npm test` — Tarifrechner (12) und Demo-Struktur (8).

## Vor der ersten Vorführung

1. Migration `0005_stammdaten.sql` im SQL-Editor ausführen (einmalig)
2. `Verwaltung → Demo → Demo-Betrieb laden` — dauert ~20 Sekunden
3. Auf dem Teamgerät `/erfassung` ein Team wählen; auf dem Bauführer-Gerät `/cockpit`

Kunden-Mails im Demo-Betrieb enden auf `.example` — aus der Demo geht nie eine Mail an fremde Adressen.

## Hinweise

- **OneDrive:** `node_modules/` liegt im Sync-Ordner. Falls OneDrive beim
  Installieren stört: Ordner von der Synchronisation ausnehmen oder das Repo
  z. B. nach `C:\dev\geruest-rapport` verschieben — Git macht den Umzug trivial.
- **Geklärt (27.08.):** 20 Teams à 2–3 Monteure, je ein Chefmonteur — `/erfassung`
  wird pro Team gebaut. 20 Geräte im Vollausbau, ~4 für Arbnors Pilot.
- **Mail-Domain früh einrichten** (SPF/DKIM), DNS braucht Vorlauf.
