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

## Was in Phase 0 schon läuft

- Tarifrechner mit Tests: SGUV 2026/27 aus `fixtures/`, Rappen-Integer,
  Referenzfall «Gerüst versetzen» = Fr. 955.93
- Offline-Queue: grüner Knopf unter `/erfassung` schreibt in IndexedDB,
  Auto-Flush bei Netz-Rückkehr (Upsert auf `client_uuid`, doppelt senden ist harmlos)
- PWA-Grundgerüst (installierbar; Icons fehlen noch), drei Routen als Platzhalter
- Vollständiges DB-Schema mit RLS (Übergangs-Policies, siehe TODO in der Migration)

## Nächste Schritte (Bauplan §5)

1. ~~Phase 1 — Zusatzauftrag~~ ✅ gebaut (02.09.): Magic-Link-Login, Formular mit Suche über die echten 217 Konten, Offline-Queue, Liste mit Status offen→ausgeführt→abgerechnet.
2. Phase 2 — Erfassung mit Vorbelegung, Abweichungsfluss, Audio
3. Phase 3 — Wochenübersicht mit Prüfquellen und Freigabe
4. Phase 4 — Regie-Ausgang: Mail (Resend/Postmark + Webhooks), Frist, Kundenlink
5. Phase 5 — Export: SORBA-Rasteransicht + CSV/Excel
6. Phase 6 — Sprache (erst nach dem Spike mit echten Aufnahmen de/ar/pl/en)

## Hinweise

- **OneDrive:** `node_modules/` liegt im Sync-Ordner. Falls OneDrive beim
  Installieren stört: Ordner von der Synchronisation ausnehmen oder das Repo
  z. B. nach `C:\dev\geruest-rapport` verschieben — Git macht den Umzug trivial.
- **Geklärt (27.08.):** 20 Teams à 2–3 Monteure, je ein Chefmonteur — `/erfassung`
  wird pro Team gebaut. 20 Geräte im Vollausbau, ~4 für Arbnors Pilot.
- **Mail-Domain früh einrichten** (SPF/DKIM), DNS braucht Vorlauf.
