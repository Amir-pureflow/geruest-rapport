/**
 * Wörterbuch der albanischen Oberfläche (Baustelle: Chefmonteur, Teamgerät, Monteur — siehe albanisch.ts).
 * Schlüssel = sichtbarer deutscher Text eines Textknotens (Leerraum zusammengefasst), Wert = Albanisch (Standard,
 * einfache Sätze). Texte mit Zahlen, Namen und Daten über MUSTER. Fehlt etwas, bleibt es deutsch.
 *
 * Begriffe (bitte mit Leuten von der Baustelle prüfen, Testfassung 19.11.2026):
 *   Baustelle = kantier · Team = ekip · Chefmonteur = shefi i ekipit · Monteur = montues · Bauführer = shefi i kantierit
 *   Büro = zyra · Tag melden = Raporto ditën · Meldung = raport · Überstunden = orë shtesë · Sprachnotiz = mesazh zanor
 *   freigegeben = aprovuar · Wochenübersicht = pasqyra javore · Gast = ndihmës · Regie bleibt «Regie» (Wort der Baustelle)
 * Nicht übersetzt: Baustelle, Adresse, Treffpunkt («Werkhof»), Hinweise des Büros, Namen — mit Absicht (Erin 19.11.2026).
 */
import type { Muster } from './uebersetzer';

const TAG_KURZ: Record<string, string> = { Mo: 'Hën', Di: 'Mar', Mi: 'Mër', Do: 'Enj', Fr: 'Pre', Sa: 'Sht', So: 'Die' };
const TAG_LANG: Record<string, string> = {
  Montag: 'E hënë', Dienstag: 'E martë', Mittwoch: 'E mërkurë', Donnerstag: 'E enjte', Freitag: 'E premte', Samstag: 'E shtunë', Sonntag: 'E diel',
};
/** Sprache der Sprachnotiz, wie sie im Satz steht («Auf Albanisch sprechen» → «Fol shqip»). */
const SPRACHE: Record<string, string> = {
  Deutsch: 'gjermanisht', Albanisch: 'shqip', Portugiesisch: 'portugalisht', Italienisch: 'italisht', Französisch: 'frëngjisht',
  Spanisch: 'spanjisht', Arabisch: 'arabisht', Polnisch: 'polonisht', Englisch: 'anglisht',
};

/** Wochentage, «heute», «morgen» in einem Stück Text (Tag in Posteingang und Plan-Hinweisen). */
export function tageImText(s: string): string {
  return s
    .replace(/\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/g, (t) => TAG_LANG[t])
    .replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)(?= \d)/g, (t) => TAG_KURZ[t])
    .replace(/^heute$/, 'sot').replace(/^morgen$/, 'nesër').replace(/^Heute$/, 'Sot').replace(/^Morgen$/, 'Nesër')
    .replace(/\bgestern\b/, 'dje');
}

const ART: Record<string, string> = {
  ferien: 'pushime', krank: 'i sëmurë', unfall: 'aksident', 'militär / zs': 'ushtria / mbrojtja civile', feiertag: 'festë',
  todesfall: 'vdekje në familje', 'freier tag': 'ditë e lirë', unbezahlt: 'pa pagesë', 'fehlt gemeldet': 'mungesë e lajmëruar',
};
const sprache = (s: string) => SPRACHE[s] ?? s;
const h = (s: string) => s.replace(/ h Überstunden\b/g, ' orë shtesë').replace(/\bnormaler Tag\b/g, 'ditë normale')
  .replace(/· Lieferwagen gebraucht/g, '· furgoni u përdor').replace(/\(normaler Tag war schon gemeldet\)/g, '(dita normale ishte raportuar më parë)')
  .replace(/\bim Team\b/g, 'në ekip').replace(/\bje Person\b/g, 'për person');

export const WOERTER = new Map<string, string>(Object.entries({
  // ── Kopf, Menü, Konto ──
  'Angemeldet': 'I kyçur', 'angemeldet als': 'i kyçur si', 'Angemeldet als': 'I kyçur si', 'Ansicht wechseln': 'Ndrysho pamjen',
  'Abmelden': 'Dil', 'Trotzdem abmelden': 'Dil gjithsesi', 'Posteingang': 'Njoftimet', 'Übersicht': 'Pasqyra', 'Erfassung': 'Regjistrimi',
  'Chefmonteur': 'Shefi i ekipit', 'Monteur': 'Montues', 'Bauführer': 'Shefi i kantierit', 'Detail': 'Detaje',
  // «Noch 2 Meldung|en nicht gesendet» — die Endung steht als eigener Textknoten da
  'Noch': 'Edhe', 'Meldung': 'raport', 'en': 'e', 'Meldungen': 'raporte', 'warten': 'në pritje',
  'nicht gesendet — trotzdem abmelden? Sie bleiben auf diesem Gerät und gehen raus, sobald diese Firma wieder angemeldet ist.':
    'pa u dërguar — të dalësh gjithsesi? Mbeten në këtë pajisje dhe dërgohen sapo kjo firmë të kyçet përsëri.',
  'nicht gesendet — trotzdem abmelden? Sie bleiben auf diesem Gerät und gehen raus, sobald die Firma hier wieder angemeldet ist.':
    'pa u dërguar — të dalësh gjithsesi? Mbeten në këtë pajisje dhe dërgohen sapo firma të kyçet përsëri këtu.',
  'Diese Adresse gibt es nicht.': 'Kjo faqe nuk ekziston.', '‹ Zur Übersicht': '‹ Te pasqyra',
  'Dein Zugang ist nicht aktiv': 'Qasja jote nuk është aktive',
  'Bitte im Büro melden. Sobald du dort wieder aktiv gesetzt bist, geht es hier weiter.': 'Të lutem lajmërohu në zyrë. Sapo të aktivizohesh përsëri, vazhdon këtu.',

  // ── Allgemein ──
  'Heute': 'Sot', 'heute': 'sot', 'Morgen': 'Nesër', 'morgen': 'nesër', 'Übermorgen': 'Pasnesër', 'gestern': 'dje',
  'Abbrechen': 'Anulo', 'Zurück': 'Kthehu', 'Schliessen': 'Mbyll', 'Speichern': 'Ruaj', 'Speichert …': 'Po ruhet …',
  'Nochmals': 'Provo përsëri', 'Nochmals versuchen': 'Provo përsëri', 'Lädt …': 'Po ngarkohet …', 'lädt …': 'po ngarkohet …',
  'Einen Moment …': 'Një moment …', 'Sendet …': 'Po dërgohet …', 'Erledigt': 'U krye', 'Neu': 'Të reja', 'Früher': 'Më parë',
  'Team': 'Ekipi', 'Baustelle': 'Kantieri', 'Person': 'Person', 'Pers.': 'pers.', 'Pers. zusammen': 'pers. gjithsej', 'Name': 'Emri',
  'Woche': 'Java', 'Diese Woche': 'Këtë javë', 'von': 'nga', 'bis': 'deri', 'ab': 'nga ora', 'je': 'për', 'Jemand': 'Dikush',
  'online': 'online', 'offline': 'pa internet', 'wartet': 'në pritje', 'gesendet': 'dërguar', 'gemeldet': 'raportuar',
  'geplant': 'planifikuar', 'neu geplant': 'planifikuar rishtas', 'zuletzt': 'së fundmi', 'eingegeben': 'shkruar', 'leer': 'fshij',
  'freiwillig': 'vullnetare', 'Pflicht': 'Detyrim', 'Foto': 'Foto', 'Fotos': 'Foto', 'temp': 'temp', 'Gast': 'Ndihmës',
  'eingeteilt': 'i caktuar', 'Normal': 'Normale', 'Überstunden': 'Orë shtesë', 'Überstunden ': 'orë shtesë ', 'Zeiten': 'Oraret',
  'Abweichung': 'Ndryshim', 'Regie': 'Regie', 'länger': 'më gjatë', 'Kunde': 'Klienti', 'Zusatzarbeit': 'Punë shtesë',
  'Kopiert ✓': 'U kopjua ✓', 'Teilen': 'Ndaj', 'Navigieren': 'Navigo', '· Ort nicht geprüft': '· vendi nuk është kontrolluar',
  'Treffpunkt': 'Vendtakimi', 'Mo': 'Hën', 'Di': 'Mar', 'Mi': 'Mër', 'Do': 'Enj', 'Fr': 'Pre', 'Sa': 'Sht', 'So': 'Die',
  'Montag': 'E hënë', 'Dienstag': 'E martë', 'Mittwoch': 'E mërkurë', 'Donnerstag': 'E enjte', 'Freitag': 'E premte',
  'Samstag': 'E shtunë', 'Sonntag': 'E diel', 'Auto': 'Vetura', 'öV': 'Transport publik', '· öV': '· transport publik',
  'Escape': 'Escape',

  // ── Abwesenheiten (Pillen) ──
  'Ferien': 'Pushime', 'Krank': 'I sëmurë', 'Unfall': 'Aksident', 'Militär / ZS': 'Ushtria / MC', 'Feiertag': 'Festë',
  'Todesfall': 'Vdekje në familje', 'Freier Tag': 'Ditë e lirë', 'Unbezahlt': 'Pa pagesë', 'Fehlt gemeldet': 'Mungesë e lajmëruar',

  // ── Startseite Chefmonteur ──
  'Welches Team?': 'Cili ekip?', 'Einmal wählen — das Gerät merkt es sich. Das ist dann auch das Team in der Erfassung.':
    'Zgjidhe një herë — pajisja e mban mend. Ky është pastaj edhe ekipi në regjistrim.',
  'Einmal wählen — das Gerät merkt es sich.': 'Zgjidhe një herë — pajisja e mban mend.',
  'Zuletzt auf diesem Gerät': 'Së fundmi në këtë pajisje', 'Alle Teams': 'Të gjitha ekipet', 'Weitere Teams …': 'Ekipe të tjera …',
  '· zuletzt': '· së fundmi', 'Teams konnten nicht geladen werden.': 'Ekipet nuk u ngarkuan.',
  'Verbindung prüfen und nochmals versuchen.': 'Kontrollo lidhjen dhe provo përsëri.',
  'Keine Teams — als Bauführer unter Verwaltung anlegen': 'Nuk ka ekipe — shefi i kantierit i krijon te Administrimi',
  'Keine Teams — unter Verwaltung anlegen': 'Nuk ka ekipe — krijoji te Administrimi', 'oder den Demo-Betrieb laden': 'ose ngarko demon',
  'kein Chefmonteur': 'pa shef ekipi', 'Team wechseln': 'Ndrysho ekipin', 'Plan geändert': 'Plani ndryshoi',
  'Woche konnte nicht geladen werden.': 'Java nuk u ngarkua.', 'Gezeigt wird, was auf diesem Gerät liegt.': 'Shfaqet ajo që është në këtë pajisje.',
  'Keine Baustelle geplant — du wählst sie beim Melden.': 'Nuk është planifikuar kantier — e zgjedh kur raporton.',
  'Ändern oder nochmals melden': 'Ndrysho ose raporto përsëri', 'Tag melden': 'Raporto ditën',
  'Woanders gewesen? Andere Baustelle ›': 'Ishit diku tjetër? Kantier tjetër ›', 'Zurück zu heute': 'Kthehu te sot',
  'Noch keine Baustelle geplant — das Büro plant noch.': 'Ende nuk është planifikuar kantier — zyra po planifikon.',
  'Noch keine Baustelle geplant.': 'Ende nuk është planifikuar kantier.',
  'Teilen ging nicht — der Browser erlaubt es hier nicht.': 'Ndarja nuk funksionoi — shfletuesi nuk e lejon këtu.',
  'Tagen gemeldet': 'ditë të raportuara', 'nachtragen ›': 'plotëso ›', 'Bauführer:': 'Shefi i kantierit:',
  'vom Bauführer freigegeben': 'aprovuar nga shefi i kantierit', 'Stunden je Person': 'Orët për person',
  'Älter als 7 Tage: nachtragen macht der Bauführer': 'Më e vjetër se 7 ditë: e plotëson shefi i kantierit',
  'Vom Kunden bestellt': 'Porositur nga klienti', 'schon gemeldet': 'raportuar tashmë', 'noch nicht gesendet': 'ende pa u dërguar',
  'Gemacht? Am Abend bei «Tag melden» als Überstunden eintragen, bei «War das Regie?» Ja tippen — mit Foto.':
    'E bëtë? Në mbrëmje te «Raporto ditën» shënoje si orë shtesë, te «A ishte Regie?» prek Po — me foto.',
  'Fehlt jemand? Namen antippen — das Büro sieht es sofort.': 'Mungon dikush? Prek emrin — zyra e sheh menjëherë.',
  '«Fehlt» für': '«Mungon» për', 'zurücknehmen?': 'ta tërheqësh?', 'fehlt': 'mungon', '· fehlt': '· mungon',
  'Zurücknehmen': 'Tërhiq', 'Fehlt melden': 'Lajmëro mungesën', 'Gemeldet — das Büro sieht es sofort und plant Ersatz.':
    'U lajmërua — zyra e sheh menjëherë dhe planifikon zëvendësim.',
  'Keine Verbindung — bitte im Büro anrufen.': 'Nuk ka lidhje — të lutem telefono zyrën.',
  'Ohne Netz — bitte im Büro anrufen.': 'Pa internet — të lutem telefono zyrën.',
  'Das geht noch nicht (Migration 0053 fehlt) — bitte anrufen.': 'Kjo ende nuk funksionon — të lutem telefono.',
  'Keine Verbindung.': 'Nuk ka lidhje.', 'Das Büro hat die Meldung schon bearbeitet — bitte anrufen.': 'Zyra e ka përpunuar tashmë lajmërimin — të lutem telefono.',
  'andere Baustelle': 'kantier tjetër', 'keine Baustelle geplant': 'nuk është planifikuar kantier', 'einem anderen Team': 'një ekip tjetër',
  'unbekannter Tag': 'ditë e panjohur', 'keine Antwort': 'pa përgjigje',
  // Warteschlange
  'noch nicht gesendet — geht automatisch raus.': 'ende pa u dërguar — dërgohet automatikisht.', 'Letzter Versuch': 'Përpjekja e fundit',
  'Meldung vom': 'Raporti i', 'konnte nicht gesendet werden': 'nuk mund të dërgohej', 'nicht ganz gesendet': 'nuk u dërgua plotësisht',
  'Beiseitelegen? Die Meldung wird nicht mehr gesendet, bleibt aber mit Sprachnotiz und Fotos auf diesem Gerät. Danach den Tag neu melden.':
    'Ta lësh mënjanë? Raporti nuk dërgohet më, por mbetet me mesazhin zanor dhe fotot në këtë pajisje. Pastaj raporto ditën përsëri.',
  'Ja, beiseitelegen': 'Po, lëre mënjanë', 'Beiseitelegen …': 'Lëre mënjanë …', 'einer anderen Anmeldung': 'një kyçjeje tjetër',
  'auf diesem Gerät —': 'në këtë pajisje —', 'sie geht': 'dërgohet', 'sie gehen': 'dërgohen',
  'raus, sobald diese Firma hier wieder angemeldet ist.': 'sapo kjo firmë të kyçet përsëri këtu.',

  // ── Startseite Monteur ──
  'Wer bist du?': 'Kush je ti?', 'Zuerst dein Team, dann dein Name. Das Gerät merkt es sich.': 'Së pari ekipi yt, pastaj emri yt. Pajisja e mban mend.',
  'Niemand in diesem Team.': 'Nuk ka askënd në këtë ekip.', 'Meine Woche': 'Java ime', 'Nicht ich': 'Nuk jam unë', '· jetzt': '· tani',
  'h normal': 'orë normale', 'h Überstunden': 'orë shtesë', 'Tag': 'ditë', 'Tage': 'ditë', 'Tagen': 'ditë',
  ', vom Büro eingetragen': ', shënuar nga zyra', 'vom Büro eingetragen': 'shënuar nga zyra',
  '✓ vom Bauführer angeschaut': '✓ e pa shefi i kantierit', 'noch nicht vom Bauführer angeschaut': 'shefi i kantierit ende nuk e ka parë',
  'nicht geladen': 'nuk u ngarkua', 'nichts gemeldet': 'asgjë e raportuar', 'Bauführer hat angepasst': 'Shefi i kantierit ndryshoi',
  'inkl. Überstunden': 'me orët shtesë', '✓ angeschaut': '✓ parë',
  '«✓ angeschaut» heisst: der Bauführer hat die Stunden geprüft. Stimmt etwas nicht, sag es deinem Chefmonteur.':
    '«✓ parë» do të thotë: shefi i kantierit i ka kontrolluar orët. Nëse diçka nuk është në rregull, thuaja shefit të ekipit.',
  'Dein Name konnte gerade nicht geladen werden — Verbindung prüfen.': 'Emri yt nuk u ngarkua — kontrollo lidhjen.',
  'Die Teams konnten nicht geladen werden — Verbindung prüfen und nochmals versuchen.': 'Ekipet nuk u ngarkuan — kontrollo lidhjen dhe provo përsëri.',
  'Deine Stunden konnten gerade nicht geladen werden — Verbindung prüfen und nochmals versuchen.': 'Orët e tua nuk u ngarkuan — kontrollo lidhjen dhe provo përsëri.',
  'Die Anpassungen des Bauführers konnten nicht geladen werden — die Stunden unten sind die gemeldeten.':
    'Ndryshimet e shefit të kantierit nuk u ngarkuan — orët më poshtë janë ato të raportuara.',

  // ── Posteingang ──
  'Nichts Neues': 'Asgjë e re', '1 neu': '1 e re', 'Alle gelesen': 'Të gjitha të lexuara', 'Einträge der letzten 30 Tage.': 'Njoftimet e 30 ditëve të fundit.',
  'Posteingang konnte gerade nicht geladen werden.': 'Njoftimet nuk u ngarkuan.', 'Ohne Netz — gezeigt wird der letzte Stand.': 'Pa internet — shfaqet gjendja e fundit.',
  'Hier erscheint, wenn das Büro den Plan für heute oder den nächsten Arbeitstag ändert, jemand fehlt oder Stunden korrigiert werden.':
    'Këtu shfaqet kur zyra ndryshon planin për sot ose për ditën e ardhshme të punës, kur mungon dikush ose kur korrigjohen orët.',
  'Hier erscheint, wenn du in einem anderen Team eingeteilt wirst oder das Büro deine Stunden korrigiert.':
    'Këtu shfaqet kur caktohesh në një ekip tjetër ose kur zyra i korrigjon orët e tua.',
  'gerade eben': 'tani', 'Beginn wieder wie immer': 'Fillimi përsëri si zakonisht', 'Hinweis entfernt': 'Shënimi u hoq',
  'Du bist in keinem Team eingeteilt': 'Nuk je caktuar në asnjë ekip', 'Vom Team gemeldet': 'Lajmëruar nga ekipi',
  'Ersatz vorschlagen und eintragen →': 'Propozo dhe shëno zëvendësim →', 'Noch nicht bestätigt': 'Ende pa u konfirmuar',

  // ── Erfassung: Kopf, Baustelle ──
  'Nachtrag — nicht heute': 'Plotësim — jo sot', '· ändern': '· ndrysho', 'Heute schon gemeldet': 'Sot është raportuar tashmë',
  'vom Bauführer freigegeben — kann hier nicht mehr ersetzt werden': 'aprovuar nga shefi i kantierit — nuk mund të zëvendësohet më këtu',
  'kommt nicht durch — Grund steht oben': 'nuk po kalon — arsyeja është lart', 'wartet auf Netz': 'pret internetin',
  'kommt nicht durch — siehe Startseite': 'nuk po kalon — shih faqen kryesore',
  'Etwas falsch? Unten richtig eintragen, «Tag melden» und dann «Frühere ersetzen». Zweite Baustelle an diesem Tag? Unten eintragen und «Zusätzlich speichern». Einen anderen Tag vergessen? Oben mit dem Pfeil zurück.':
    'Diçka gabim? Shëno saktë më poshtë, «Raporto ditën» dhe pastaj «Zëvendëso të mëparshmin». Kantier i dytë në këtë ditë? Shëno më poshtë dhe «Ruaj shtesë». Ke harruar një ditë tjetër? Lart me shigjetën mbrapa.',
  'Ersetzen geht hier nicht mehr — Änderungen macht der Bauführer in der Wochenübersicht. Zweite Baustelle an diesem Tag? Unten antippen und speichern. Einen anderen Tag vergessen? Oben mit dem Pfeil zurück.':
    'Zëvendësimi nuk bëhet më këtu — ndryshimet i bën shefi i kantierit në pasqyrën javore. Kantier i dytë në këtë ditë? Prek më poshtë dhe ruaj. Ke harruar një ditë tjetër? Lart me shigjetën mbrapa.',
  'Zweite Baustelle an diesem Tag? Unten antippen und speichern. Einen anderen Tag vergessen? Oben mit dem Pfeil zurück.':
    'Kantier i dytë në këtë ditë? Prek më poshtë dhe ruaj. Ke harruar një ditë tjetër? Lart me shigjetën mbrapa.',
  'Konnte nicht prüfen, ob': 'Nuk u kontrollua nëse', 'an diesem Tag': 'në këtë ditë', 'schon gemeldet wurde': 'është raportuar tashmë',
  '— gezeigt ist der letzte bekannte Stand': '— shfaqet gjendja e fundit e njohur', '. Melden geht trotzdem.': '. Raportimi funksionon gjithsesi.',
  'Wo wart ihr?': 'Ku ishit?', '2. Baustelle': 'Kantieri i 2-të', 'andere Baustelle …': 'kantier tjetër …',
  'Zweite Baustelle wählen': 'Zgjidh kantierin e dytë', 'Nummer oder Name eintippen': 'Shkruaj numrin ose emrin',
  '903221 oder Aarstrasse': '903221 ose Aarstrasse', 'Nummer ab 3 Ziffern, Name ab 2 Buchstaben.': 'Numri nga 3 shifra, emri nga 2 shkronja.',
  'Keine Baustelle für «': 'Nuk u gjet kantier për «', '» gefunden.': '».', 'Liste zuklappen': 'Mbyll listën',
  'Alle Baustellen zeigen — zum Nachschauen': 'Shfaq të gjitha kantieret — për t’i parë',
  'Liste konnte nicht geladen werden — dafür braucht es Netz.': 'Lista nuk u ngarkua — për këtë duhet internet.',
  'aktive Baustellen, alphabetisch — oben tippen zum Filtern.': 'kantiere aktive, sipas alfabetit — shkruaj lart për të filtruar.',
  'Zweite Baustelle heute': 'Kantier i dytë sot', 'Zwei Baustellen laut Planung': 'Dy kantiere sipas planit', 'Zwei Baustellen heute': 'Dy kantiere sot',
  'Das Büro hat beide eingeplant. Stimmt die Wechselzeit nicht, unten ändern.': 'Zyra i ka planifikuar të dyja. Nëse ora e ndërrimit nuk është e saktë, ndryshoje më poshtë.',
  'Wechsel um': 'Ndërrimi në orën', 'Wechselzeit': 'Ora e ndërrimit',
  'Die Zeiten unten gelten für den ganzen Tag — die App teilt sie beim Wechsel auf die zwei Baustellen auf. Überstunden zählen über den ganzen Tag.':
    'Oraret më poshtë vlejnë për gjithë ditën — aplikacioni i ndan në orën e ndërrimit në dy kantieret. Orët shtesë llogariten për gjithë ditën.',

  // ── Erfassung Konzept C, Startseite (21.11.2026) ──
  'Zwei Baustellen': 'Dy kantiere', 'Zwei Baustellen laut Plan': 'Dy kantiere sipas planit', 'Nummer oder Name …': 'Numri ose emri …',
  'Alle Baustellen': 'Të gjithë kantieret', 'ändern': 'ndrysho', 'entfernen': 'hiq', 'Wechsel': 'Ndërrimi', '· laut Plan': '· sipas planit',
  'Arbeitszeit': 'Orari i punës', '+ Zeit ab': '+ Orar nga ora', '+ Zeit': '+ Orar', 'Zweite Baustelle': 'Kantieri i dytë',
  'Total pro Person': 'Gjithsej për person', '«bis» fehlt noch': 'mungon ende «deri»',
  'Stunden antippen = nur für diese Person': 'Prek orët = vetëm për këtë person', 'eigene Zeit': 'orar i veçantë',
  'wieder wie oben': 'përsëri si lart', 'Notiz zum Tag — freiwillig': 'Shënim për ditën — vullnetar',
  'geändert': 'ndryshuar', 'neu': 'e re', 'Beginn neu': 'fillim i ri', 'Treffpunkt neu': 'vendtakim i ri',
  'freigegeben': 'aprovuar', 'nachtragen': 'plotëso', 'Teilen — für den Team-Chat': 'Ndaj — për grupin e ekipit',
  'Navigieren · Ort nicht geprüft': 'Navigo · vendi nuk është kontrolluar',
  // ── Erfassung: Zeiten ──
  'Arbeitszeit — alle gleich': 'Orari i punës — të gjithë njësoj', '«bis» eintragen': 'shëno «deri»', '· Nachmittag: «bis» fehlt noch': '· Pasdite: mungon ende «deri»',
  '· davon': '· prej tyre', 'davon': 'prej tyre', 'Vormittag': 'Paradite', 'Nachmittag': 'Pasdite', '+ Nachmittag': '+ Pasdite', 'nach Pause': 'pas pausave',
  'Pause': 'Pushimi', '— er ist unbezahlt. Durchgearbeitet? Dann stimmt es so. Sonst Vormittag bis': '— ajo nuk paguhet. Keni punuar pa pushim? Atëherë është në rregull. Përndryshe paradite deri',
  'und Nachmittag ab': 'dhe pasdite nga',
  'An diesem Tag ist schon etwas gemeldet — was über den normalen Tag (': 'Për këtë ditë është raportuar tashmë diçka — ajo që kalon ditën normale (',
  'h) hinausgeht, zählt als Überstunden. Je Person steht es unten.': 'orë) llogaritet si orë shtesë. Për çdo person shënohet më poshtë.',

  // ── Erfassung: Leute ──
  'Wer war dabei': 'Kush ishte', 'Keine Mitglieder in diesem Team.': 'Nuk ka anëtarë në këtë ekip.', 'Person hinzufügen': 'Shto person',
  'Zuletzt dabei': 'Ishin së fundmi', 'Name tippen (nur Chefmonteur)': 'Shkruaj emrin (vetëm shefi i ekipit)', 'z. B. Mu': 'p.sh. Mu',
  'Ab 2 Buchstaben werden Personen gezeigt.': 'Personat shfaqen nga 2 shkronja.', 'Niemand mit «': 'Askush me «',
  '» gefunden — oder schon in der Liste.': '» — ose është tashmë në listë.', 'nicht dabei': 'nuk ishte', 'anderes Team': 'ekip tjetër', 'im Team': 'në ekip',
  'Lieferwagen der Firma gebraucht': 'U përdor furgoni i firmës', 'Nur antippen, wenn ihr ihn heute hattet —': 'Preke vetëm nëse e keni pasur sot —',
  'pro Tag.': 'në ditë.',

  // ── Erfassung: Sprachnotiz ──
  '— kurz sagen, warum': '— thuaj shkurt pse', 'Bemerkung zum Tag — freiwillig': 'Shënim për ditën — vullnetar',
  'Sprachnotiz ·': 'Mesazh zanor ·', 'Sek. ✓': 'sek. ✓', 'nochmal aufnehmen': 'regjistro përsëri',
  'Antippen und kurz erzählen, warum': 'Prek dhe trego shkurt pse', 'Antippen und kurz erzählen, was heute war': 'Prek dhe trego shkurt çfarë ndodhi sot',
  'Antippen und kurz erzählen, was war': 'Prek dhe trego shkurt çfarë ndodhi',
  'Mikrofon nicht verfügbar — Speichern geht trotzdem.': 'Mikrofoni nuk është në dispozicion — ruajtja funksionon gjithsesi.',
  'Fehlt noch — 10 Sekunden reichen, dann nochmals «Tag melden».': 'Mungon ende — mjaftojnë 10 sekonda, pastaj përsëri «Raporto ditën».',
  'Fehlt noch — 10 Sekunden reichen, dann nochmals «Speichern».': 'Mungon ende — mjaftojnë 10 sekonda, pastaj përsëri «Ruaj».',
  'Der Bauführer sieht die Überstunden mit deiner Notiz. Beim Melden fragt die App, ob es Regie war.':
    'Shefi i kantierit i sheh orët shtesë me shënimin tënd. Kur raporton, aplikacioni pyet nëse ishte Regie.',
  'Der Bauführer sieht die Überstunden mit deiner Notiz und gibt sie frei.': 'Shefi i kantierit i sheh orët shtesë me shënimin tënd dhe i aprovon.',
  'Der Bauführer liest die Notiz in der Wochenübersicht — z. B. Material fehlt, Kunde war da, früher Schluss.':
    'Shefi i kantierit e lexon shënimin në pasqyrën javore — p.sh. mungon materiali, klienti ishte aty, mbaruam më herët.',
  'Foto vom Stand heute — freiwillig, hilft dem Bauführer.': 'Foto e gjendjes së sotme — vullnetare, e ndihmon shefin e kantierit.',
  'Die App schreibt mit …': 'Aplikacioni po shkruan …', 'Wird für den Bauführer ins Deutsche übertragen …': 'Po përkthehet në gjermanisht për shefin e kantierit …',
  'Nach der Bestätigung übersetzt die App den Text für den Bauführer auf Deutsch. Die Aufnahme bleibt als Beleg.':
    'Pas konfirmimit aplikacioni e përkthen tekstin në gjermanisht për shefin e kantierit. Regjistrimi mbetet si dëshmi.',
  'Eigene Sprache': 'Gjuha jote', 'bestätigt ✓': 'konfirmuar ✓', 'Deutsch · liest der Bauführer': 'Gjermanisht · e lexon shefi i kantierit',
  'So liest es der Bauführer — hier korrigierbar.': 'Kështu e lexon shefi i kantierit — mund të korrigjohet këtu.',
  'Hier korrigierbar — gespeichert wird der deutsche Text, die Aufnahme bleibt als Beleg.': 'Mund të korrigjohet këtu — ruhet teksti gjermanisht, regjistrimi mbetet si dëshmi.',
  'Sprache ändern —': 'Ndrysho gjuhën —', 'Kein Netz — der Text kommt, sobald die Meldung gesendet ist.': 'Pa internet — teksti vjen sapo të dërgohet raporti.',
  'kein Text': 'pa tekst', 'Text konnte jetzt nicht erstellt werden — er kommt nach dem Senden.': 'Teksti nuk u krijua tani — vjen pas dërgimit.',
  'keine Übersetzung': 'pa përkthim', 'Übersetzung gerade nicht möglich, nochmals antippen.': 'Përkthimi nuk është i mundur tani, prek përsëri.',
  'Das Mikrofon ist für Rapporto gesperrt. In den Einstellungen des Handys das Mikrofon für diese App erlauben, dann nochmals antippen.':
    'Mikrofoni është i bllokuar për Rapporto. Lejoje mikrofonin për këtë aplikacion te cilësimet e telefonit, pastaj prek përsëri.',
  'Mikrofon nicht verfügbar — die Meldung geht auch ohne Sprachnotiz.': 'Mikrofoni nuk është në dispozicion — raporti dërgohet edhe pa mesazh zanor.',
  'Sprache konnte nicht gespeichert werden —': 'Gjuha nuk u ruajt —', 'Ein Bild konnte nicht gelesen werden.': 'Një foto nuk mund të lexohej.',
  // Sprachnotiz (Anzeige nach dem Speichern)
  'Sprachnotiz': 'Mesazh zanor', 'Gespeichert. Der Text entsteht, sobald die Meldung gesendet ist.': 'U ruajt. Teksti krijohet sapo të dërgohet raporti.',
  'Sprachnotiz · Text': 'Mesazh zanor · tekst', 'Aufnahme wird zu Text …': 'Regjistrimi po bëhet tekst …', 'So wurde es gesprochen': 'Kështu u fol',
  'Der Bauführer liest das in der Wochenübersicht. Die Aufnahme bleibt als Beleg.': 'Shefi i kantierit e lexon këtë në pasqyrën javore. Regjistrimi mbetet si dëshmi.',
  'Text konnte nicht erstellt werden. Die Aufnahme ist gespeichert, der Bauführer kann sie anhören.': 'Teksti nuk u krijua. Regjistrimi është ruajtur, shefi i kantierit mund ta dëgjojë.',
  'Die Aufnahme ist gespeichert. Der Text erscheint in Kürze in der Wochenübersicht des Bauführers.': 'Regjistrimi është ruajtur. Teksti shfaqet së shpejti në pasqyrën javore të shefit të kantierit.',
  'Deutsch': 'Gjermanisht', 'Albanisch': 'Shqip', 'Portugiesisch': 'Portugalisht', 'Italienisch': 'Italisht', 'Französisch': 'Frëngjisht',
  'Spanisch': 'Spanjisht', 'Arabisch': 'Arabisht', 'Polnisch': 'Polonisht', 'Englisch': 'Anglisht',

  // ── Erfassung: Melden, Speichern ──
  'An diesem Tag': 'Në këtë ditë', 'habt ihr schon gemeldet:': 'keni raportuar tashmë:', 'h für das Team zusammen.': 'orë për ekipin gjithsej.',
  'Prüfe, ob die frühere Meldung noch ersetzt werden kann …': 'Po kontrollohet nëse raporti i mëparshëm mund të zëvendësohet ende …',
  'Zusätzlich speichern (zweite Baustelle) · dann': 'Ruaj shtesë (kantier i dytë) · pastaj', 'Zusätzlich speichern (zweite Baustelle)': 'Ruaj shtesë (kantier i dytë)',
  'Frühere ersetzen': 'Zëvendëso të mëparshmin', 'Am Tag stehen dann': 'Për ditën pastaj janë', 'h (Team zusammen).': 'orë (ekipi gjithsej).',
  'Ersetzen geht hier nicht mehr:': 'Zëvendësimi nuk bëhet më këtu:', 'Änderungen an der früheren Meldung macht der Bauführer in der Wochenübersicht.':
    'Ndryshimet në raportin e mëparshëm i bën shefi i kantierit në pasqyrën javore.',
  '— war das Regie?': '— a ishte Regie?', 'Regie = Arbeit, die der Kunde zusätzlich wollte.': 'Regie = punë që klienti e kërkoi shtesë.',
  'Ja, Regie ausgeführt': 'Po, u krye Regie', 'Nein, nur länger gearbeitet': 'Jo, vetëm punuam më gjatë', 'Weiter zur Regie': 'Vazhdo te Regie',
  'Zuerst die Sprachnotiz — bei Überstunden Pflicht': 'Së pari mesazhi zanor — me orë shtesë është detyrim',
  'Zuerst die Baustelle antippen.': 'Së pari prek kantierin.', 'Zuerst anhaken, wer dabei war.': 'Së pari shëno kush ishte.',
  'Niemand angehakt.': 'Askush nuk është shënuar.', 'Niemand bei der Zusatzarbeit angehakt.': 'Askush nuk është shënuar te puna shtesë.',
  'Speichern fehlgeschlagen:': 'Ruajtja dështoi:', '— nochmals versuchen; die Aufnahme ist noch da.': '— provo përsëri; regjistrimi është ende aty.',
  'Lokal gespeichert …': 'U ruajt në pajisje …', 'Gespeichert ✓': 'U ruajt ✓', 'Abweichung gespeichert ✓': 'Ndryshimi u ruajt ✓',
  'Lokal gespeichert — Senden fehlgeschlagen': 'U ruajt në pajisje — dërgimi dështoi', '— noch nicht gesendet': '— ende pa u dërguar',
  'Gespeichert — wird gesendet, sobald Netz da ist': 'U ruajt — dërgohet sapo të ketë internet', '— wird gesendet, sobald Netz da ist': '— dërgohet sapo të ketë internet',
  'unbekannter Fehler': 'gabim i panjohur', 'Team nicht geladen': 'Ekipi nuk u ngarkua',
  'Team konnte nicht geladen werden — Netz prüfen und nochmals versuchen.': 'Ekipi nuk u ngarkua — kontrollo internetin dhe provo përsëri.',
  'Der Bauführer hat diese Meldung schon freigegeben.': 'Shefi i kantierit e ka aprovuar tashmë këtë raport.',
  'Konnte nicht prüfen, ob die frühere Meldung ersetzt werden darf.': 'Nuk u kontrollua nëse raporti i mëparshëm mund të zëvendësohet.',
  'Diese Meldung ist schon unterwegs zum Server und wurde nicht nochmals angelegt. Änderungen macht der Bauführer in der Wochenübersicht.':
    'Ky raport është tashmë rrugës për te serveri dhe nuk u krijua përsëri. Ndryshimet i bën shefi i kantierit në pasqyrën javore.',
  // Abschluss
  '✓ Gespeichert und gesendet': '✓ U ruajt dhe u dërgua', '✓ Gespeichert — wird gesendet, sobald Netz da ist': '✓ U ruajt — dërgohet sapo të ketë internet',
  'Gespeichert, aber noch nicht gesendet': 'U ruajt, por ende pa u dërguar', 'Das steht jetzt für heute': 'Kjo është tani për sot',
  'Der Bauführer sieht das in der Wochenübersicht. Ändern kann er es dort, bis er es freigibt.': 'Shefi i kantierit e sheh këtë në pasqyrën javore. Mund ta ndryshojë aty derisa ta aprovojë.',
  'Fertig für': 'Gati për', 'diesen Tag': 'këtë ditë', 'Noch etwas melden — zweite Baustelle': 'Raporto diçka tjetër — kantier i dytë',
  'Anderen Tag nachtragen': 'Plotëso një ditë tjetër',
  // Regie-Schritt (nur Regie-Modus)
  'Regie ausgeführt': 'U krye Regie', 'warten müssen': 'u desh të prisnim', 'etwas kaputt / repariert': 'diçka u prish / u riparua',
  'länger gearbeitet': 'punuam më gjatë', 'Wer wollte das?': 'Kush e kërkoi?', 'Unser Chef': 'Shefi ynë', 'unser Chef': 'shefi ynë', 'Niemand': 'Askush',
  'Kunde = der Bauleiter hat es angeordnet · Unser Chef = kam von uns · Niemand = selbst gemacht, meist weil etwas kaputt war':
    'Klienti = e urdhëroi udhëheqësi i ndërtimit · Shefi ynë = erdhi nga ne · Askush = e bëmë vetë, zakonisht sepse diçka ishte prishur',
  'Wie lange?': 'Sa gjatë?', 'Vorbelegt mit den Überstunden — die zählen dann hier, nicht doppelt.': 'Plotësuar me orët shtesë — ato llogariten këtu, jo dy herë.',
  'Gilt für alle — unten kann jede Person einzeln anders sein.': 'Vlen për të gjithë — më poshtë çdo person mund të jetë ndryshe.',
  'Wer war dabei · wie lange': 'Kush ishte · sa gjatë', 'Bitte Fotos machen — der Bauführer braucht Bilder bei Regie.': 'Të lutem bëj foto — shefi i kantierit ka nevojë për foto te Regie.',
  'Die App hört zu und schreibt danach mit.': 'Aplikacioni dëgjon dhe pastaj e shkruan.',
  'Stimmt das so? Sonst hier korrigieren.': 'A është shkruar saktë? Përndryshe korrigjoje këtu.', 'Stimmt so ✓': 'Po, në rregull ✓',
  '· Lieferwagen gebraucht': '· furgoni u përdor',

  // ── Nachtragen, Ersetzen ──
  'Der Tag in der Adresse ist ungültig — gezeigt wird heute.': 'Dita në adresë nuk është e vlefshme — shfaqet sot.',
  'Für einen Tag in der Zukunft lässt sich nichts melden — gezeigt wird heute.': 'Për një ditë në të ardhmen nuk mund të raportohet — shfaqet sot.',
  'Der Bauführer hat diese Meldung schon bearbeitet.': 'Shefi i kantierit e ka përpunuar tashmë këtë raport.',
  'Zu dieser Meldung gibt es schon einen Regierapport.': 'Për këtë raport ka tashmë një raport Regie.',
  'Diese Meldung hat Fotos — sie bleiben als Beleg.': 'Ky raport ka foto — ato mbeten si dëshmi.',
  'Diese Meldung hat eine Sprachnotiz — sie bleibt als Beleg.': 'Ky raport ka një mesazh zanor — ai mbetet si dëshmi.',
  'Gerade keine Verbindung zum Server — ob die Meldung schon beim Bauführer ist, lässt sich jetzt nicht prüfen.':
    'Tani nuk ka lidhje me serverin — nuk mund të kontrollohet nëse raporti është tashmë te shefi i kantierit.',
  'Ersetzen fehlgeschlagen:': 'Zëvendësimi dështoi:', 'Die neue Meldung ist nicht gespeichert.': 'Raporti i ri nuk është ruajtur.',

  // ── Senden (Warteschlange, lib/db.ts) ──
  'Keine Verbindung zum Server — die Meldung bleibt auf dem Gerät und geht automatisch raus.': 'Nuk ka lidhje me serverin — raporti mbetet në pajisje dhe dërgohet automatikisht.',
  'Keine Berechtigung — bitte neu anmelden.': 'Nuk ke leje — të lutem kyçu përsëri.', 'Upload fehlgeschlagen': 'Ngarkimi dështoi',
  'keine Verbindung zum Server, geht automatisch nochmals': 'nuk ka lidhje me serverin, provohet automatikisht përsëri',
  'Eine Zeile konnte nicht gesendet werden.': 'Një rresht nuk mund të dërgohej.', 'Bild konnte nicht gelesen werden': 'Foto nuk mund të lexohej',
  'Sprachnotiz konnte nicht verknüpft werden: die Meldung ist auf dem Server nicht zu finden. Sie bleibt auf dem Gerät.':
    'Mesazhi zanor nuk mund të lidhej: raporti nuk gjendet në server. Mbetet në pajisje.',
  'Keine Datenverbindung.': 'Nuk ka lidhje interneti.',

  // ── Startseite (Wahl der Ansicht) ──
  'Tagesmeldung, Stunden und Freigabe — ohne Papier, ohne Suchen.': 'Raporti ditor, orët dhe aprovimi — pa letra, pa kërkuar.',
}));

export const MUSTER: Muster[] = [
  // Erfassung Konzept C (21.11.2026): kurzer Hinweis zu Pause und Mittag, eigene Zeit einer Person
  [/^Pause (\S+) ist abgezogen, Mittag (\S+) frei\.$/, 'Pushimi $1 është zbritur, dreka $2 e lirë.'],
  [/^Mittag (\S+) ist frei\. Pause (\S+) nicht bezahlt\? «− Pause» tippen\.$/, 'Dreka $1 është e lirë. Pushimi $2 nuk paguhet? Shtyp «− Pushimi».'],
  [/^eigene Zeit · davon (.+) h Überstunden$/, 'orar i veçantë · prej tyre $1 orë shtesë'],
  // Datum mit Wochentag: «Mo 16.11.», «Do 19.11.2026», «Heute · Mo 16.11.»
  [/^(Mo|Di|Mi|Do|Fr|Sa|So) (\d{1,2}\.\d{1,2}\.(?:\d{4})?)$/, (_m, t, d) => `${TAG_KURZ[t]} ${d}`],
  [/^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)( \d{1,2}\.\d{1,2}\.)?$/, (_m, t, d) => `${TAG_LANG[t]}${d ?? ''}`],
  [/^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Heute|Morgen|heute|morgen)( \d{1,2}\.\d{1,2}\.)?:$/, (_m, t, d) => `${tageImText(t)}${d ?? ''}:`],
  [/^· (Mo|Di|Mi|Do|Fr|Sa|So) (\d{1,2}\.\d{1,2}\.)$/, (_m, t, d) => `· ${TAG_KURZ[t]} ${d}`],
  [/^gestern (\d{1,2}:\d{2})$/, 'dje $1'],
  [/^um (\d{1,2}:\d{2})$/, 'në $1'],
  [/^vor (\d+) Min\.$/, 'para $1 min.'],
  [/^geändert (.+)$/, (_m, r) => `ndryshuar ${tageImText(r)}`],
  [/^Ohne Netz — Stand von (.+)$/, 'Pa internet — gjendja nga $1'],
  // Zeiten und Stunden
  [/^ab (\d{1,2}:\d{2})$/, 'nga ora $1'],
  [/^bis (\d{1,2}:\d{2})$/, 'deri në $1'],
  [/^Beginn (\d{1,2}:\d{2}) statt (\d{1,2}:\d{2})$/, 'Fillimi $1 në vend të $2'],
  [/^Beginn (\d{1,2}:\d{2})$/, 'Fillimi $1'],
  [/^(\d+(?:\.\d+)?) h Überstunden je Person$/, '$1 orë shtesë për person'],
  [/^(\d+(?:\.\d+)?) h Überstunden im Team$/, '$1 orë shtesë në ekip'],
  [/^(\d+(?:\.\d+)?) h Überstunden$/, '$1 orë shtesë'],
  [/^davon (\d+(?:\.\d+)?) h Überstunden$/, 'prej tyre $1 orë shtesë'],
  [/^(\d+(?:\.\d+)?) \+ (\d+(?:\.\d+)?) h Überstunden$/, '$1 + $2 orë shtesë'],
  [/^Pause (.+) wieder zählen$/, 'Numëro përsëri pushimin $1'],
  [/^Pause (.+) abziehen$/, 'Zbrit pushimin $1'],
  [/^Der Mittag (.+) ist mitgezählt$/, 'Dreka $1 është numëruar'],
  [/^(\d+) Min\. vom Mittag \((.+)\) sind mitgezählt$/, '$1 min. nga dreka ($2) janë numëruar'],
  [/^Was hier steht, zählt\. Die Pause (\S+)–(\S+) ist schon abgezogen, Mittag (.+) ist als Lücke vorgegeben\. Unten kann jede Person anders sein\.$/,
    'Llogaritet ajo që shkruan këtu. Pushimi $1–$2 është zbritur tashmë, dreka $3 është lënë e lirë. Më poshtë çdo person mund të jetë ndryshe.'],
  [/^Die App zieht von sich aus keine Pause ab — was hier steht, zählt\. Mittag (.+) ist als Lücke vorgegeben\. Zahlt der Bauherr die Pause (\S+)–(\S+) nicht: «− Pause» tippen\. Unten kann jede Person anders sein\.$/,
    'Aplikacioni nuk zbret vetë asnjë pushim — llogaritet ajo që shkruan këtu. Dreka $1 është lënë e lirë. Nëse investitori nuk e paguan pushimin $2–$3: prek «− Pushimi». Më poshtë çdo person mund të jetë ndryshe.'],
  [/^− Pause$/, '− Pushimi'],
  // Leute, Team
  [/^· (\d+) Leute$/, '· $1 persona'],
  [/^Zurückgenommen — (.+) ist wieder dabei\.$/, 'U tërhoq — $1 është përsëri në ekip.'],
  [/^fehlt (heute|morgen|am .+)\?$/, (_m, t) => `mungon ${tageImText(t.replace(/^am /, 'të '))}?`],
  [/^in (Team .+)$/, 'në $1'],
  [/^→ (.+)$/, '→ $1'],
  [/^· (Ferien|Krank|Unfall|Militär \/ ZS|Feiertag|Todesfall|Freier Tag|Unbezahlt|Fehlt gemeldet)$/i, (_m, a) => `· ${ART[a.toLowerCase()] ?? a}`],
  // Warteschlange
  [/^Ohne (.+) abschliessen\? Die Stunden von (.+) an diesem Tag fehlen dann beim Bauführer — er kann sie in der Wochenübersicht nachtragen\. Die Meldung bleibt auf diesem Gerät gespeichert\.$/,
    'Ta mbyllësh pa $1? Orët e $2 për këtë ditë atëherë i mungojnë shefit të kantierit — ai mund t’i plotësojë në pasqyrën javore. Raporti mbetet i ruajtur në këtë pajisje.'],
  [/^Ja, ohne (.+) abschliessen$/, 'Po, mbylle pa $1'],
  [/^Ohne (.+) abschliessen …$/, 'Mbylle pa $1 …'],
  [/^von «(.+)»$/, 'nga «$1»'],
  // Erfassung
  [/^Konto-Nr\. (.+)$/, 'Nr. i kontos $1'],
  [/^Neuer Tag — jetzt gilt (.+)\.$/, (_m, t) => `Ditë e re — tani vlen ${tageImText(t)}.`],
  [/^Für (.+) schon gemeldet$/, (_m, t) => `Për ${tageImText(t)} është raportuar tashmë`],
  [/^Das steht jetzt für (.+)$/, (_m, t) => `Kjo është tani për ${tageImText(t)}`],
  [/^Nichts gefunden für «(.+)»\.$/, 'Nuk u gjet asgjë për «$1».'],
  [/^(\d+) Sek\. — antippen zum Stoppen$/, '$1 sek. — prek për ta ndalur'],
  [/^Auf (\S+) sprechen, 10 Sekunden reichen — der Bauführer liest es auf Deutsch\.$/, (_m, s) => `Fol ${sprache(s)}, mjaftojnë 10 sekonda — shefi i kantierit e lexon në gjermanisht.`],
  [/^Pflicht bei Regie — auf (\S+) sprechen, 10 Sekunden reichen\.$/, (_m, s) => `Detyrim te Regie — fol ${sprache(s)}, mjaftojnë 10 sekonda.`],
  [/^übersetzt aus (.+)$/, (_m, s) => `përkthyer nga ${sprache(s).replace(/sht$/, 'shtja')}`],
  [/^Original \((.+)\) anzeigen$/, (_m, s) => `Shfaq origjinalin (${sprache(s)})`],
  [/^Bei (.+) überschneiden sich Vormittag und Nachmittag — bitte Zeiten prüfen\.$/, 'Te $1 paraditja dhe pasditja mbivendosen — të lutem kontrollo oraret.'],
  [/^Bei (.+): Es fehlt noch «bis» — bitte eintragen, wann ihr fertig wart\. Nur am Vormittag gearbeitet\? Den Nachmittag mit × entfernen\.$/,
    'Te $1: mungon ende «deri» — të lutem shëno kur mbaruat. Keni punuar vetëm paradite? Hiqe pasditen me ×.'],
  [/^Es fehlt noch «bis» — bitte eintragen, wann ihr fertig wart\. Nur am Vormittag gearbeitet\? Den Nachmittag mit × entfernen\.$/,
    'Mungon ende «deri» — të lutem shëno kur mbaruat. Keni punuar vetëm paradite? Hiqe pasditen me ×.'],
  [/^Bei (.+): Eine Zeit endet vor ihrem Beginn — bitte prüfen\.$/, 'Te $1: një orar mbaron para se të fillojë — të lutem kontrollo.'],
  [/^Eine Zeit endet vor ihrem Beginn — bitte prüfen\.$/, 'Një orar mbaron para se të fillojë — të lutem kontrollo.'],
  [/^Auf (.+) hat niemand Zeit — die Wechselzeit (.+) prüfen\.$/, 'Te $1 askush nuk ka orë — kontrollo orën e ndërrimit $2.'],
  [/^Für (.+) ist an diesem Tag schon eine Meldung vom Bauführer freigegeben\. Änderungen macht der Bauführer in der Wochenübersicht\.$/,
    'Për $1 shefi i kantierit ka aprovuar tashmë një raport në këtë ditë. Ndryshimet i bën shefi i kantierit në pasqyrën javore.'],
  [/^Gespeichert: (.+)$/, (_m, r) => `U ruajt: ${h(r)}`],
  [/^Auf dem Gerät gespeichert, aber noch nicht gesendet: (.+)$/, 'U ruajt në pajisje, por ende pa u dërguar: $1'],
  [/^(\d+) alte Meldungen? aussortiert: (.+)$/, '$1 raport(e) të vjetra u hoqën: $2'],
  [/^(\d+(?:\.\d+)?) h (.+) je (\d+) Pers\.$/, '$1 orë $2 për $3 pers.'],
  [/^je (\d+) Pers\.$/, 'për $1 pers.'],
  [/^(\d+) Pers\. zusammen$/, '$1 pers. gjithsej'],
  // Startseite Monteur
  [/^(\d+) km Anreise$/, '$1 km udhëtim'],
  [/^öV an (\d+) (Tag|Tagen)$/, (_m, n) => `transport publik në ${n} ditë`],
  [/^(\d+) Einträge noch nicht angeschaut$/, '$1 regjistrime ende të pashikuara'],
  [/^· (\d+) km$/, '· $1 km'],
  [/^(\d+) neu$/, '$1 të reja'],
  // Nachtragen, Ersetzen, Senden
  [/^Der (\d{1,2}\.\d{1,2}\.) liegt mehr als (\d+) Tage zurück und lässt sich hier nicht mehr nachtragen\. Bitte den Bauführer fragen — er trägt es in der Wochenübersicht ein\. Gezeigt wird heute\.$/,
    '$1 është më shumë se $2 ditë më parë dhe nuk mund të plotësohet më këtu. Pyet shefin e kantierit — ai e shënon në pasqyrën javore. Shfaqet sot.'],
  [/^Schon entfernt: (.+) — bitte nochmals «Tag melden»\.$/, 'Hequr tashmë: $1 — të lutem përsëri «Raporto ditën».'],
  [/^Ersetzen geht nicht — «(.+)»: (.+)$/, 'Zëvendësimi nuk bëhet — «$1»: $2'],
  [/^(Das Team|Eine Person|Die Baustelle|Ein Stammdatensatz) dieser Meldung gibt es auf dem Server nicht mehr \(z\. B\. im Büro gelöscht\)\. Die Meldung bleibt auf dem Gerät — bitte Büro anrufen\.$/,
    (_m, w) => `${({ 'Das Team': 'Ekipi', 'Eine Person': 'Një person', 'Die Baustelle': 'Kantieri', 'Ein Stammdatensatz': 'Një e dhënë bazë' } as Record<string, string>)[w]} i këtij raporti nuk ekziston më në server (p.sh. u fshi në zyrë). Raporti mbetet në pajisje — të lutem telefono zyrën.`],
  [/^(\d+) (?:Zeile konnte|Zeilen konnten) nicht gesendet werden: (.+) — (.+)\. Bitte Büro anrufen\.$/, '$1 rresht(a) nuk mund të dërgoheshin: $2 — $3. Të lutem telefono zyrën.'],
  [/^Die Sprachnotiz liess sich auf diesem Gerät nicht ablegen \((.+)\)\. Die Meldung selbst ist gespeichert und geht raus\.$/, 'Mesazhi zanor nuk u ruajt në këtë pajisje ($1). Vetë raporti është ruajtur dhe dërgohet.'],
  [/^Die Fotos liessen sich auf diesem Gerät nicht ablegen \((.+)\)\. Die Meldung selbst ist gespeichert und geht raus\.$/, 'Fotot nuk u ruajtën në këtë pajisje ($1). Vetë raporti është ruajtur dhe dërgohet.'],
  [/^Sprachnotiz konnte nicht hochgeladen werden: (.+)$/, 'Mesazhi zanor nuk u ngarkua: $1'],
  [/^Sprachnotiz konnte nicht verknüpft werden: (.+)$/, 'Mesazhi zanor nuk mund të lidhej: $1'],
  [/^Foto konnte nicht hochgeladen werden: (.+)$/, 'Foto nuk u ngarkua: $1'],
  [/^Bei (.+):$/, 'Te $1:'],
  [/^(\d+(?:\.\d+)?) h (.+) \((\d+) Pers\., unterschiedlich\)$/, '$1 orë $2 ($3 pers., të ndryshme)'],
  [/^für (\d{1,2}\.\d{1,2}\.)$/, 'për $1'],
  // «Plan geändert» ohne Posteingang (ältere Datenbank): «Montag (morgen):», «Marco ist in Team 3», «… — statt Eigerplatz»
  [/^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag) \(morgen\):$/, (_m, t) => `${TAG_LANG[t]} (nesër):`],
  [/^(.+) ist in (.+)$/, '$1 është në $2'],
  [/^(.+) kommt zu euch$/, '$1 vjen te ju'],
  [/^(.+) kommt doch nicht$/, '$1 nuk vjen megjithatë'],
  [/^keine Baustelle geplant — statt (.+)$/, 'nuk është planifikuar kantier — në vend të $1'],
  [/^(.+) — statt (.+)$/, '$1 — në vend të $2'],
  // Posteingang und «Plan geändert» — Baustelle, Treffpunkt, Hinweis bleiben, wie sie dastehen
  [/^Plan für (.+) geändert$/, (_m, t) => `Plani për ${tageImText(t)} ndryshoi`],
  [/^Einteilung für (.+) geändert$/, (_m, t) => `Caktimi për ${tageImText(t)} ndryshoi`],
  [/^Deine Stunden vom (.+) korrigiert$/, (_m, t) => `Orët e tua të ${tageImText(t)} u korrigjuan`],
  [/^Stunden korrigiert: (.+), (.+)$/, (_m, n, t) => `Orët u korrigjuan: ${n}, ${tageImText(t)}`],
  [/^Normal (.+) → (.+)$/, 'Normale $1 → $2'],
  [/^Überstunden (.+) → (.+)$/, 'Orë shtesë $1 → $2'],
  [/^Zeiten (.+) → (.+)$/, 'Oraret $1 → $2'],
  [/^Grund: (.+)$/, 'Arsyeja: $1'],
  [/^Treffpunkt (Werkhof|auf der Baustelle)( statt (?:Werkhof|auf der Baustelle))?$/, (_m, n, s) => `Vendtakimi: ${n}${s ? ` (më parë: ${s.replace(/^ statt /, '')})` : ''}`],
  [/^Hinweis: (.+)$/, 'Shënim: $1'],
  [/^Neu: (.+?)( \(.+\))?$/, (_m, b, d) => `E re: ${b}${d ? d.replace(/\bab (\d)/, 'nga ora $1').replace(/Treffpunkt Werkhof/, 'vendtakimi Werkhof') : ''}`],
  [/^Fällt weg: (.+)$/, 'Hiqet: $1'],
  [/^(.+) fehlt \((.+)\)$/, (_m, n, a) => `${n} mungon (${ART[a] ?? a})`],
  [/^(.+) ist bei einem anderen Team$/, '$1 është në një ekip tjetër'],
  [/^(.+) ist bei (.+)$/, '$1 është te $2'],
  [/^(.+) ist doch da$/, '$1 është megjithatë aty'],
  [/^(.+) ist wieder bei euch$/, '$1 është përsëri me ju'],
  [/^(.+) kommt dazu$/, '$1 vjen në ekip'],
  [/^(.+) ist nicht mehr eingeteilt$/, '$1 nuk është më i caktuar'],
  [/^Du bist bei (.+?)( \(statt (.+)\))?$/, (_m, t, _s, v) => `Je te ${t}${v ? ` (në vend të ${v})` : ''}`],
  [/^Vom Team gemeldet um (.+)$/, 'Lajmëruar nga ekipi në orën $1'],
  [/^(.+): (.+) fehlt (.+)$/, (_m, t, n, w) => `${t}: ${n} mungon ${tageImText(w)}`],
  [/^(.+) statt (.+?)( \(.+\))?$/, (_m, n, a, d) => `${n} në vend të ${a}${d ? d.replace(/\bab (\d)/, 'nga ora $1').replace(/Treffpunkt Werkhof/, 'vendtakimi Werkhof') : ''}`],
  [/^— statt (.+)$/, '— në vend të $1'],
];
