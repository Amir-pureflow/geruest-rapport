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

**Regie im Teamgerät (11.10.2026, Amir):** Hat das Team Überstunden und tippt «Tag melden», fragt die App einmal:
«1.6 h Überstunden je Person — war das Regie?» — «Ja» führt in den Regie-Ablauf (Überstunden vorbelegt), «Nein»
speichert normal. Sonst rutscht Regie als gewöhnliche Überstunden durch. Nur im Regie-Modus; die Gerüst GmbH
(Wochenblatt) sieht nichts davon. **Seit 13.10.2026 der einzige Weg zur Regie:** die drei Kacheln «War etwas anders?»
(Regie ausgeführt / warten müssen / etwas kaputt) unter «Tag melden» sind weg (Amir: «es gibt ja Tag melden — man kann
ja sagen, ob es Regie war, wenn man Überstunden macht»). Alte Meldungen mit «Wartezeit»/«etwas kaputt» werden weiter
angezeigt. Der Knopf heisst immer «Tag melden» (nicht mehr «Alles wie geplant»).
**Sprachnotiz bei Überstunden Pflicht — auch bei Regie** (13.10.2026, Amir: «ich will, dass man erkennt, dass man eine
Sprachnotiz machen muss»): Schild «Pflicht» an der Karte, Zeile «Zuerst die Sprachnotiz» im grünen Knopf; «Tag melden»
ohne Notiz springt zum Mikrofon — noch vor «War das Regie?». Das Feld selbst zeigt, was fehlt (rote Strichlinie läuft
ums Feld, einmal anstupsen, «Fehlt noch …»; `.notiz-*` in index.css) — keine rote Karte, kein roter Satz. Das Mikrofon
bleibt dabei neutral (14.10.: rote Ringe sahen aus wie eine laufende Aufnahme); ohne Mikrofon auf dem Gerät keine Markierung.
**Pflicht erst ab einem Tagestotal** (0045/0046, 14.10.2026, Amir «ab wie viel Überstunden muss man reden»; «bei Arbnor
ab 9 h muss man erklären»): `firma.notiz_pflicht_ab_min` = Tagestotal einer Person in Minuten, null = jede Überstunde,
360–720 (Gerüst 540 = 9.0 h, We-Plan 534 = 8.9 h aus «30 Min.», neue Firmen 540). Gebaut wie «Gelb markieren ab»;
Verwaltung → Einstellungen «Sprachnotiz bei Überstunden — Pflicht ab». Massgebend ist die Person mit den meisten
Überstunden (`ueberMax`, Tagestotal = Arbeitstag + Überstunden); darunter Schild «freiwillig». Regie immer Pflicht. Im Regie-Schritt ebenso Pflicht (vorher
«freiwillig»). Ohne Mikrofon auf dem Gerät geht es trotzdem (`notizPflichtPruefen` in Erfassung.tsx).
«War das Regie?» steht nicht mehr als Schalter in der Karte («verwirrend») — nur noch einmal als Frage beim Melden.
Überstunden (Anzeige «h über», Karte, «Pflicht», Regie-Frage) erst, wenn die Zeiten fertig sind (`ueberFertig`): vorher
zeigte ein schon gemeldeter Tag mit vorgefülltem Morgen sofort «4.6 h über», ohne dass etwas eingetragen war.

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
    Ausnahme je Firma (Migration 0036, Arbnor 10.10.2026): Die Pause am Morgen wird bei der Gerüst GmbH **immer**
    abgezogen (9:00–9:15, Vormittag 7–12 = 4.75 h). Auch das sichtbar: der Vormittag steht schon geteilt da
    (7:00–9:00, 9:15–12:00), gezählt wird weiter, was dasteht. In Texten heisst sie «Pause», nie «Znüni» (Amir 11.10.).

## Ansichten und Rechte (09.09., Anmeldung zurück am 02.10.)

Zuerst meldet sich die **Firma** an (`src/seiten/Anmelden.tsx`, Mail + Passwort). Danach wählt man die Ansicht:
**Bauführer, Sekretariat, Chefmonteur, Monteur**. Die Wahl liegt im Gerät (`localStorage.ansicht`,
`src/lib/ansicht.ts`), die Seiten je Ansicht liefert `seitenFuer()`. Das Gerät bleibt angemeldet, bis jemand abmeldet:
auf der Baustelle tippt niemand jeden Abend ein Passwort.

Vom 09.09. bis 02.10. gab es gar keine Anmeldung und die Datenbank bekam eine anonyme Sitzung. Nachgemessen am
02.10.: mit nichts als dem öffentlichen Schlüssel aus dem JavaScript liessen sich Mitarbeiternamen, Stunden, Kunden,
Regiebeträge und das Freigabe-Protokoll lesen. Darum die Anmeldung und `0019`.

**Zwischen Firmen trennt die Datenbank, seit `0041` (13.10.2026) auch zwischen Rollen.** Firmen-Zugänge (Teamgerät,
Inhaber) und persönliche Konten (`0033`/`0034`) gehören über `benutzer` zu einer Firma; im `freigabe_log` steht die
Sitzung, die freigegeben hat.

**Persönliche Zugänge für alle Rollen (09.10.2026 `0033`, aus der Verwaltung seit 10.10. `0034`).**
Das Büro legt sie selbst an: Verwaltung → Mitarbeitende → Person → **Benutzerkonto** (`verwaltung/Konto.tsx`).
**Vier Rollen**: Monteur, Chefmonteur, Bauführer, Sekretariat (Erin 10.10.: «Was ist, wenn eine Sekretärin kommt?»),
vorgeschlagen aus der Funktion (`rolleVorschlag()`). Passwort vorgeschlagen («Anker-4827»), ein Knopf; Adresse und
Passwort erscheinen **einmal** zum Kopieren. Später: Rolle ändern, Passwort neu setzen, Konto löschen. Neue Person:
nach dem Speichern bleibt der Dialog offen, damit das Konto gleich folgt.
- **Funktion «Büro / Sekretariat»** (`FUNKTION_BUERO = 'buero'`, kein SGUV-Tarif): für Leute im Büro. Sie erscheinen
  im Teamgerät nicht als Gast und lassen sich keinem Team zuteilen. Tariflookups fallen auf den Monteursansatz zurück.
- **Wer darf was** (`konten_recht()` in 0034, gespiegelt in `darfVergeben()`): Firmen-Zugang (Inhaber) und Sekretariat
  alle Rollen; Bauführer alles **ausser Sekretariat** (sonst könnte er sich Lohn-Zugang geben — «Lohn sieht nur das
  Sekretariat»); Monteur/Chefmonteur nichts. Das eigene Konto löschen oder die eigene Rolle ändern geht nicht.
- **Adresse** `vorname.nachname@<firma.mail_domain>` (Erin 10.10.: «vorname.nachname@firma»), Gerüst GmbH `geruest.ch`,
  ohne Domain `rapporto.pureflow-ai.com`. Doppelname → `…2@`. Es geht nie eine Mail raus, die Adresse ist nur der Login.
  Arbnors Firmen-Zugang heisst seit `0034` **`arbnor.arifi@geruest.ch`** (vorher `arbnor@rapporto.pureflow-ai.com`,
  Passwort gleich). Logik + Tests: `src/lib/benutzername.ts`.
- Angelegt über **Datenbankfunktionen**, nicht Edge Functions (die liessen sich nicht ausliefern, daran scheiterte
  `0032`): `konto_anlegen`, `konto_rolle`, `konto_passwort`, `konto_loeschen`, `konten_der_firma`. Sie schreiben
  direkt in `auth.users` + `auth.identities` — ⚠ ändert Supabase dort Pflichtspalten, `konto_anlegen` nachführen.
- **Inaktiv = kein Zugang:** `aktuelle_firma()` liefert für einen Personen-Zugang nur etwas, solange
  `mitarbeiter.aktiv`. Person gelöscht → `benutzer`-Zeile weg (cascade).
- In `benutzer` stehen `mitarbeiter_id` und `ansicht`; nach der Anmeldung setzt `personLaden()` (`src/lib/konto.ts`)
  Ansicht und Person selbst, der Chefmonteur bekommt sein Team vorgewählt (`team.chefmonteur_id`). Mit fester Ansicht
  gibt es kein «Ansicht wechseln» und kein «Nicht ich» (`festeAnsicht()` in `ansicht.ts`). Firmen-Zugänge lassen
  beide Felder leer und wählen frei. Das Gerät bleibt angemeldet (Regel #4).
- Der **Einladungslink per WhatsApp** (`0032`, `/e/:token`, Edge Function `einladung`) ist am 09.10. verworfen
  worden (Erin: «das wollen wir nicht mehr machen»); `0033` entfernt seine Tabellen wieder. Nicht wieder einbauen.
- **Rechte je Rolle in der Datenbank** (`0041`, Amir 13.10.: «Die App darf keine Fehler haben»). `aktuelle_rolle()`
  liefert `buero` (Firmen-Zugang ohne Ansicht, Bauführer, Sekretariat), `chef` oder `monteur` — nur bei aktiver
  Person. RESTRICTIVE-Regeln zusätzlich zu den Firmen-Regeln, Lesen bleibt für alle Rollen der Firma offen:
  - **Büro**: alles in der eigenen Firma.
  - **Chefmonteur**: Tagesmeldung, Zeilen (nur `offen`) und Fotos melden; offene Meldung ersetzen (löschen, solange
    keine Zeile freigegeben ist); an der Meldung nur `audio_pfad` nachreichen; an sich selbst nur `sprache` ändern
    (Auslöser `rolle_spalten_pruefen`). Sonst nichts — kein Freigeben, keine Stammdaten, keine Einstellungen.
  - **Monteur**: nur lesen.
  - `freigabe_log`/`zustellung_log` nur anhängen; löschen nur in der Demo-Firma (Zurücksetzen).
  - **Regie lesen nur das Büro** (`0048`, 24.10.2026 — vorher konnte jeder persönliche Zugang über die API Beträge und
    Ansätze lesen): `regierapport`, `regie_position`, `zustellung_log` und damit die Sichten mit Beträgen. Der Chefmonteur
    bekommt den Stand eines Auftrags über `zusatzauftrag_rapport()` (ohne Betrag, steckt in `zusatzauftrag_stand`),
    «Frühere ersetzen» fragt `meldung_regierapporte()` (nur die Zahl). Neue Seiten für Chefmonteur/Monteur dürfen
    Regie-Tabellen nicht direkt lesen.
  - Jede Zeile zeigt nur auf Zeilen der eigenen Firma (Auslöser `firma_bezuege_pruefen`).
  - `zeit_freigeben`/`zeit_korrigieren`/`zeit_team_setzen` nur Büro, nur eigene Firma, «wer» = Sitzung.
  - `firma.name`, `mail_domain`, `aktiv`, `ist_demo` ändert nur PureFlow per SQL (`firma_schutz`). Die Demo erkennt
    die Datenbank an `firma.ist_demo`, nicht am Namen.
  - Wer in der App etwas Neues schreiben lässt (neue Tabelle, neue Spalte für den Chefmonteur), muss die Regel in
    `0041` mitdenken — sonst sagt die Datenbank «row-level security policy» bzw. «Das darf nur das Büro ändern.»
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
- Die Edge Functions nutzen die Service-Role und umgehen RLS. Seit 13.10.2026 fragt jede zuerst
  `aufrufer(req)` (`supabase/functions/_shared/zugang.ts`: Firma + Rolle über `aktuelle_firma()`/`aktuelle_rolle()`
  mit dem JWT des Aufrufers) und vergleicht die `firma_id` der Zeile — `verify_jwt` allein liess auch den
  öffentlichen anon-Schlüssel durch. Pfade aus Tabellen (`audio_pfad`, `foto.pfad`, `anhang_pfad`, `pdf_pfad`) werden
  nur gelesen, wenn sie im Ordner ihrer eigenen Zeile liegen (`pfadPasst`). Links in Mails/PDF immer aus
  `konfiguration.APP_URL`, nie aus der Anfrage. Neue Function: dasselbe Muster.
- **Dateien** (`0020`): der Eimer `anhaenge` ist über `anhang_gehoert_firma()` abgesichert. Der Pfad verrät den
  Besitzer (`audio/<client_uuid>`, `fotos/<client_uuid>/`, `fotos/rapport/<rapport_id>/`, `rapporte/<rapport_id>.pdf`,
  `rapporte/<rapport_id>/<eigenes Dokument>` — die beiden Rapport-Pfade erst seit `0042`, vorher scheiterte das
  Hochladen dort), der hängt an einer Zeile mit Firma; Rapport-Dateien nur fürs Büro. Löschen bleibt gesperrt (Regel #8). Ein neuer Pfad ohne Eintrag in dieser Funktion ist gesperrt — daran
  denken, wer einen neuen Ordner einführt.
- **Rapportnummern** (`0020`): je Firma ab 1, eindeutig nur innerhalb der Firma.
- **Briefkopf auf dem PDF** (`0021`): Spalten `briefkopf_*` in `firma`, gepflegt in Verwaltung → Einstellungen
  (nur im Regie-Modus sichtbar). Leere Felder fallen auf die globalen `konfiguration.FIRMA_*` zurück. Die beiden
  Edge Functions `regierapport-pdf` und `regierapport-senden` lesen sie — **nach einer Änderung neu ausliefern**.

### Die Schalter je Firma

Sie stehen als Spalten in `firma` (vorher global in `konfiguration`, Migration `0017`). Gelesen wird **nach der
Anmeldung**, einmal (`einstellungenLaden()`), danach aus dem Zwischenspeicher (`src/lib/einstellungen.ts`, zusätzlich
`localStorage`) — die Erfassung läuft offline und darf auf keine Abfrage warten. Gesetzt in **Verwaltung → Einstellungen**.

| Spalte | Werte | Standard | Wirkung |
|---|---|---|---|
| `modus_erfassung` | `wochenblatt` · `regie` | `wochenblatt` | `regie` bringt Zusatzauftrag, Regierapporte, Auswertung, Planung, Kundenlink, Ansicht «Kunde», den Abweichungs-Ablauf im Teamgerät und den Regie-Entscheid in der Wochenübersicht |
| `modus_sekretariat` | `stunden` · `voll` | `stunden` | `voll` gibt dem Sekretariat dieselben Bereiche wie dem Bauführer (ohne Teamgerät) und, mit Regie, Fristen + Regie je Monat auf der Übersicht |

Die Mehrkostenanzeige («Bauleitung informieren», Schalter `modus_mehrkostenanzeige`) ist am 06.10.2026 auf Wunsch von Amir
ganz aus der App entfernt worden; Spalten und Edge Function `mehrkosten-anzeigen` stehen nur noch in der Datenbank.

Heute: **Gerüst GmbH** (Arbnor) = Wochenblatt, ein Team (Nuhi Vaiti als Gruppenleiter, Ismail Vaiti als
Gerüstbaumitarbeiter). **We-Plan** = Regie, Sekretariat voll, der ganze Demobetrieb.

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
ist unbezahlt (Amir 20.09., «denke ich» — mit Arbnor bestätigen) und darum als Lücke vorgegeben, **nie abgezogen**.
**Arbeitsbeginn und Mittag je Firma** (0047, Amir 15.10.2026): `firma.arbeitsbeginn_min` / `mittag_von_min` /
`mittag_bis_min`, gelesen über `arbeitstag()` in einstellungen.ts, gesetzt in Verwaltung → Einstellungen → «Arbeitszeiten»
(`arbeitstagSetzen`). Daraus kommen Vorgabe (`standardSpannen(znueni(), arbeitstag())`), Mittag-Hinweis, «Nachmittag»-
Beschriftung und die zwei Wechselzeiten bei zwei Baustellen (vor/nach dem Mittag, die gewählte markiert). Standard =
Gerüst GmbH (7:00, 12–13); Texte sagen bei vollen Stunden weiter «Mittag 12–13» (`mittagText()`, englische Demo). Ohne
«bis» lässt sich nicht speichern; überlappende Spannen auch nicht. Zählt der Mittag mit, sagt es ein Hinweis (kein
Abzug). Summe → Normal (bis 8.4 h) + Überstunden. Spalten `zeiteintrag.von_min/bis_min/von2_min/bis2_min`
(Migration 0016), nur gesetzt, wenn Zeiten eingetragen wurden; Cockpit und «Meine Woche» zeigen sie. Logik + Tests in
`src/lib/zeiten.ts`. Arbeitszeit laut Bauführer 7:00–17:00. Pause am Morgen je Firma (0036, `znueni()` in einstellungen.ts): Standard 9:00–9:30
bezahlt, Abzug nur auf Knopfdruck «− Pause»; Gerüst GmbH 9:00–9:15, immer abgezogen. Seit 0047 muss sie im Vormittag
der Firma liegen (Arbeitsbeginn bis Mittag) — wer die Arbeitszeiten ändert, muss eine Pause, die nicht mehr passt, zuerst verschieben.
**Offen mit Arbnor:** Mittag wirklich unbezahlt? Weitere Pausen? Trägt der Chefmonteur für alle ein? (Die Zeiten selbst stellt jede Firma ein.)

**Überstunden** brauchen ein Warum: die **Sprachnotiz** (Pflicht, ausser das Mikrofon fehlt). Seit 20.09. ist sie immer
da — als **Bemerkung zum Tag**, freiwillig. Der Bauführer sieht Überstunden gelb in der Wochenübersicht, liest die Notiz,
gibt frei. Ob etwas dem Kunden verrechnet wird, entscheidet er in SORBA — die App fragt das nicht.

**Zwei Baustellen am Tag** (0036-Paket, Arbnor 10.10.2026: «bequemer, auf einmal»): «+ Zweite Baustelle heute» unter den
Kacheln, Wechselzeit (Standard 13:00). Die Zeiten bleiben für den ganzen Tag eingetragen; beim Speichern teilt
`spannenTeilen()` sie am Wechsel, `teileAufteilen()` füllt den normalen Tag in der Reihenfolge und gibt den Rest als
Überstunden dem späteren Teil — so zählt der Tag gleich wie auf einer Baustelle. Zwei Meldungen, ein Durchgang; Anreise
nur am ersten Teil der Person, Notiz/Fotos an die Meldung mit den Überstunden. Keine Migration nötig.

**Gäste** (20.09.): «Person hinzufügen» — aus der Mitarbeiterliste, Name ab 2 Buchstaben, max. 5 Treffer, dazu
«Zuletzt dabei» je Team (`localStorage teamgeraet-gaeste-<teamId>`). Gäste landen nur im `zeiteintrag`, nicht in
`team_mitglied`.

**Nur Auto** (20.09.): `OEV_AKTIV = false` in Erfassung.tsx — öV-Chip ausgeblendet, `oev` bleibt im Datenmodell.
Ob öV ganz weg soll: klären, dann Spalte und `oev_standard` aufräumen.

## Sprachnotiz: prüfen in der eigenen Sprache, dann Deutsch (15.09., umgebaut 04.10.)

Der Sprecher kann Deutsch nicht beurteilen — sein Albanisch/Polnisch/Arabisch/Portugiesisch schon (Entscheid Amir,
04.10.2026). Darum drei Schritte:

1. **Erkennen** — die Erfassung schickt das Audio an `transkribieren` (`schritt: 'erkennen'`, `audio_base64` +
   `team_id`). Zurück kommt der Text in der **Sprache des Sprechers** (aus dem Profil, Regel #9: nie raten).
2. **Prüfen** — der Sprecher sieht sein Original, korrigiert es und bestätigt (Frage und Knopf in seiner Sprache,
   `PRUEF_TEXTE` in Erfassung.tsx, `dir="auto"` wegen Arabisch). Spricht er Deutsch, entfällt dieser Schritt.
3. **Übersetzen** — erst der **bestätigte** Text geht an `transkribieren` (`schritt: 'uebersetzen'`) und wird zu
   Schweizer Hochdeutsch. Gespeichert: `transkript` (deutsch), `transkript_quelle` (bestätigtes Original),
   `transkript_sprache`.

Offline oder nicht bestätigt: `db.ts` stösst die nachträgliche Transkription an (beide Schritte automatisch, ohne
Prüfung — der Monteur ist dann nicht mehr da). Die Aufnahme bleibt der Beleg (Regel #8). Cockpit: Notizen ohne
Überstunden erscheinen als Karte «Bemerkung zum Tag».

**Sprachen** (Stand 11.10.2026): de, sq, pt, it, fr, **es**, ar, pl, en — eine neue Sprache braucht: Check-Regeln
`mitarbeiter_sprache_check` + `tagesmeldung_transkript_sprache_check` (Migration), `SPRACHEN` + `AZURE_GEBIET` in der
Function, `PRUEF_TEXTE` in Erfassung.tsx (Frage + Knopf in der Sprache), die Namenslisten in Mitarbeiter.tsx,
Cockpit.tsx, Tag.tsx, RegieDetail.tsx, ui/Sprachnotiz.tsx. Die Übersetzung hat ein **Glossar der Gerüstbau-Wörter**
(andamio/ponteggio/… = Gerüst, nivel = Lage, tablón = Belag …) in `ANWEISUNG`. Spanisch geprüft 11.10. mit Azure-Stimmen
aus Spanien, Mexiko und Kolumbien: Erkennung wortgenau, Übersetzung fachlich richtig.

**Übersetzung geprüft 13.10.2026** (Amir: «Albanisch übersetzt nicht gut», «Italienisch, Arabisch, Polnisch, Spanisch müssen
perfekt sein»): Prüfstand mit Azure-Stimmen, 46 Baustellensätzen in 7 Sprachen inkl. Kosovo-Albanisch, levantinischem
Arabisch, Lateinamerika-Spanisch und deutschen Wörtern im Satz. Ergebnis: Übersetzung aus *bestätigtem* Text in allen
Sprachen richtig. Darum in `_shared/uebersetzung.ts`: `REGELN` (Person, Verneinung, verlangt≠erlaubt, Rollen fest:
capo/jefe = Chef, capocantiere/encargado = Polier, jefe de obra = Bauführer, direzione lavori = Bauleitung; deutsche Wörter
im fremden Satz; lieber «…» als erfinden), `MUNDART` je Sprache, Kontext (Baustelle + Leute im Team, `_shared/kontext.ts`,
die Erfassung schickt `team_id`/`baustelle_id`) — damit wird «artrase» wieder «Aarstrasse». 429 von Mistral → Wiederholung.
`mistral-large-latest` war NICHT besser (erfand mehr) und lief in die Mengenbremse. Die Erkennung (Azure) bleibt die
Schwachstelle bei Mundart und deutschen Wörtern («Gerüst» → «Jerust»); eine Phrasenliste hilft Azure nachweislich nicht.
Darum ist der Prüfschritt (Sprecher korrigiert sein Original) wichtig.

Das Ohr ist austauschbar: nur `stt()` in `supabase/functions/_shared/ohr.ts`. Heute Mistral Voxtral
(kann kein Albanisch, Arabisch/Polnisch schwach); geplant Azure AI Speech, Region Schweiz Nord — siehe
«Offene Entscheidungen». Die Übersetzung aus bestätigtem Text ist geprüft für sq/pl/pt/ar (04.10.).

## Regie-Mails: Postfach statt Spam (20.10.2026)

Amir: «Sie dürfen nicht im Spam landen.» Regeln in `supabase/functions/regierapport-senden`:
- **Nie an reservierte Domains** (`.example`, `.test`, `.invalid`, `.localhost` — die erfundenen Demo-Kunden): der Versand
  wird nur simuliert (`resend_id: 'simuliert'`, `detail.simuliert`). Jede Fehlzustellung drückt den Ruf der Absenderdomain.
- **Antwortadresse = echtes Postfach**: `firma.briefkopf_mail`, sonst `MAIL_ANTWORT_AN` — nie die Anmelde-Adresse des
  Bauführers (`vorname.nachname@<mail_domain>` ist nur ein Login; `geruest.ch` gehört nicht einmal der Gerüst GmbH).
- **Absender** `«<Firma> via Rapporto» <regie@mail.pureflow-ai.com>` — kein Firmenname allein vor fremder Domain.
- **Vollständiges HTML-Dokument** (`<html>`/`<body>`) plus Text-Teil; kein Phishing-Wortlaut («ohne Anmeldung bestätigen»).
- **Link-Domain**: `APP_URL` soll eine eigene Domain sein (`rapporto.pureflow-ai.com`), nicht `*.vercel.app` —
  vercel.app-Links stufen Spamfilter als verdächtig ein.
- DNS (Hostpoint): SPF + DKIM für `mail.pureflow-ai.com` bei Resend, DMARC von `pureflow-ai.com` (`p=quarantine`).
  In Resend Klick-/Öffnen-Tracking für die Domain AUS lassen (Tracking schreibt Links um).

## Export (20.09.)

Bauführer sieht unter `/export` nur das SORBA-Raster (Nav «SORBA-Raster»). Sekretariat: dazu Lohnstunden, Überstunden
(Zeitraum + seit Jahresbeginn) und **je Temporärbüro ein eigenes Excel** mit nur dessen Leuten (`excelGruppe('buero')`, Datei
`Temporaer_<Büro>_<Zeitraum>.xlsx`) — die Datei, die ans Büro geht. `lohnSichtbar` in Export.tsx.
**Subunternehmer genauso** (13.10.2026, Amir: «für Subunternehmer auch Export-Liste wie Temporärbüro»): Reiter
«Subunternehmer», je Firma eine Karte, ein Blatt im Gesamt-Excel (nach den Büros) und ein eigenes Excel
(`excelGruppe('sub')`, Datei `Subunternehmer_<Firma>_<Zeitraum>.xlsx`). Gruppiert nach `mitarbeiter.subunternehmer_firma`
(0040) bei Anstellung «extern» (`subunternehmerBlaetter` in lohn.ts); Externe ohne Firma → gelber Hinweis, kein eigenes
Excel. Lohn-Blatt: Spalte «Büro / Firma» (Temporärbüro bzw. Firma des Subunternehmers, `firmaVon`).

Das Excel baut `src/lib/excel.ts` mit **ExcelJS** (Amir 20.09.: «schöner vom Design und Layout her»): Titel + Untertitel
(Zeitraum, Team, Filter, Stand) auf jedem Blatt, dunkle Kopfzeile, Zebrastreifen, Summenzeilen als echte SUM-Formeln,
fixierte Kopfzeile, Autofilter, Querformat auf eine Seitenbreite. Stunden exakt (min/60, Format 0.00), nicht gerundet.
Temporärbüro-/Subunternehmer-Blatt: nach Person gruppiert mit Zwischensumme, darunter «Summe je Person» und Total. SORBA-Raster mit
senkrechten Personennamen und Totalspalte. ExcelJS (~1 MB) wird per dynamischem Import erst beim Klick geladen. SheetJS
(`xlsx`) ist raus — die freie Ausgabe kann keine Formatierung schreiben.

**Lieferwagen für Subunternehmer** (0036, Arbnor 10.10.2026): Sind Leute mit Anstellung «extern» dabei, zeigt das
Teamgerät den Haken «Lieferwagen der Firma gebraucht» (`tagesmeldung.lieferwagen`). Betrag pro Tag in Verwaltung →
Einstellungen (`firma.lieferwagen_tag_rp`, 0 = aus; Gerüst GmbH Fr. 100). Export: Reiter + Blatt «Lieferwagen», pro Team
und Tag einmal (`src/lib/lieferwagen.ts`), mit Spalte «Subunternehmer» = die Externen, die an dem Tag in der Meldung
standen (13.10.2026, Amir), und Spalte «Firma» = `mitarbeiter.subunternehmer_firma` (0040, Verwaltung → Mitarbeitende, nur bei
«extern»; schon erfasste Firmen als Vorschlag zum Antippen). Offen bei Arbnor: wer zahlt, wenn zwei Subunternehmer im Team sind.

**Abwesenheiten** (0036, Arbnor 10.10.2026): Verwaltung → Abwesenheiten (Sekretariat/Bauführer). Tabelle `abwesenheit`,
eine Zeile je Person und Werktag (Zeitraum → Mo–Fr), `minuten` = bezahlte Zeit (Vorschlag `normaltagMin()`, halb, 0 bei
unbezahlt). Wirkung: Teamgerät hakt Abwesende ab (mit Pille, antippen geht trotzdem), «Meine Woche» zeigt den Tag,
Export: Spalte «Abwesend» im Lohn (nicht im Total), Reiter + Blatt «Abwesenheiten». Logik in `src/lib/abwesenheit.ts`,
`mitAbwesenheiten()` in lohn.ts.

**Keine Browser-Auswahllisten** (12.10.2026, Amir: «mach das cleaner», überall): `src/ui/Auswahl.tsx` — Feld wie die
anderen (`art="feld"`) oder Pille für Werkzeugleisten (`art="pille"`, am rechten Rand rechtsbündig); Liste mit Suche ab
elf Einträgen, Einträge mit Bild vorne, Unterzeile, Marken, Trennlinie; immer nur eine Liste offen. `PersonWahl.tsx` =
Auswahl mit Avatar und «Beispiel» statt «(Bsp.)» (`src/lib/namen.ts`). Im Einsatz: Abwesenheiten (mit «Alle
Mitarbeitenden»), Team-Dialog, Team im «Einsatz planen», Team-Filter im Export, Kunde bei Baustellen, Funktion und Sprache
bei Mitarbeitenden (Anstellung als `Segment`). Kein `<select>` mehr in `src/` — neue Auswahlen damit bauen.

**Modus nicht wählbar bei Kunden** (12.10.2026, Amir: «die zwei Optionen bei Arbnor und beim Sekretariat weg»): «Was der
Chefmonteur am Abend meldet» und «Was das Sekretariat sieht» stehen nur noch in der Demo-Firma unter Einstellungen
(`istDemoFirma()`); bei echten Firmen stellt PureFlow das ein (`konfiguration` per SQL).

**Markierter Tag in der Wochenübersicht** (Sprung `?tag=` aus der Freigabe-Karte): bleibt, solange man im markierten Tag
arbeitet; einen anderen Tag öffnen oder die Woche wechseln hebt sie auf, auch in der Adresse (`markierungWeg()` in
Cockpit.tsx, 12.10.2026).

## Planung je Tag (0036, Mehmeti 10./11.10.2026)

`/planung` volle Breite (`Shell breit`), alle Tage gleich breit, Teamspalte bleibt beim Scrollen stehen und zeigt die
festen Leute. Unter den Balken je Team eine **Tageszeile**: Leute an dem Tag, +eingeteilt, −in anderem Team, abwesend,
für vergangene Tage **Plan gegen Ist** (✓ wie geplant, ≠ andere Baustelle, – nichts gemeldet) — alte Wochen = Archiv.
Antippen öffnet den Tag: Leute versetzen (nur dieser Tag / bis Freitag), dazunehmen, «nur an diesem Tag andere
Baustelle» (schneidet den Einsatz, `ohneTag()`, Verlauf in `planaenderung`). «+ Team» legt ein Zusatzteam an. Tabelle
`einsatz_person` (Person × Tag × Team); keine Zeile = festes Team. Das Teamgerät übernimmt die Einteilung (Versetzte
abgehakt mit «in Team X», Eingeteilte als «eingeteilt»). Rechnerei in `src/lib/planung.ts` (`besetzung`, `planIst`).

**Entwurf, Archiv, Verlauf** (0038, Mehmeti): Ein Auslöser schreibt jede Änderung an `jahresplan` und
`einsatz_person` in `plan_verlauf` (neu/geändert/gelöscht, vorher/nachher, Zeit, wer) — die App liest nur. Wochenstatus
im Kopf: keiner mehr («Entwurf · Woche läuft» / «Archiv» / «Plan» seit 13.10. weg, Amir — die Ansicht-Wahl sagt es). Für Wochen mit vergangenen Tagen drei Ansichten: Aktueller Plan,
**Plan vom Montag** (`planAm()`: vom heutigen Stand rückwärts durch den Verlauf bis Mo 06:00) und **Tatsächlich**
(`istBalken()` aus den Meldungen); vergangene Wochen öffnen auf «Wirklich gewesen», darunter gestrichelt, was am Montag
anders geplant war. Die Verlaufsliste unter dem Raster gab es kurz und ist wieder weg (Amir 11.10.: verwirrend). Testdaten
direkt per SQL nur mit abgeschalteten Auslösern einfügen, sonst entstehen Verlaufszeilen mit falscher Zeit.

**Einfacher (11.10.2026, Amir):** ein Klick pro Tag (Balken antippen öffnet den angetippten Tag, dort «Ganzen Einsatz
ändern»), Tageszeile in Worten («+ Marco», «− Luan», «Pedro Ferien» statt +1/−1), Erste-Schritte-Karte (wegklickbar,
`localStorage planung-hilfe-v1`). **Umplanung erreicht das Team:** `planHinweise()` aus `plan_verlauf` (letzte 72 h, heute +
nächster Arbeitstag) → Startseite Chefmonteur «Plan geändert» («Montag: Viktoriastrasse — statt Eigerplatz», «Marco ist
in Team 3»); im Teamgerät steht die heute geplante Baustelle zuerst, nach einer Umplanung «neu geplant». Baustellen-Hinweis
nur, wenn für den Tag vorher schon etwas geplant war — ein neu verplanter Tag ist keine Umplanung (sonst hätte jedes Team
am Montag «Plan geändert», weil am Freitag geplant wurde). «Demo laden» und «Alles leeren» leeren danach den Verlauf
der Demo-Firma (`demo_verlauf_leeren()`, 0039, nur We-Plan) — sonst wäre jeder Demo-Einsatz 72 h lang «neu» und eine
Umplanung in der Vorführung erschiene nicht.

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
- Regie, Zusatzaufträge, Kundenlink, Planung **ohne Schalter** — sie gehören hinter `MODUS_ERFASSUNG` und dürfen bei
  der Gerüst GmbH nirgends auftauchen
- Automatische Freigabe «plausibler» Stunden
- Mitarbeiter-Scoring oder -Bewertung
- Laufende Standortverfolgung (GPS nur punktuell, freiwillig, optional)
- Automatische Kürzung von Stunden, stiller Pausenabzug (die Pause am Morgen je Firma, 0036, steht sichtbar als eigene Zeile da)
- Eigenes Backend-Framework, native Apps, Microservices

## Arbeitsweise

- **Vertikal schneiden**: ein Durchstich pro Feature (UI → Queue → DB → Anzeige).
- **Fixtures sind die Wahrheit**: die Baustellenliste. Keine erfundenen Testdaten mit `test@example.com`.
- **Rechenlogik nur mit Tests**: `src/lib/lohn.ts`, `src/lib/zeiten.ts` werden nie ohne Vitest-Fälle geändert.
- Ein Feature, ein Commit.
- Auf Amirs PC (bayan) gibt es weder Node noch git: Typecheck/Tests laufen dort nicht — vor dem Push auf einem Gerät
  mit Node `npm run build` und `npm test` ausführen.

## Migrationen einspielen (seit 11.10.2026 per CLI, kein SQL-Editor nötig)

Wer Mitglied der Supabase-Organisation ist und sich einmal mit `npx supabase login` angemeldet hat (Windows-PowerShell:
`npx.cmd`), spielt eine Migration so ein — über die Management-API, ohne die Migrationshistorie anzufassen:

```
npx supabase db query --linked --project-ref rilknynqwzamgpimniyz -f supabase/migrations/00NN_name.sql
```

Lesende Prüfung genauso, mit SQL statt `-f` (z. B. `select … from information_schema.columns …`). Regeln:
- **Nie `supabase db push`** — die Historie der Datenbank kennt die früheren Migrationen nicht (sie liefen im
  SQL-Editor); `push` würde ab 0001 alles nochmals ausführen.
- Jede Migration wiederholbar schreiben (`if not exists`, `create or replace`, `drop … if exists`) und vorher lesend
  prüfen, was sie antrifft (z. B. Funktionen mit anderen Parameternamen → `create or replace` scheitert).
- Eine Datei läuft als ein Block: scheitert eine Zeile, bleibt die ganze Datei draussen. Danach mit einer Abfrage
  bestätigen, nicht glauben.
- Am Ende einer Migration mit neuen Spalten/Tabellen: `notify pgrst, 'reload schema';`.
- **Stand:** 0001–0048 sind eingespielt (0048 = Regie lesen nur Büro, am 24.10.2026 nach zurückgerolltem Test mit Büro, Chefmonteur, Monteur und fremder Firma; 0034 neue Fassung, 0035–0039 am 11.10.2026, 0040–0044 am 13.10.2026, 0045/0046 am 14.10.2026, 0047 am 15.10.2026; 0044 = Pause am Morgen mit eigenem Beginn `znueni_von_min`, Dauer 5–60 Min., Ende ≤ 12:00 — gespeichert beides zusammen über `znueniSetzen`). 0047 = Arbeitsbeginn und Mittag je Firma, beide Firmen auf 7:00 / 12–13; Prüfregeln vorher zurückgerollt getestet.
- Eine Migration mit Rechten zuerst **zurückgerollt testen**: Migration + Testfälle je Rolle (`set local role
  authenticated` + `request.jwt.claims`) in eine Datei, am Ende `raise exception` mit den Ergebnissen — der Fehler
  rollt alles zurück und zeigt, was erlaubt/gesperrt war. So geprüft: 0041 (34 Fälle), 0042 (8 Fälle).
- Edge Functions genauso: `npx supabase functions deploy <name> --project-ref rilknynqwzamgpimniyz --use-api`. Vorher
  die laufende Fassung mit `functions download … --workdir <tmp>` holen und mit dem Repo vergleichen.

## Dateikarte

```
src/seiten/Ansicht.tsx            Erste Seite: Welche Ansicht? (vier Knöpfe, kein Login)
src/seiten/Start.tsx              Verteiler je Ansicht; Bauführer-Dashboard: Teams heute, Vorwoche zu prüfen, Überstunden offen, Diagramm, Team-Board
src/seiten/StartChef.tsx          Chefmonteur: Team, heute, laufende Woche
src/seiten/StartMonteur.tsx       Monteur: «Meine Woche» — eigene Stunden (mit Zeiten), nur lesen
src/seiten/StartSekretariat.tsx   Sekretariat: Stunden je Mitarbeiter, Temporärbüros, Export, Verwaltung
src/lib/ansicht.ts                Ansicht lesen/setzen, Seiten je Ansicht (seitenFuer — hängt an den Schaltern)
src/lib/einstellungen.ts          Schalter der angemeldeten Firma: lesen, zwischenspeichern, setzen
src/lib/konto.ts                  Anmelden, abmelden, «ist jemand angemeldet», personLaden (persönlicher Zugang → feste Ansicht)
src/seiten/Anmelden.tsx           Anmeldung der Firma — die erste Seite
src/seiten/verwaltung/Konto.tsx   Im Mitarbeiter-Dialog: Benutzerkonto anlegen, Passwort neu, löschen (RPCs aus 0034)
src/lib/benutzername.ts           vorname.nachname, Adresse mit Firmen-Domain, Passwortvorschlag (+ Tests)
src/seiten/verwaltung/Einstellungen.tsx  Die drei Schalter umlegen (lädt die App danach neu)
src/ui/Karten.tsx                 NavKarte, Kachel, MONATE — gemeinsam für alle Startseiten
src/seiten/Tag.tsx                Tagesübersicht: welche Teams haben gemeldet, welche nicht
src/seiten/Erfassung.tsx          Teamgerät: Kacheln, Anwesenheit (+ Gäste), Stundenzahl oder Zeiten von–bis, Sprachnotiz als Bemerkung zum Tag, Fotos
src/seiten/Cockpit.tsx            Wochenübersicht: Raster Team × Tag (Farbe = Stand), Tag öffnen = Personen mit Stunden/Zeiten, Korrektur, Überstunden-Karte, Bemerkung, Freigabe
src/seiten/Export.tsx             Bauführer: SORBA-Raster. Sekretariat: dazu Lohn, Überstunden, je Temporärbüro und je Subunternehmer eigenes Excel
src/seiten/verwaltung/*           Mitarbeitende, Teams, Kunden, Baustellen, Demo (auf Amirs PC nur Demo.tsx und Kunden.tsx, Rest nur auf GitHub)
src/lib/excel.ts                  Excel-Ausgabe mit ExcelJS: Blätter Lohn, Überstunden, je Büro, SORBA-Raster — Layout, Formeln, Druck
src/lib/db.ts                     Dexie-Queue: Meldungen + Zeiteinträge + Audio + Fotos + Zusatzaufträge (Version 5)
src/lib/zeiten.ts                 Zeiten von–bis: Uhrzeit ↔ Minuten, Spannen summieren (ohne Pausenrechnung), Mittag-Hinweis, Normal/Über aufteilen + Tests
src/lib/lohn.ts                   Lohn-/Temporärbüro-/Subunternehmer-/Überstunden-Aggregation (reine Funktionen) + Tests
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
src/seiten/Planung.tsx            Regie-Modus: Planung Team × Tag (ersetzt 06.10.2026 das Board) — Einsatz für Tag/Woche/länger planen, ändern, entfernen; schreibt jahresplan + planaenderung
src/lib/planung.ts                Spuren, Ausschnitt, Schnellwahl der Zeiträume (+ Tests)
src/seiten/Bestaetigung.tsx       Kundenlink ohne Login (/b/:token) — nur im Regie-Modus
src/lib/datum.ts                  Wochen-/Datumshelfer, NORMALTAG_MIN
src/lib/foto.ts                   Fotos verkleinern (1600 px, JPEG) vor Queue/Upload
src/ui/Diagramm.tsx               DiagrammKarte, WochenTeams — je Tag eine Zeile mit Spur (Flächen, keine Bibliothek, kein SVG)
src/ui/TeamBoard.tsx              Tagesstand aller Teams (gemeldet / Überstunden / noch nicht)
src/ui/FotoGalerie.tsx            Vorschau aus dem Bucket «anhaenge» (signierte Links)
src/ui/Sprachnotiz.tsx            Pegelbalken während der Aufnahme, Text-Enthüllung nach dem Speichern
src/ui/Shell.tsx                  Rahmen: Büro-Ansichten mit Bereichsleiste (md) / Seitenleiste (lg), Baustellen-Ansichten Handy-Spalte
supabase/functions/transkribieren Sprachnotiz → Text (Mistral)
supabase/migrations/              0001–0015 historisch (inkl. Regie-Tabellen) · 0016 Zeiten von–bis · 0017 Firmen-Schalter (durch 0019 abgelöst) · 0019 mehrere Firmen, Rechte je Firma · 0020 Dateien und Rapportnummern je Firma · 0021 Briefkopf je Firma · 0026 normaler Arbeitstag je Firma · 0027 Zusatzauftrag «erledigt» ohne Regie · 0028 «Gelb markieren ab» je Firma · 0029 dritte Zeitspanne (Znüni-Pause abziehen) · 0030 absichtlich leer · 0031 Korrekturen nach normalem Arbeitstag der Firma · 0032 Einladung und Gerät (verworfen) · 0033 persönliche Zugänge, entfernt 0032 wieder · 0034 Konten aus der Verwaltung, Mail-Domain je Firma, inaktiv = kein Zugang · 0035 Funktionen nie ohne Anmeldung · 0036 Wünsche Arbnor/Mehmeti 10.10. (Pause je Firma, Lieferwagen, Abwesenheiten, Einsatz je Person) · 0037 Spanisch (es, Azure es-ES) · 0038 Verlauf der Planung (plan_verlauf + Auslöser) · 0039 Demo: Verlauf nach «Demo laden» leeren · 0040 Firma der Subunternehmer · 0041 Rechte je Rolle · 0042 Dateien am Regierapport · 0043 Meldung ersetzen in einer Transaktion · 0044 Pause am Morgen frei einstellbar · 0045 Sprachnotiz Pflicht ab (Grenze je Firma) · 0046 dieselbe Grenze als Tagestotal · 0047 Arbeitsbeginn und Mittag je Firma (Pause im Vormittag der Firma) · 0048 Regie-Beträge liest nur das Büro — **nächste freie Nummer: 0049** (vor dem Anlegen `git pull`, damit nicht zwei dieselbe Nummer nehmen)
archiv/regie-und-board/           Stand vom 20.09. als Nachschlagewerk — nicht mehr die Quelle (Regie ist zurück, hinter Schaltern)
```

## Produktions-Check 13.10.2026 — Regeln, die seither gelten

Amir: «Die App darf keine Fehler haben.» Fünf Prüfungen (Senden, 1000-Zeilen-Grenze, Datum/Geld, Sicherheit, Abläufe).
Was daraus als Regel bleibt:
- **Nie mehr als 1000 Zeilen erwarten.** Die API schneidet still ab, `.limit(5000)` hilft nicht. Alles, was wachsen
  kann, mit `alle()` aus `lib/abfrage.ts` (seitenweise, zuletzt nach `id` sortiert); lange `.in()`-Listen mit `stuecke()`.
- **Büroseiten frisch halten:** `useAuffrischen()` (sichtbar/Fokus/alle 5 Min., still) und `useNeuesteAnfrage()` gegen
  langsame Antworten beim schnellen Blättern (`lib/auffrischen.ts`). Fehler anzeigen, nie als «keine Daten» tarnen.
- **Export:** Anker Montag (Woche) bzw. der 1. (Monat) — `lib/zeitraum.ts`; Excel lädt vorher neu, «Stand» = Ladezeit.
- **Wochenübersicht:** Zeilen nach dem Team der *Meldung*, nicht der Person (Gäste, Versetzte); inaktive Teams mit
  Stunden bleiben sichtbar.
- **Warteschlange am Handy** (`lib/db.ts`): jeder Eintrag kennt Firma und Benutzer und geht nur mit dieser Firma raus;
  nichts wird verworfen (abgelehnte Zeile/Kopf → Grund am Bildschirm, Chefmonteur entscheidet); eine Sperre
  (`exklusiv`) für Senden/Ändern/Ersetzen; Senden bei Sichtbarkeit und alle 60 s; Zeitlimits in `supabase.ts`.
  «Frühere ersetzen» nur über `tagesmeldung_entfernen` (0043, prüft und löscht in einer Transaktion) — Meldungen mit
  Freigabe, Korrektur, Fotos, Sprachnotiz oder Rapport werden nie ersetzt.
- **App-Update** (`registerType: 'prompt'`, `lib/aktualisierung.ts`): nie mitten in einer Meldung; im Hintergrund oder
  beim Seitenwechsel, spätestens nach einem halben Tag.
- **Abmelden** räumt `teamgeraet-*`, Baustellen-Zwischenspeicher und Ansicht weg und warnt bei ungesendeten Meldungen.
- **Überstunden bei zwei Meldungen am Tag:** der Normaltag zählt über alle Meldungen der Person (`lib/tagesrest.ts`).
- **Regie-Beträge** = Menge (Hundertstel) × Ansatz, nicht Minuten × Ansatz — sonst stimmt die PDF-Zeile nicht.
- **Nachtragen** höchstens 7 Tage zurück, überall dieselbe Regel (`lib/nachtrag.ts`).

## Offene Entscheidungen (nicht raten — nachfragen oder Annahme markieren)

- Transkriptions-Anbieter für 13 Sprachen (Spike mit echten Aufnahmen ausstehend)
- Mittag unbezahlt — Annahme Amir, mit Arbnor bestätigen; weitere Pausen? (Uhrzeiten stellt seit 0047 jede Firma selbst ein.)
- öV ganz weg oder nur nicht Vorgabe?
- Sieht der Bauführer alle Baustellen oder nur seine? (Rechte pro Bauführer)
- ~~Login pro Rolle vor echten Kundendaten~~ — erledigt: persönliche Konten (0033/0034), Rechte je Rolle (0041)
- SORBA hat **keinen Import** (Arbnor, 27.08.) — die Rasteransicht ist der Endzustand.
