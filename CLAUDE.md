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

## Zusatzauftrag: Stand wird abgeleitet, nie geklickt (06.09.)

Gespeichert wird nur `offen` oder `erledigt_ohne_regie` (Pflichtgrund + wer + wann).
Die Sicht `zusatzauftrag_stand` leitet ab: bestellt → gemeldet (Team-Abweichung auf der
Baustelle) → im Regierapport → beim Kunden → bestätigt. **Kein «abgerechnet» in der App** —
die Rechnung entsteht in SORBA, das kann die App nicht wissen. Listen und Zähler lesen
die Sicht, nicht die Tabelle.

## Ansichten statt Login (09.09.)

Beim Start wählt man «Welche Ansicht?»: **Bauführer, Chefmonteur, Monteur, Sekretariat, Kunde**.
Kein Login. Die Wahl liegt im Gerät (`localStorage.ansicht`, `src/lib/ansicht.ts`), die Seiten je
Ansicht stehen in `SEITEN`. Die Datenbank bekommt im Hintergrund eine **anonyme Sitzung**
(`signInAnonymously` in `main.tsx`), damit die bestehenden RLS-Policies («authenticated») greifen —
dafür muss im Supabase-Dashboard «Allow anonymous sign-ins» an sein.
**Folge:** Rechte werden in der Oberfläche gesteuert, nicht auf dem Server. Wer die Adresse kennt,
kann alles sehen. Für echte Kundendaten muss ein Login zurück (Magic Link stand bis 09.09. in
`Anmelden.tsx`, siehe Git-Historie).

## Ansichten statt Login (09.09.) und Rechte

Beim Start wählt man die Ansicht (Bauführer, Chefmonteur, Monteur, Sekretariat, Kunde), kein Login.
Die Datenverbindung läuft über eine anonyme Supabase-Sitzung (main.tsx). Ohne Sitzung zeigt die App
den Grund (Ansicht.tsx), nie leere Listen. Rechte sind damit nur in der Oberfläche — vor echten
Kundendaten kommt ein Login pro Rolle zurück (Prüfbericht 09.09., Paket 4). Anonyme Anmeldungen
sind auf 30/Stunde/IP begrenzt: Test-Screenshots mit festem Chrome-Profil machen, nicht mit frischem.

Korrekturen in der Wochenübersicht brauchen einen Grund aus vier Vorgaben (Regel #7 «warum») und
laufen über die RPCs aus 0009; fehlt die Migration, fällt der Code auf den zweistufigen Weg zurück.
Farben: Rot nur für Aktion, Auswahl Stahlblau (`chip-on`), Warnung Bernstein (`amber`).

## Mehrkostenanzeige (12.09.)

Bausitzungsprotokoll HPAG 7.1: «Mehrkosten ohne vorzeitige und schriftliche Anzeige werden nicht entschädigt.»
Darum hat der Zusatzauftrag den Knopf «Bauleitung informieren» (Edge Function `mehrkosten-anzeigen`, Mail an
kunde.email, Vermerk `angezeigt_am/an/text`). Pro Kunde einstellbar: `kunde.anzeige_noetig` (Standard ja) und
`kunde.frist_tage` (Frist für die Gegenzeichnung, Standard 3; die Sendefunktion liest sie). Migration 0011.

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
src/seiten/Ansicht.tsx            Erste Seite: Welche Ansicht? (fünf Knöpfe, kein Login)
src/seiten/Start.tsx              Verteiler je Ansicht; Bauführer-Dashboard mit Kennzahlen
src/seiten/StartChef.tsx          Chefmonteur: Team, heute, laufende Woche, vom Kunden bestellt
src/seiten/StartMonteur.tsx       Monteur: «Meine Woche» — eigene Stunden, nur lesen
src/seiten/StartSekretariat.tsx   Sekretariat: Anruf festhalten, Regie im Blick, Export, Stammdaten
src/seiten/StartKunde.tsx         Kunde: verschickte Rapporte mit Kundenlink (/b/<token>)
src/lib/ansicht.ts                Ansicht lesen/setzen, Seiten je Ansicht
src/ui/Karten.tsx                 NavKarte, Kachel, MONATE — gemeinsam für alle Startseiten
src/seiten/Zusatzauftrag.tsx      Stufe 1: Kundenbestellung in 20 Sek. (offline)
src/seiten/Tag.tsx                Tagesübersicht: welche Teams haben gemeldet, welche nicht (Ziel der Start-Kachel)
src/seiten/Erfassung.tsx          Teamgerät: Kacheln, Anwesenheit, Pfeile, Symbole, Sprachnotiz
src/seiten/Cockpit.tsx            Wochenübersicht: Teamzeilen mit Wochenampel → Personen, Freigabe, Korrektur, Regieverdacht (Sekretariat: nur ansehen)
src/seiten/RegieVorschau.tsx      Vorschau aus der Meldung — gespeichert wird erst auf «Als Entwurf speichern»
src/seiten/RegieListe/Detail.tsx  Regierapporte: Positionen, Anhang, Versand, Chronik, Entwurf verwerfen
src/seiten/Auswertung.tsx         Regie pro Baustelle/Kunde/Monat aus Sicht regie_auswertung (0009), CSV
src/lib/regie.ts                  Positionen aus Zeiteinträgen, Rapport anlegen (nie doppelt pro Meldung)
src/seiten/Export.tsx             SORBA-Raster + Excel (Lohn, Temporärbüro)
src/seiten/Board.tsx              Jahresplan Team × KW, Verschiebungen → planaenderung
src/seiten/verwaltung/*           Mitarbeitende, Teams, Kunden, Baustellen, Demo
src/seiten/Bestaetigung.tsx       Kundenlink /b/:token — ohne Login (Edge Function)
src/lib/db.ts                     Dexie-Queue: Meldungen + Zeiteinträge + Audio, Zusatzaufträge
src/lib/tarif.ts                  SGUV-Tarifrechner (Rappen-Integer) + Tests
src/lib/lohn.ts                   Lohn-/Temporärbüro-/Überstunden-Aggregation (reine Funktionen) + Tests
src/lib/demo.ts                   Deterministischer Demo-Betrieb + Tests
src/lib/datum.ts                  Wochen-/Datumshelfer
src/lib/foto.ts                   Fotos verkleinern (1600 px, JPEG) vor Queue/Upload
src/ui/FotoGalerie.tsx            Vorschau aus dem Bucket «anhaenge» (signierte Links)
src/ui/Sprachnotiz.tsx            Pegelbalken während der Aufnahme (Web Audio), Text-Enthüllung nach dem Speichern (fragt transkript ab)
src/ui/Shell.tsx                  Rahmen: Büro-Ansichten (Bauführer, Sekretariat) am PC mit Seitenleiste ab «lg», Baustellen-Ansichten bleiben Handy-Spalte; `schmal` für Formulare
supabase/functions/beschrieb-vorschlagen  Leistungsbeschrieb (Text für SORBA/Kunde) aus Sprachnotiz + Positionen vorschlagen — Mistral, nie ungeprüft gespeichert
supabase/migrations/              0001 Schema · 0002 Bezeichnung · 0003 Auftrag-UUID · 0004 Versand · 0005 Stammdaten · 0006 Auftrag-Stand (Sicht) · 0007 Rapport-Ursprung · 0008 Fotos · 0009 Verbesserungen (Sichten, RPCs, Nummern, Fristen) · 0010 Beschrieb · 0009 Verbesserungen (Indizes, RPCs zeit_freigeben/zeit_korrigieren/zeit_team_setzen/regierapport_anlegen, Nummer RR-JJJJ-NNNN, Sichten regie_kennzahlen/regie_auswertung, Fristen-Job, Storage ohne Delete)
```

Edge Functions `regierapport-senden` und `bestaetigung`: Quellcode in `supabase/functions/` (seit 07.09.),
Deploy via Supabase-MCP oder CLI — siehe `supabase/functions/README.md`.

## Offene Entscheidungen (nicht raten — nachfragen oder Annahme markieren)

- Transkriptions-Anbieter (Spike mit echten Aufnahmen de/ar/pl/en ausstehend)
- Mail: **entschieden (03.09.)** — Resend, Absender pureflow-ai.com für den Pilot
  (DNS via Vercel); vor echten Bauleitungs-Mails Wechsel auf die Domain der
  Gerüstfirma (Arbnor = IT, zwei DNS-Einträge).
- SORBA hat **keinen Import** (Arbnor, 27.08.) — die Rasteransicht ist der Endzustand,
  kein SORBA-spezifischer Exportcode nötig. Offen: woher kommt der Vorgangscode?
- Tariffragen: Demontage-Anteil 50 % beim «Versetzen»; Materialmiete 9 %
  auf Kurzeinsätze
- Business-Case-Zahl (Regierapporte/Monat) wird im Pilot gemessen — «unterschiedlich»
  laut Arbnor; nicht erfragen. Budgetfrage erst nach dem Pilot.
