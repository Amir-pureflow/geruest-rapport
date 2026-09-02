# Gerüst Rapport — Zeiterfassung, Rapporte und Regie

Digitales Erfassungswerkzeug für eine Gerüstbaufirma im Raum Bern.
45 Festangestellte + ~30 Temporäre in der Hochsaison, 217 aktive Baustellen.
5 Bauführer. 20 Teams à 2–3 Monteure mit je einem Chefmonteur (Telefonat 27.08.2026).
SORBA wird **gefüttert, nicht ersetzt** — der verbindliche Regierapport und die
Rechnung entstehen weiterhin dort.

Kontext-Dokumente (eine Ebene höher):
- `../PRODUKTKONZEPT_ZEITERFASSUNG_RAPPORTE_REGIE.md` — Fachkonzept
- `../BAUPLAN_UMSETZUNG.md` — Phasen, Integrationen, Datenmodell

## Stack & Befehle

- Vite + React 19 + TypeScript, PWA (vite-plugin-pwa), Tailwind v4
- Dexie (IndexedDB) für die Offline-Warteschlange
- Supabase: Postgres + RLS, Auth, Storage, Edge Functions
- n8n: Fristen-Cron, Erinnerungen, Exportjobs
- Resend/Postmark: Mailversand mit Zustell-Webhooks (Entscheid offen)
- Transkription hinter Adapter (Anbieter offen, Spike ausstehend)

```
npm run dev     # Dev-Server
npm test        # Vitest, einmalig
npm run build   # Typecheck + Produktionsbuild
```

## Sprache

Schweizer Hochdeutsch, **«ss» statt «ß»**. UI-Texte für Monteure: kurze Sätze,
keine Fachsprache, keine Anglizismen. Gesprochene Eingabe kann Deutsch, Arabisch,
Polnisch oder Englisch sein (pro Person hinterlegt, nie geraten) — die Ausgabe
ist immer Deutsch. **Kein Dialekt-Thema: es geht um Hochdeutsch + Fremdsprachen.**

## Glossar — verbindlich, nicht umbenennen

- **Wochenrapport**: das Papierblatt des Monteurs. Spalten: Tag, Konto-Nr.,
  Strasse/Hausnummer/Ort, öV, KM, Normal Std, Überstunden, Total Std.
  Mo–So, mehrere Zeilen pro Tag. **Enthält keine Tätigkeit.**
- **Konto-Nr.**: sechsstellige Baustellennummer, z. B. 903673.
- **Regie**: Zusatzarbeit nach Aufwand, SGUV-Tarif, Kunde zeichnet gegen.
- **Zusatzauftrag**: vom Bauführer erfasste Kundenbestellung — der Auslöser
  für Regie, erfasst *bevor* gearbeitet wird.
- **Bauführer**: leitet, kontrolliert, schreibt Rapporte und Regierapporte
  in SORBA. **Es gibt keinen Polier** — der Bauführer ist der Polier.
- **Team**: 20 Teams à 2–3 Monteure, je ein **Chefmonteur** — Arbnors Wort, nicht
  «Kolonne», nicht «Polier». Ein Teamgerät meldet für alle; mehrere Teams pro
  Baustelle sind möglich.
- **Tagesmeldung**: die Meldung des Teams am Tagesende (1 Knopf oder Abweichung).
- **SGUV**: Verband; dessen Regie-Tarife sind vertraglich verbindlich.
- **Board**: Whiteboard im Büro, Jahres-/Terminplanung (keine Tagesdisposition!).
- **Bausitzungsprotokoll**: wöchentliches Protokoll des Kunden; enthält «ab und zu»
  Regie — zweite Quelle für Zusatzaufträge (Ausbaustufe, Phase 7).

## Harte Regeln

1. Das System behauptet **nie**, dass Stunden korrekt sind. Es vergleicht gegen
   benannte Quellen und zeigt Abweichungen. Formulierungen wie «unplausibel»
   oder «falsch» sind in UI-Texten verboten — stattdessen: «weicht ab von X».
2. Keine Freitext-Tastatureingabe in der Monteur-/Team-Erfassung. Nirgends.
3. Keine Auswahlliste mit mehr als 5 Einträgen in der Erfassung.
4. **Offline zuerst**: Jede Erfassungsfunktion muss ohne Netz vollständig
   funktionieren. Schreiben geht immer in die Dexie-Queue, nie direkt ins Netz.
5. Sync ist idempotent: jede Meldung hat eine clientseitige `client_uuid`,
   der Server macht Upsert mit `on conflict (client_uuid) do nothing`.
6. **Geldbeträge in Rappen als Integer. Zeit in Minuten als Integer.**
   Nie Franken-Floats, nie Dezimalstunden im Datenmodell. Formatierung
   ausschliesslich über `formatChf()` bei der Ausgabe.
7. Jede Änderung an Stunden wird protokolliert: wer, wann, von, auf, warum
   (`freigabe_log`).
8. Audio und Fotos werden nie gelöscht, solange der Vorgang offen ist — sie sind
   der Beleg (der Bauführer verlangt heute schon Bilder bei Regie). Transkript
   ist Arbeitshilfe, nicht Ersatz.
9. Sprachcode kommt aus dem Mitarbeiterprofil (`sprache`), wird nie automatisch
   pro Aufnahme geraten.

## Nicht bauen

- SORBA ersetzen oder in SORBA schreiben (kein DB-Write, keine UI-Automation)
- Automatische Freigabe «plausibler» Stunden
- Mitarbeiter-Scoring oder -Bewertung
- Laufende Standortverfolgung (GPS nur punktuell, freiwillig, optional)
- Automatische Kürzung von Stunden
- Eigenes Backend-Framework, native Apps, Microservices

## Arbeitsweise

- **Vertikal schneiden**: ein Durchstich pro Feature (UI → Queue → DB → Anzeige),
  nicht «erst alle Tabellen, dann alle Screens».
- **Fixtures sind die Wahrheit**: `fixtures/tarife_sguv_2026.json` und die
  Baustellenliste. Keine erfundenen Testdaten mit `test@example.com`.
- **Geld-Logik nur mit Tests**: `src/lib/tarif.ts` und später `regie-regeln`
  werden nie ohne begleitende Vitest-Fälle geändert. Referenzfall: der
  Modellfall «Gerüst versetzen» = Fr. 955.93 (siehe tarif.test.ts).
- Ein Feature, ein Commit.

## Dateikarte

```
src/seiten/Erfassung.tsx      Teamgerät: Knopf, Symbole, «Wer wollte das?»
src/seiten/Cockpit.tsx        Bauführer: Wochenübersicht, Ampel, Freigabe
src/seiten/Bestaetigung.tsx   Kundenlink /b/:token — ohne Login
src/lib/db.ts                 Dexie-Schema + Offline-Queue + Flush
src/lib/tarif.ts              SGUV-Tarifrechner (Rappen-Integer) + Tests
src/lib/supabase.ts           Client (null-sicher, wenn .env fehlt)
fixtures/                     Tarife (echt) + Baustellen (Beispiel, ersetzen!)
supabase/migrations/          Schema; RLS-Policies folgen als eigene Migration
```

## Offene Entscheidungen (nicht raten — nachfragen oder Annahme markieren)

- Transkriptions-Anbieter (Spike mit echten Aufnahmen de/ar/pl/en ausstehend)
- Mailanbieter + Absender-Domain (SPF/DKIM)
- SORBA hat **keinen Import** (Arbnor, 27.08.) — die Rasteransicht ist der Endzustand,
  kein SORBA-spezifischer Exportcode nötig. Offen: woher kommt der Vorgangscode?
- Tariffragen: Demontage-Anteil 50 % beim «Versetzen»; Materialmiete 9 %
  auf Kurzeinsätze
- Business-Case-Zahl (Regierapporte/Monat) wird im Pilot gemessen — «unterschiedlich»
  laut Arbnor; nicht erfragen. Budgetfrage erst nach dem Pilot.
