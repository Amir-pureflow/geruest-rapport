# Rapporto (Arbeitstitel bis 15.09.: Gerüst Rapport) — Zeiterfassung und Rapporte

Digitales Erfassungswerkzeug für eine Gerüstbaufirma im Raum Bern.
45 Festangestellte + ~30 Temporäre in der Hochsaison, 217 aktive Baustellen.
5 Bauführer. 20 Teams à 2–3 Monteure mit je einem Chefmonteur (Telefonat 27.08.2026).
SORBA wird **gefüttert, nicht ersetzt** — Regierapport und Rechnung entstehen dort.

**Seit 20.09.2026 ohne Regie und Board.** Der Bauführer (Demo durch Erin): «Regierapporte und alles, was damit zu tun
hat, brauche ich in der App nicht — SORBA macht das, das wäre doppelte Arbeit.» Zusatzauftrag, Regierapporte, Auswertung,
Kundenlink, Ansicht «Kunde», Tarifrechner, Board sind raus. Der Code liegt in `archiv/regie-und-board/` (README dort) —
für spätere Kunden. **Nicht wieder einbauen, ohne dass Amir es sagt.**

Kontext-Dokumente (eine Ebene höher):
- `../PRODUKTKONZEPT_ZEITERFASSUNG_RAPPORTE_REGIE.md` — Fachkonzept (Regie-Teile historisch)
- `../BAUPLAN_UMSETZUNG.md` — Phasen, Integrationen, Datenmodell
- `../Feedback_Bauführer_Prototyp.docx` — elf Punkte vom 20.09.

## Stack & Befehle

- Vite + React 19 + TypeScript, PWA (vite-plugin-pwa), Tailwind v4
- Dexie (IndexedDB) für die Offline-Warteschlange
- Supabase: Postgres + RLS, Auth (anonym), Storage, Edge Function `transkribieren`
- Transkription: Mistral (Voxtral) hinter Adapter — Anbieter-Spike für 13 Sprachen ausstehend

```
npm run dev     # Dev-Server
npm test        # Vitest, einmalig
npm run build   # Typecheck + Produktionsbuild
```

## Sprache

Schweizer Hochdeutsch, **«ss» statt «ß»**. UI-Texte für Monteure: kurze Sätze,
keine Fachsprache, keine Anglizismen. Gesprochene Eingabe kann in vielen Sprachen sein (pro Person hinterlegt, nie
geraten) — die Ausgabe ist immer Deutsch. **Kein Dialekt-Thema: es geht um Hochdeutsch + Fremdsprachen.**

## Glossar — verbindlich, nicht umbenennen

- **Wochenrapport**: das Papierblatt des Monteurs. Spalten: Tag, Konto-Nr.,
  Strasse/Hausnummer/Ort, KM, Normal Std, Überstunden, Total Std. Mo–So, mehrere Zeilen pro Tag.
- **Konto-Nr.**: sechsstellige Baustellennummer, z. B. 903673.
- **Bauführer**: leitet, kontrolliert, gibt Stunden frei, tippt sie in SORBA. **Es gibt keinen Polier.**
- **Team**: 20 Teams à 2–3 Monteure, je ein **Chefmonteur** — Arbnors Wort, nicht «Kolonne».
  Ein Teamgerät meldet für alle; mehrere Teams pro Baustelle sind möglich.
- **Tagesmeldung**: die Meldung des Teams am Tagesende (ein Knopf).
- **Gast**: Person, die heute mithilft, aber nicht fest zum Team gehört (20.09.).
- **Bemerkung zum Tag**: die Sprachnotiz an der Tagesmeldung — immer möglich, bei Überstunden Pflicht (20.09.).
- **Regie / Zusatzauftrag / Board**: gibt es in der App nicht mehr (siehe oben). Die Wörter tauchen nur noch in
  Kommentaren zu alten Daten (`abweichung_typ`) auf.

## Harte Regeln

1. Das System behauptet **nie**, dass Stunden korrekt sind. Es zeigt, was das Team gemeldet hat.
   Formulierungen wie «unplausibel» oder «falsch» sind in UI-Texten verboten — stattdessen: «Team meldet X».
2. Keine Freitext-Tastatureingabe in der Monteur-/Team-Erfassung. Nirgends. (Chefmonteur-Ausnahmen: Konto-Nr. als
   Ziffern, Name eines Gastes ab 2 Buchstaben — beides wählt aus einer Liste.)
3. Keine Auswahlliste mit mehr als 5 Einträgen in der Erfassung.
4. **Offline zuerst**: Jede Erfassungsfunktion muss ohne Netz vollständig
   funktionieren. Schreiben geht immer in die Dexie-Queue, nie direkt ins Netz.
5. Sync ist idempotent: jede Meldung hat eine clientseitige `client_uuid`,
   der Server macht Upsert mit `on conflict (client_uuid) do nothing`.
6. **Zeit in Minuten als Integer.** Nie Dezimalstunden im Datenmodell. Uhrzeiten als Minuten seit Mitternacht.
7. Jede Änderung an Stunden wird protokolliert: wer, wann, von, auf, warum (`freigabe_log`).
8. Audio und Fotos werden nie gelöscht — sie sind der Beleg. Transkript ist Arbeitshilfe, nicht Ersatz.
9. Sprachcode kommt aus dem Mitarbeiterprofil (`sprache`), wird nie automatisch pro Aufnahme geraten.
10. **Die App rechnet keine Pausen** (20.09.). Sie zählt, was eingetragen ist — kein stiller Abzug, kein Zuschlag.

## Ansichten statt Login (09.09.) und Rechte

Beim Start wählt man die Ansicht: **Bauführer, Sekretariat, Chefmonteur, Monteur**. Kein Login. Die Wahl liegt im
Gerät (`localStorage.ansicht`, `src/lib/ansicht.ts`), die Seiten je Ansicht stehen in `SEITEN`. Die Datenbank bekommt
eine **anonyme Sitzung** (`signInAnonymously` in `main.tsx`) — im Supabase-Dashboard muss «Allow anonymous sign-ins» an
sein; Limit 30/Stunde/IP (Test-Screenshots mit festem Chrome-Profil).
**Rechte sind nur in der Oberfläche.** Wer die Adresse kennt, kann alles sehen. Vor echten Kundendaten kommt ein Login
pro Rolle zurück (Magic Link stand bis 09.09. in `Anmelden.tsx`, Git-Historie).
- Bauführer: Tagesübersicht, Wochenübersicht (freigeben, korrigieren), SORBA-Raster, Verwaltung, Erfassung (Test).
- Sekretariat (17.09.): Übersicht Stunden je Mitarbeiter, Export (Lohn, Überstunden, Temporärbüros), Verwaltung —
  nur ansehen im Cockpit. **Lohn sieht nur das Sekretariat** (Bauführer 20.09.: «kein Zugriff hier drauf»).

Korrekturen in der Wochenübersicht brauchen einen Grund aus vier Vorgaben (Regel #7) und laufen über die RPCs aus 0009;
fehlt die Migration, fällt der Code auf den zweistufigen Weg zurück.
Farben: Rot nur für Aktion, Auswahl Stahlblau (`chip-on`), Warnung Bernstein (`amber`).

## Erfassung: nur Zeiten von–bis (16.09., 20.09., seit 20.09. abends ohne Stundenzahl)

**Es gibt nur noch Zeiten von–bis** (Amir 20.09.: «nimm die Stundenzahl weg, nur Zeiten eingeben»). Der Umschalter
«Stundenzahl | von – bis», die zwei Team-Regler und die Normal/Überstunden-Felder je Person sind raus — **nicht wieder
einbauen, ohne dass Amir es sagt**. Getippt wird nur, wann gearbeitet wurde; Normal und Überstunden rechnet die App
daraus.

Ein Zeit-Block fürs ganze Team oben setzt alle gleich, die Zeile je Person kann abweichen. Bis zu zwei Spannen
(Vormittag, Nachmittag), native Uhrzeit-Wahl, Vorgabe **7:00–12:00 und 13:00–offen** — der Mittag 12–13 ist unbezahlt
(Amir 20.09., «denke ich» — mit Arbnor bestätigen) und darum als Lücke vorgegeben, **nie abgezogen**. Das «bis» des
Nachmittags ist bewusst offen: ohne «bis» lässt sich nicht speichern, damit niemand eine geratene Zeit bestätigt;
überlappende Spannen auch nicht. Zählt der Mittag mit, sagt es ein Hinweis (kein Abzug).

Summe → **Normal** (bis 8.4 h = `NORMALTAG_MIN`) + **Überstunden**, gespeichert wie bisher in
`zeiteintrag.normal_min` / `ueber_min`; dazu immer die Spalten `zeiteintrag.von_min/bis_min/von2_min/bis2_min`
(Migration 0016). Cockpit und «Meine Woche» zeigen sie. Alte Meldungen ohne Zeiten bleiben gültig und werden weiter
angezeigt. Jede Meldung ist `normalfall = true`; `abweichung_typ` / `wer_hats_gewollt` bleiben nur für alte Daten.
Logik + Tests in `src/lib/zeiten.ts`. Arbeitszeit laut Bauführer 7:00–17:00; bezahlte Pause 9:00–9:30 freiwillig
(kein Thema für die App).
**Offen mit Arbnor:** Mittag wirklich 12–13 und unbezahlt? Weitere Pausen? Trägt der Chefmonteur für alle ein?

**Überstunden** brauchen ein Warum: die **Sprachnotiz** (Pflicht, ausser das Mikrofon fehlt). Seit 20.09. ist sie immer
da — als **Bemerkung zum Tag**, freiwillig. Der Bauführer sieht Überstunden gelb in der Wochenübersicht, liest die Notiz,
gibt frei. Ob etwas dem Kunden verrechnet wird, entscheidet er in SORBA — die App fragt das nicht.

**Gäste** (20.09.): «Person hinzufügen» — aus der Mitarbeiterliste, Name ab 2 Buchstaben, max. 5 Treffer, dazu
«Zuletzt dabei» je Team (`localStorage teamgeraet-gaeste-<teamId>`). Gäste landen nur im `zeiteintrag`, nicht in
`team_mitglied`.

**Nur Auto** (20.09.): `OEV_AKTIV = false` in Erfassung.tsx — öV-Chip ausgeblendet, `oev` bleibt im Datenmodell.
Ob öV ganz weg soll: klären, dann Spalte und `oev_standard` aufräumen.

## Sprachnotiz: Text vor dem Speichern (15.09.)

Nach der Aufnahme schickt die Erfassung das Audio an `transkribieren` (Weg «Vorschau», `audio_base64` + `team_id`),
zeigt den Text, der Chefmonteur prüft/korrigiert ihn und speichert dann (`transkript/transkript_quelle/transkript_sprache`
in der Warteschlange). `db.ts` stösst die nachträgliche Transkription nur an, wenn kein Text mitkam. Die Aufnahme bleibt
der Beleg (Regel #8). Cockpit: Notizen ohne Überstunden erscheinen als Karte «Bemerkung zum Tag».

## Export (20.09.)

Bauführer sieht unter `/export` nur das SORBA-Raster (Nav «SORBA-Raster»). Sekretariat: dazu Lohnstunden, Überstunden
(Zeitraum + seit Jahresbeginn) und **je Temporärbüro ein eigenes Excel** mit nur dessen Leuten (`excelBuero`, Datei
`Temporaer_<Büro>_<Zeitraum>.xlsx`) — die Datei, die ans Büro geht. `lohnSichtbar` in Export.tsx.

Das Excel baut `src/lib/excel.ts` mit **ExcelJS** (Amir 20.09.: «schöner vom Design und Layout her»): Titel + Untertitel
(Zeitraum, Team, Filter, Stand) auf jedem Blatt, dunkle Kopfzeile, Zebrastreifen, Summenzeilen als echte SUM-Formeln,
fixierte Kopfzeile, Autofilter, Querformat auf eine Seitenbreite. Stunden exakt (min/60, Format 0.00), nicht gerundet.
Temporärbüro-Blatt: nach Person gruppiert mit Zwischensumme, darunter «Summe je Person» und Total. SORBA-Raster mit
senkrechten Personennamen und Totalspalte. ExcelJS (~1 MB) wird per dynamischem Import erst beim Klick geladen. SheetJS
(`xlsx`) ist raus — die freie Ausgabe kann keine Formatierung schreiben.

## iPad (20.09.)

Büro-Ansichten: ab `md` (iPad hochkant) quer scrollbare Bereichsleiste unter der Kopfzeile und breitere Spalte
(`md:max-w-3xl`); ab `lg` (iPad quer, PC) Seitenleiste. Kacheln/Diagramm/Team-Board ab `md`; Handy-Karten der Startseite
nur unter `md`.

## Offen: Sprachen (Bauführer 20.09., Punkt A)

Dreizehn Sprachen statt vier: Albanisch, Italienisch, Serbokroatisch, Portugiesisch, Spanisch, Polnisch, Ungarisch,
Mazedonisch, Arabisch, Türkisch, Englisch, Griechisch + Deutsch. `mitarbeiter.sprache` und `tagesmeldung.transkript_sprache`
kennen heute nur de/ar/pl/en (Check-Constraint). Kommt mit dem Transkriptions-Spike (Whisper / Google / Anthropic) —
**bewusst noch nicht gebaut.**

## Nicht bauen

- SORBA ersetzen oder in SORBA schreiben (kein DB-Write, keine UI-Automation)
- Regie, Zusatzaufträge, Kundenlink, Board — entfernt 20.09., liegt im Archiv
- Stundenzahl als Eingabe in der Erfassung — seit 20.09. abends gibt es nur Zeiten von–bis
- Automatische Freigabe «plausibler» Stunden
- Mitarbeiter-Scoring oder -Bewertung
- Laufende Standortverfolgung (GPS nur punktuell, freiwillig, optional)
- Automatische Kürzung von Stunden, automatischer Pausenabzug
- Eigenes Backend-Framework, native Apps, Microservices

## Arbeitsweise

- **Vertikal schneiden**: ein Durchstich pro Feature (UI → Queue → DB → Anzeige).
- **Fixtures sind die Wahrheit**: die Baustellenliste. Keine erfundenen Testdaten mit `test@example.com`.
- **Rechenlogik nur mit Tests**: `src/lib/lohn.ts`, `src/lib/zeiten.ts` werden nie ohne Vitest-Fälle geändert.
- Ein Feature, ein Commit.
- Auf Amirs PC (bayan) gibt es weder Node noch git: Typecheck/Tests laufen dort nicht — vor dem Push auf einem Gerät
  mit Node `npm run build` und `npm test` ausführen.

## Dateikarte

```
src/seiten/Ansicht.tsx            Erste Seite: Welche Ansicht? (vier Knöpfe, kein Login)
src/seiten/Start.tsx              Verteiler je Ansicht; Bauführer-Dashboard: Teams heute, Vorwoche zu prüfen, Überstunden offen, Diagramm, Team-Board
src/seiten/StartChef.tsx          Chefmonteur: Team, heute, laufende Woche
src/seiten/StartMonteur.tsx       Monteur: «Meine Woche» — eigene Stunden (mit Zeiten), nur lesen
src/seiten/StartSekretariat.tsx   Sekretariat: Stunden je Mitarbeiter, Temporärbüros, Export, Verwaltung
src/lib/ansicht.ts                Ansicht lesen/setzen, Seiten je Ansicht
src/ui/Karten.tsx                 NavKarte, Kachel, MONATE — gemeinsam für alle Startseiten
src/seiten/Tag.tsx                Tagesübersicht: welche Teams haben gemeldet, welche nicht
src/seiten/Erfassung.tsx          Teamgerät: Kacheln, Anwesenheit (+ Gäste), Zeiten von–bis (keine Stundenzahl mehr), Sprachnotiz als Bemerkung zum Tag, Fotos
src/seiten/Cockpit.tsx            Wochenübersicht: Raster Team × Tag (Farbe = Stand), Tag öffnen = Personen mit Stunden/Zeiten, Korrektur, Überstunden-Karte, Bemerkung, Freigabe
src/seiten/Export.tsx             Bauführer: SORBA-Raster. Sekretariat: dazu Lohn, Überstunden, je Temporärbüro eigenes Excel
src/seiten/verwaltung/*           Mitarbeitende, Teams, Kunden, Baustellen, Demo (auf Amirs PC nur Demo.tsx und Kunden.tsx, Rest nur auf GitHub)
src/lib/excel.ts                  Excel-Ausgabe mit ExcelJS: Blätter Lohn, Überstunden, je Büro, SORBA-Raster — Layout, Formeln, Druck
src/lib/db.ts                     Dexie-Queue: Meldungen + Zeiteinträge + Audio + Fotos (Version 4 ohne Zusatzaufträge)
src/lib/zeiten.ts                 Zeiten von–bis (die einzige Eingabe): Uhrzeit ↔ Minuten, Spannen summieren (ohne Pausenrechnung), Mittag-Hinweis, Normal/Über aufteilen + Tests
src/lib/lohn.ts                   Lohn-/Temporärbüro-/Überstunden-Aggregation (reine Funktionen) + Tests
src/lib/kennzahlen.ts             Diagramm «Freigabe Vorwoche» und Team-Board
src/lib/demo.ts                   Deterministischer Demo-Betrieb (Meldungen mit Überstunden + Notizen) + Tests
src/lib/datum.ts                  Wochen-/Datumshelfer, NORMALTAG_MIN
src/lib/foto.ts                   Fotos verkleinern (1600 px, JPEG) vor Queue/Upload
src/ui/Diagramm.tsx               DiagrammKarte, WochenTeams — je Tag eine Zeile mit Spur (Flächen, keine Bibliothek, kein SVG)
src/ui/TeamBoard.tsx              Tagesstand aller Teams (gemeldet / Überstunden / noch nicht)
src/ui/FotoGalerie.tsx            Vorschau aus dem Bucket «anhaenge» (signierte Links)
src/ui/Sprachnotiz.tsx            Pegelbalken während der Aufnahme, Text-Enthüllung nach dem Speichern
src/ui/Shell.tsx                  Rahmen: Büro-Ansichten mit Bereichsleiste (md) / Seitenleiste (lg), Baustellen-Ansichten Handy-Spalte
supabase/functions/transkribieren Sprachnotiz → Text (Mistral)
supabase/migrations/              0001–0015 historisch (inkl. Regie-Tabellen, bleiben ungenutzt) · 0016 Zeiten von–bis
archiv/regie-und-board/           Alles Entfernte vom 20.09. + README zum Wiederherstellen
```

## Offene Entscheidungen (nicht raten — nachfragen oder Annahme markieren)

- Transkriptions-Anbieter für 13 Sprachen (Spike mit echten Aufnahmen ausstehend)
- Mittag 12–13 unbezahlt — Annahme Amir, mit Arbnor bestätigen; weitere Pausen?
- öV ganz weg oder nur nicht Vorgabe?
- Sieht der Bauführer alle Baustellen oder nur seine? (Rechte pro Bauführer)
- Login pro Rolle vor echten Kundendaten
- SORBA hat **keinen Import** (Arbnor, 27.08.) — die Rasteransicht ist der Endzustand.
