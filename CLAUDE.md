# Rapporto (Arbeitstitel bis 15.09.: Gerüst Rapport) — Zeiterfassung und Rapporte

Digitales Erfassungswerkzeug für eine Gerüstbaufirma im Raum Bern.
45 Festangestellte + ~30 Temporäre in der Hochsaison, 217 aktive Baustellen.
5 Bauführer. 20 Teams à 2–3 Monteure mit je einem Chefmonteur (Telefonat 27.08.2026).
SORBA wird **gefüttert, nicht ersetzt** — Regierapport und Rechnung entstehen dort.

**Regie ist pro Firma zuschaltbar (02.10.2026).** Vom 20.09. bis 02.10. war sie ganz draussen — der Bauführer (Demo
durch Erin): «Regierapporte und alles, was damit zu tun hat, brauche ich in der App nicht — SORBA macht das, das wäre
doppelte Arbeit.» Amir braucht beides: die Gerüst GmbH (Arbnor) bleibt ohne Regie, einer anderen Firma wird die Fassung
**mit** Regie vorgestellt. Darum **ein Code mit Schaltern**, keine zwei Zweige (Entscheid «Weg B»).
Siehe «Firmen-Schalter» unten. `archiv/regie-und-board/` bleibt als Nachschlagewerk stehen, ist aber nicht mehr die Quelle.

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

## Ansichten und Rechte (09.09., Anmeldung zurück am 02.10.)

Zuerst meldet sich die **Firma** an (`src/seiten/Anmelden.tsx`, Mail + Passwort). Danach wählt man die Ansicht:
**Bauführer, Sekretariat, Chefmonteur, Monteur**. Die Wahl liegt im Gerät (`localStorage.ansicht`,
`src/lib/ansicht.ts`), die Seiten je Ansicht liefert `seitenFuer()`. Das Gerät bleibt angemeldet, bis jemand abmeldet:
auf der Baustelle tippt niemand jeden Abend ein Passwort.

Vom 09.09. bis 02.10. gab es gar keine Anmeldung und die Datenbank bekam eine anonyme Sitzung. Nachgemessen am
02.10.: mit nichts als dem öffentlichen Schlüssel aus dem JavaScript liessen sich Mitarbeiternamen, Stunden, Kunden,
Regiebeträge und das Freigabe-Protokoll lesen. Darum die Anmeldung und `0019`.

**Zwischen Firmen trennt jetzt die Datenbank. Innerhalb einer Firma noch nicht.** Bauführer, Sekretariat und
Teamgerät teilen den Zugang der Firma; im `freigabe_log` steht dann die Firma, nicht die Person. Persönliche Konten
und Rechte je Rolle sind der nächste Schritt — `benutzer` ist dafür vorbereitet, mehrere Konten dürfen zu einer Firma
gehören.
- Bauführer: Tagesübersicht, Wochenübersicht (freigeben, korrigieren), SORBA-Raster, Verwaltung, Erfassung (Test).
- Sekretariat (17.09.): Übersicht Stunden je Mitarbeiter, Export (Lohn, Überstunden, Temporärbüros), Verwaltung —
  nur ansehen im Cockpit. **Lohn sieht nur das Sekretariat** (Bauführer 20.09.: «kein Zugriff hier drauf»).

Korrekturen in der Wochenübersicht brauchen einen Grund aus vier Vorgaben (Regel #7) und laufen über die RPCs aus 0009;
fehlt die Migration, fällt der Code auf den zweistufigen Weg zurück.
Farben: Rot nur für Aktion, Auswahl Stahlblau (`chip-on`), Warnung Bernstein (`amber`).

## Mehrere Firmen in einer Datenbank (02.10.2026, Migration `0019`)

**Eine Datenbank für alle Firmen, nicht eine je Firma.** Der erste Entwurf (ein Supabase-Projekt pro Kunde) wurde
verworfen: zehn Kunden wären zehn Datenbanken, zehn Deployments, jede Migration zehnmal von Hand, zehn Abonnemente.
Amir: «das ist doch gar nicht gut.» Eine neue Firma ist jetzt **eine Zeile und ein Zugang**.

- Tabelle `firma` hält Name und Schalter. Tabelle `benutzer` verbindet ein Auth-Konto mit einer Firma.
- Neun Tabellen tragen `firma_id` direkt (`mitarbeiter`, `team`, `baustelle`, `kunde`, `jahresplan`, `tagesmeldung`,
  `zeiteintrag`, `zusatzauftrag`, `regierapport`), die Kindtabellen erben über ihren Vater.
- **Die Datenbank trennt, nicht die Oberfläche.** Jede Policy vergleicht mit `aktuelle_firma()`. Wer als Gerüst GmbH
  angemeldet ist, bekommt We-Plans Zeilen nicht einmal mit einem eigenen Programm und dem öffentlichen Schlüssel.
- Neue Zeilen bekommen die Firma automatisch: `default aktuelle_firma()` auf der Spalte. Die App schickt nichts mit.
- **Anmeldung ist Pflicht.** Keine anonyme Sitzung mehr: ohne Eintrag in `benutzer` gibt es keine Firma und damit
  keine einzige sichtbare Zeile. Einzige Ausnahme ist der Kundenlink `/b/:token`, der über eine Edge Function mit
  Service-Role läuft — die Bauleitung hat kein Konto und soll keines brauchen.
- Die Edge Functions nutzen die Service-Role und umgehen RLS. Beim Erweitern daran denken: dort muss `firma_id`
  von Hand stimmen.

### Die Schalter je Firma

Sie stehen als Spalten in `firma` (vorher global in `konfiguration`, Migration `0017`). Gelesen wird **nach der
Anmeldung**, einmal (`einstellungenLaden()`), danach aus dem Zwischenspeicher (`src/lib/einstellungen.ts`, zusätzlich
`localStorage`) — die Erfassung läuft offline und darf auf keine Abfrage warten. Gesetzt in **Verwaltung → Einstellungen**.

| Spalte | Werte | Standard | Wirkung |
|---|---|---|---|
| `modus_erfassung` | `wochenblatt` · `regie` | `wochenblatt` | `regie` bringt Zusatzauftrag, Regierapporte, Auswertung, Board, Kundenlink, Ansicht «Kunde», den Abweichungs-Ablauf im Teamgerät und den Regie-Entscheid in der Wochenübersicht |
| `modus_sekretariat` | `stunden` · `voll` | `stunden` | `voll` gibt dem Sekretariat dieselben Bereiche wie dem Bauführer (ohne Teamgerät) und, mit Regie, Fristen + Regie je Monat auf der Übersicht |
| `modus_mehrkostenanzeige` | `false` · `true` | `false` | `true` zeigt «Bauleitung informieren» am Zusatzauftrag (Bausitzungsprotokoll 7.1) und die Anzeigepflicht je Kunde |

Heute: **Gerüst GmbH** (Arbnor) = Wochenblatt, ein Team (Nuhi Vaiti als Gruppenleiter, Ismail Vaiti als
Gerüstbaumitarbeiter). **We-Plan** = Regie, Sekretariat voll, Mehrkostenanzeige an, der ganze Demobetrieb.

**Regeln dazu:**
- Liefert die Datenbank nichts (Migration fehlt, offline, Zugang ohne Firma), bleibt der **letzte bekannte Stand**
  gültig — nie ein Rückfall auf die Standardwerte. Eine Störung darf einer Regie-Firma nicht die Regie wegnehmen.
- Was von den Schaltern abhängt, ist **eine Funktion, keine Konstante** (`ansichten()`, `gruppen()`, `seitenFuer()`,
  `navFuer()`). Eine Modulkonstante stünde fest, bevor die Schalter geladen sind.
- Der Standard ist immer der Stand der Gerüst GmbH. Wer einen Schalter einbaut, lässt deren Ansicht unverändert.

Wo die Schalter wirken: `src/lib/ansicht.ts`, `src/ui/Shell.tsx`, `src/main.tsx` (Routen, nachgeladen),
`src/seiten/Erfassung.tsx`, `Cockpit.tsx`, `Start.tsx`, `StartChef.tsx`, `StartSekretariat.tsx`, `Zusatzauftrag.tsx`,
`verwaltung/Kunden.tsx`, `src/lib/demo.ts` (lädt `demo_regie.ts` nur im Regie-Modus).

### Umstellung (Reihenfolge einhalten)

1. Supabase › Authentication › Sign In / Providers › Email: **«Confirm email» aus**.
2. Die Firmen-Zugänge anlegen (ein Befehl, Passwörter nie in einer Datei).
3. Migration `0019` im SQL-Editor ausführen. Sie sucht die Zugänge an ihrer Mailadresse.
4. Erst dann die neue App-Fassung ausliefern. Vorher sperrt sie alle aus, weil es noch keine Zugänge gibt.

Danach darf im Dashboard auch «Allow anonymous sign-ins» aus.

## Erfassung wie das Wochenblatt (16.09., erweitert 20.09.)

Je Person zwei Werte: **Normal** (Standard 8.4 h = `NORMALTAG_MIN`, Obergrenze) und **Überstunden** (Standard 0),
`zeiteintrag.normal_min` / `ueber_min`. Zwei Team-Regler oben setzen alle gleich, die Zeilen darunter je Person.
Jede Meldung ist `normalfall = true`; `abweichung_typ` / `wer_hats_gewollt` bleiben nur für alte Daten.

**Zeiten von–bis** (Bauführer 20.09.): Umschalter «Stundenzahl | von – bis» fürs Team, je Person überschreibbar. Bis zu
zwei Spannen (Vormittag, Nachmittag), native Uhrzeit-Wahl, Vorgabe **7:00–12:00 und 13:00–offen** — der Mittag 12–13
ist unbezahlt (Amir 20.09., «denke ich» — mit Arbnor bestätigen) und darum als Lücke vorgegeben, **nie abgezogen**. Ohne
«bis» lässt sich nicht speichern; überlappende Spannen auch nicht. Zählt der Mittag mit, sagt es ein Hinweis (kein
Abzug). Summe → Normal (bis 8.4 h) + Überstunden. Spalten `zeiteintrag.von_min/bis_min/von2_min/bis2_min`
(Migration 0016), nur gesetzt, wenn Zeiten eingetragen wurden; Cockpit und «Meine Woche» zeigen sie. Logik + Tests in
`src/lib/zeiten.ts`. Arbeitszeit laut Bauführer 7:00–17:00; bezahlte Pause 9:00–9:30 freiwillig (kein Thema für die App).
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
- Regie, Zusatzaufträge, Kundenlink, Board **ohne Schalter** — sie gehören hinter `MODUS_ERFASSUNG` und dürfen bei
  der Gerüst GmbH nirgends auftauchen
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
src/lib/ansicht.ts                Ansicht lesen/setzen, Seiten je Ansicht (seitenFuer — hängt an den Schaltern)
src/lib/einstellungen.ts          Schalter der angemeldeten Firma: lesen, zwischenspeichern, setzen
src/lib/konto.ts                  Anmelden, abmelden, «ist jemand angemeldet»
src/seiten/Anmelden.tsx           Anmeldung der Firma — die erste Seite
src/seiten/verwaltung/Einstellungen.tsx  Die drei Schalter umlegen (lädt die App danach neu)
src/ui/Karten.tsx                 NavKarte, Kachel, MONATE — gemeinsam für alle Startseiten
src/seiten/Tag.tsx                Tagesübersicht: welche Teams haben gemeldet, welche nicht
src/seiten/Erfassung.tsx          Teamgerät: Kacheln, Anwesenheit (+ Gäste), Stundenzahl oder Zeiten von–bis, Sprachnotiz als Bemerkung zum Tag, Fotos
src/seiten/Cockpit.tsx            Wochenübersicht: Raster Team × Tag (Farbe = Stand), Tag öffnen = Personen mit Stunden/Zeiten, Korrektur, Überstunden-Karte, Bemerkung, Freigabe
src/seiten/Export.tsx             Bauführer: SORBA-Raster. Sekretariat: dazu Lohn, Überstunden, je Temporärbüro eigenes Excel
src/seiten/verwaltung/*           Mitarbeitende, Teams, Kunden, Baustellen, Demo (auf Amirs PC nur Demo.tsx und Kunden.tsx, Rest nur auf GitHub)
src/lib/excel.ts                  Excel-Ausgabe mit ExcelJS: Blätter Lohn, Überstunden, je Büro, SORBA-Raster — Layout, Formeln, Druck
src/lib/db.ts                     Dexie-Queue: Meldungen + Zeiteinträge + Audio + Fotos + Zusatzaufträge (Version 5)
src/lib/zeiten.ts                 Zeiten von–bis: Uhrzeit ↔ Minuten, Spannen summieren (ohne Pausenrechnung), Mittag-Hinweis, Normal/Über aufteilen + Tests
src/lib/lohn.ts                   Lohn-/Temporärbüro-/Überstunden-Aggregation (reine Funktionen) + Tests
src/lib/kennzahlen.ts             Diagramm «Freigabe Vorwoche» und Team-Board
src/lib/demo.ts                   Deterministischer Demo-Betrieb (Meldungen mit Überstunden + Notizen) + Tests
src/lib/demo_regie.ts             Demodaten für den Regie-Modus: Zusatzaufträge, Regierapporte in allen Stadien, Zustellnachweise
src/lib/regie.ts                  Regierapport: Stand ableiten, Fristen, Nummern + Tests
src/lib/tarif.ts                  SGUV-Tarife, Materialmiete, Etappenzuschlag + Tests (Modellfall Fr. 955.93)
src/lib/zusatzauftrag.ts          Tätigkeits- und Grundtexte (nie der DB-Code auf dem Bildschirm)
src/seiten/Zusatzauftrag.tsx      Regie-Modus: Kundenbestellung am Telefon festhalten
src/seiten/RegieListe.tsx         Regie-Modus: Entwurf → beim Kunden → bestätigt, offene Rückfragen zuoberst
src/seiten/RegieVorschau.tsx      Regie-Modus: Rapport vorrechnen (Positionen aus den Stunden)
src/seiten/RegieDetail.tsx        Regie-Modus: senden, Zustellnachweis, Rückfrage, PDF
src/seiten/Auswertung.tsx         Regie-Modus: Regie je Baustelle, Kunde, Monat
src/seiten/Board.tsx              Regie-Modus: Jahresplan Team × KW
src/seiten/Bestaetigung.tsx       Kundenlink ohne Login (/b/:token) — nur im Regie-Modus
src/lib/datum.ts                  Wochen-/Datumshelfer, NORMALTAG_MIN
src/lib/foto.ts                   Fotos verkleinern (1600 px, JPEG) vor Queue/Upload
src/ui/Diagramm.tsx               DiagrammKarte, WochenTeams — je Tag eine Zeile mit Spur (Flächen, keine Bibliothek, kein SVG)
src/ui/TeamBoard.tsx              Tagesstand aller Teams (gemeldet / Überstunden / noch nicht)
src/ui/FotoGalerie.tsx            Vorschau aus dem Bucket «anhaenge» (signierte Links)
src/ui/Sprachnotiz.tsx            Pegelbalken während der Aufnahme, Text-Enthüllung nach dem Speichern
src/ui/Shell.tsx                  Rahmen: Büro-Ansichten mit Bereichsleiste (md) / Seitenleiste (lg), Baustellen-Ansichten Handy-Spalte
supabase/functions/transkribieren Sprachnotiz → Text (Mistral)
supabase/migrations/              0001–0015 historisch (inkl. Regie-Tabellen) · 0016 Zeiten von–bis · 0017 Firmen-Schalter (durch 0019 abgelöst) · 0019 mehrere Firmen, Rechte je Firma
archiv/regie-und-board/           Stand vom 20.09. als Nachschlagewerk — nicht mehr die Quelle (Regie ist zurück, hinter Schaltern)
```

## Offene Entscheidungen (nicht raten — nachfragen oder Annahme markieren)

- Transkriptions-Anbieter für 13 Sprachen (Spike mit echten Aufnahmen ausstehend)
- Mittag 12–13 unbezahlt — Annahme Amir, mit Arbnor bestätigen; weitere Pausen?
- öV ganz weg oder nur nicht Vorgabe?
- Sieht der Bauführer alle Baustellen oder nur seine? (Rechte pro Bauführer)
- Login pro Rolle vor echten Kundendaten
- SORBA hat **keinen Import** (Arbnor, 27.08.) — die Rasteransicht ist der Endzustand.
