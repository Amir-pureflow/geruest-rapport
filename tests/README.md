# Prüfumgebung Rapporto (Branch `pruefung`)

Alles hier läuft **nur auf dem eigenen Rechner**. Die Tests können nicht gegen die echte Datenbank oder die Live-App
laufen, und es gehen keine Aufrufe an bezahlte Dienste (Azure, Mistral, Resend) hinaus.

## Warum es nicht aus Versehen live schreiben kann

- `tests/vitest.config.ts` liest die Adresse aus `tests/umgebung/.env.test` (lokal), **nie** die echte `.env`.
- `tests/sperre.ts` läuft vor jedem Test: Ist eine nicht-lokale Supabase-Adresse gesetzt, bricht der ganze Lauf ab.
  Jede Netzanfrage an einen anderen Rechner als `127.0.0.1` scheitert mit «GESPERRT».
- Die Browser-Skripte blockieren jede nicht-lokale Anfrage. Eine Anfrage an `*.supabase.co` oder `*.vercel.app`
  beendet das Skript sofort.
- Die lokale Supabase (`tests/lokal`) ist mit keinem Cloud-Projekt verbunden. `vorbereiten.sh` bricht ab, falls doch.

## Einmal einrichten

Voraussetzungen: Node, Python mit Playwright (`pip install playwright && playwright install chromium`), Docker Desktop.

```bash
bash tests/lokal/vorbereiten.sh                          # Migrationen + Functions in die lokale Kopie
npx supabase@2 start --workdir tests/lokal               # lokale Datenbank (beim ersten Mal ~2–3 GB Download)
```

## Prüfen

```bash
# 1) Rechnen (ohne Datenbank) + Firmen-Trennung, Kunden-Link, Geräte/Funkloch (mit lokaler Datenbank)
npx supabase@2 functions serve --workdir tests/lokal     # in einem zweiten Fenster laufen lassen
npx vitest run --config tests/vitest.config.ts

# 2) Browser: App gegen die lokale Datenbank starten (drittes Fenster) …
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<ANON aus tests/umgebung/.env.test> npx vite --port 3000 --strictPort --host 127.0.0.1
# … dann
node tests/lokal/testdaten.mjs && python tests/browser/rundgang.py
node tests/lokal/testdaten.mjs && python tests/browser/ablaeufe.py
node tests/lokal/testdaten.mjs && python tests/browser/freigabe_verwaltung.py
```

Bildschirmfotos und Ergebnisse landen in `C:\Users\El Dragon\Render-Cache\Rapporto Pruefung\` (nicht in OneDrive).

## Aufräumen

```bash
npx supabase@2 stop --workdir tests/lokal
```

## Was wo geprüft wird

| Datei | Was |
|---|---|
| `einheit/stunden.test.ts` | Stunden, Pause, Mittag, zwei Baustellen, Normal/Überstunden — von Hand nachgerechnet |
| `einheit/regie.test.ts` | Tarif, Positionen, Lieferwagen, Etappe, Materialmiete, Total; PDF mit dem echten Baustein |
| `einheit/lohn_excel.test.ts` | Lohn je Woche, Abwesenheiten, Überstunden, Temporärbüro, Excel wieder eingelesen |
| `einheit/sperre.test.ts` | Die Sperre selbst |
| `rls/firmen.test.ts` | Firma A sieht/ändert nichts von Firma B (jede Tabelle, jede Rolle, Speicher) |
| `rls/kundenlink.test.ts` | Kunden-Link: was er zeigt, was der Kunde tun kann; PDF-Function |
| `rls/geraete.test.ts` | Funkloch, App schliessen, zwei Geräte gleichzeitig (echte Warteschlange der App) |
| `browser/*.py` | Rundgang je Rolle auf 360/390/1366 px; Tag melden, Kunde bestätigt, Excel, Freigabe, Verwaltung |

**«BEKANNTER FEHLER»-Tests** (`it.fails`) beschreiben, wie es richtig wäre, und schlagen heute fehl — darum sind sie
grün. Wird ein Fehler behoben, wird der Test rot: dann `.fails` entfernen.

Testdaten sind erfunden («Testbau A AG», «Testbau B AG»). Nie echte Kundendaten hierher kopieren.
