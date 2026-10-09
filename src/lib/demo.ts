/**
 * Demo-Betrieb — ein vollständiger, deterministischer Gerüstbaubetrieb:
 * 75 Mitarbeitende (45 fest + 30 temporär), 5 Bauführer, 20 Teams mit
 * Vorarbeiter, 30 Kunden/Bauleitungen, alle Konten zugeordnet,
 * Planung, fünf Wochen Tagesmeldungen mit Überstunden und Sprachnotizen.
 * Gleicher Seed und gleiches Datum = gleiche Daten.
 *
 * Video-tauglich (06.10.2026): Baustellen und Kunden sind erfunden — die Demo-Firma zeigt nie die
 * echte Kontenliste eines Kunden. Vorarbeiter sprechen Italienisch, Französisch, Polnisch oder
 * Portugiesisch; ihre Notizen stehen im Original und auf Deutsch. Die Vorwoche ist zur Hälfte geprüft (Mo–Mi frei, Rest offen)
 * (Prüfen und Freigeben lässt sich zeigen), ältere Wochen sind freigegeben. Jeder Eintrag hat
 * echte Zeiten von–bis. Was das Video braucht (Team 3 auf Italienisch, Überstunden heute, eine
 * Vorwoche mit Hinweisen in fünf Sprachen), steht fest; der Rest ist Zufall mit festem Seed.
 *
 * Zwei Umfänge (08.10.2026): «klein» für Vorführungen — 5 Teams, 17 Leute, 6 Kunden, drei Wochen, jede Sprache
 * einmal, keine Zufallsabweichungen: Was auffällt, ist gewollt. «gross» = der Betrieb oben, fürs Video und für Lasttests.
 *
 * Zusatzaufträge und Regierapporte stehen in `demo_regie.ts` und werden nur geladen, wenn die Firma
 * `MODUS_ERFASSUNG = regie` gesetzt hat (02.10.2026). Ohne Regie macht SORBA das.
 *
 * Kunden-Mails enden bewusst auf «.example» (reservierte Domain): Aus einer
 * Demo darf nie eine Mail an eine echte fremde Adresse gehen.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addTage, iso, montag } from './datum';
import { aufteilen } from './zeiten';
import { eigeneFirma, einstellungen, normaltagMin } from './einstellungen';

/**
 * Nur diese Firmen dürfen den Demo-Betrieb laden oder leeren. Er ersetzt ALLE Bewegungsdaten —
 * in einer echten Firma (Gerüst GmbH) wäre das ein Totalverlust mit zwei Klicks.
 */
export const DEMO_FIRMEN = ['We-Plan'];

export function istDemoFirma(): boolean {
  const f = eigeneFirma();
  return !!f && DEMO_FIRMEN.includes(f.name);
}

// ── Zufall, reproduzierbar ────────────────────────────────────────────────────

class Zufall {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  uuid(): string {
    // v4-förmig, aber aus dem Seed — damit die Demo reproduzierbar bleibt
    const h = () => Math.floor(this.next() * 16).toString(16);
    const s = (n: number) => Array.from({ length: n }, h).join('');
    return `${s(8)}-${s(4)}-4${s(3)}-${['8', '9', 'a', 'b'][this.int(0, 3)]}${s(3)}-${s(12)}`;
  }
}

// ── Namen ─────────────────────────────────────────────────────────────────────

type Herkunft = 'ch' | 'alb' | 'it' | 'pt' | 'pl' | 'fr' | 'ar' | 'en';
type Sprache = 'de' | 'sq' | 'pt' | 'it' | 'fr' | 'ar' | 'pl' | 'en';

const NAMEN: Record<Herkunft, [readonly string[], readonly string[]]> = {
  ch: [['Marco', 'Reto', 'Stefan', 'Daniel', 'Michael', 'Thomas', 'Patrick', 'Adrian', 'Christian', 'Lukas', 'Simon', 'Fabian', 'Pascal', 'Dominik', 'Sandro', 'Roman', 'Beat', 'Urs', 'Kevin', 'Nicolas', 'Matthias', 'Jonas'],
    ['Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Steiner', 'Fischer', 'Gerber', 'Brunner', 'Baumann', 'Zimmermann', 'Moser', 'Widmer', 'Wyss', 'Graf', 'Roth', 'Lüthi', 'Bieri', 'Aebi', 'Hofer', 'Jost', 'Zbinden']],
  alb: [['Besnik', 'Valon', 'Drilon', 'Fatmir', 'Ilir', 'Blerim', 'Shpend', 'Agron', 'Kushtrim', 'Liridon', 'Burim', 'Ardian', 'Gëzim', 'Mentor', 'Florent', 'Visar', 'Enis', 'Dritan'],
    ['Krasniqi', 'Sylaj', 'Berisha', 'Gashi', 'Hoxha', 'Shala', 'Bytyqi', 'Rexhepi', 'Morina', 'Kelmendi', 'Zeqiri', 'Ademi', 'Maliqi', 'Osmani', 'Bajrami']],
  it: [['Luca', 'Giuseppe', 'Alessandro', 'Davide', 'Francesco', 'Matteo', 'Salvatore', 'Antonio', 'Vincenzo', 'Lorenzo'],
    ['Rossi', 'Bianchi', 'Esposito', 'Russo', 'Ferrari', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Lombardi', 'Gallo']],
  pt: [['João', 'Pedro', 'Rui', 'Tiago', 'Nuno', 'Miguel', 'Paulo', 'Ricardo'],
    ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Costa', 'Rodrigues', 'Martins', 'Gonçalves', 'Oliveira']],
  pl: [['Marek', 'Tomasz', 'Piotr', 'Krzysztof', 'Paweł', 'Łukasz', 'Grzegorz', 'Andrzej', 'Mateusz', 'Jakub', 'Rafał'],
    ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Dąbrowski', 'Mazur']],
  fr: [['Julien', 'Mathieu', 'Olivier', 'Sébastien', 'Yann', 'Cédric', 'Loïc'],
    ['Rochat', 'Favre', 'Chappuis', 'Bovet', 'Girard', 'Monnier', 'Pittet']],
  ar: [['Ahmad', 'Omar', 'Youssef', 'Karim', 'Sami', 'Hassan', 'Bilal', 'Tarek', 'Rami', 'Nabil'],
    ['Haddad', 'Khalil', 'Nasser', 'Saleh', 'Mansour', 'Aziz', 'Farah', 'Hamdan', 'Karam']],
  en: [['Daniel', 'Samuel', 'Emmanuel', 'Joseph', 'Kofi'], ['Okafor', 'Mensah', 'Adeyemi', 'Boateng', 'Asante']],
};

/** Vorarbeiter je Team: Herkunft und Sprache der Sprachnotiz. Fest, damit das Video immer gleich aussieht. */
const VORARBEITER: [Herkunft, Sprache][] = [
  ['ch', 'de'], ['it', 'it'], ['it', 'it'], ['alb', 'de'], ['pt', 'pt'], ['ch', 'de'], ['pl', 'pl'], ['alb', 'de'], ['fr', 'fr'], ['ch', 'de'],
  ['it', 'it'], ['alb', 'de'], ['pt', 'pt'], ['ch', 'de'], ['alb', 'de'], ['pl', 'pl'], ['ch', 'de'], ['it', 'it'], ['alb', 'de'], ['fr', 'fr'],
];

const TEMPORAERBUEROS = ['Adecco', 'Manpower', 'Randstad', 'Interiman', 'Coople'];
const FAHRZEUGE = ['VW Crafter', 'Mercedes Sprinter', 'Iveco Daily', 'Ford Transit', 'Renault Master'];

/** Erfundene Bauherrschaften und Bauleitungen — keine echten Firmen oder Ämter. */
const KUNDEN: [string, string][] = [
  ['Aebi Bau AG', 'M. Huber'], ['Gerber & Partner Architekten', 'S. Gerber'], ['Baugeschäft Wyss AG', 'R. Wyss'],
  ['GU Bernabau AG', 'T. Ammann'], ['Steiner Immobilien AG', 'C. Steiner'], ['Wohnbaugenossenschaft Aaretal', 'K. Lehmann'],
  ['Immobilien Aarehof AG', 'B. Schär'], ['Liegenschaften Gurtenblick AG', 'P. Zaugg'], ['Bieri Holzbau AG', 'A. Bieri'],
  ['Moser Baumeister AG', 'D. Moser'], ['Habitat Generalunternehmung', 'L. Rüfenacht'], ['Architekturbüro Lüthi', 'N. Lüthi'],
  ['Baumann Fassaden AG', 'E. Baumann'], ['Zimmermann Bedachungen', 'F. Zimmermann'], ['Immo Bern West AG', 'G. Roth'],
  ['Stiftung Wohnen im Alter Lindenegg', 'H. Brunner'], ['Verwaltung Schosshalde AG', 'J. von Allmen'], ['Widmer Sanierungen', 'M. Widmer'],
  ['Graf Malerei AG', 'O. Graf'], ['Keller & Söhne Bau', 'U. Keller'], ['Areal Wankdorf Nord AG', 'V. Hofer'],
  ['Genossenschaft Wabern', 'W. Jost'], ['Schmid Renovationen', 'Y. Schmid'], ['Fischer Dach + Wand', 'Z. Fischer'],
  ['Meier Totalunternehmer AG', 'A. Meier'], ['Schneider Architektur', 'B. Schneider'], ['Zbinden Bau GmbH', 'C. Zbinden'],
  ['Campus Bauten AG', 'D. Frey'], ['Logistik Immobilien Bern AG', 'E. Lanz'], ['Bahnhof Immobilien Mitte AG', 'F. Kunz'],
];

/** Erfundene Baustellen in der Region Bern — die ersten stehen in der aktuellen Planung, also im Video. */
const BAUSTELLEN_NAMEN = [
  'Wohnüberbauung Brünnenpark, Haus B', 'Mehrfamilienhaus Lorrainestrasse 18', 'Neubau Wankdorffeld, Baufeld C', 'Dachsanierung Kramgasse 41',
  'Siedlung Holenacker, Etappe 2', 'Gewerbehaus Liebefeld Süd', 'Fassade Kirchenfeldstrasse 27', 'Alterszentrum Ostermundigen, Anbau',
  'Fassade Monbijoustrasse 55', 'Reihenhäuser Muri, Thunstrasse', 'Schulanlage Zollikofen, Turnhalle', 'Bürohaus Weltpoststrasse 9',
  'Brückensanierung Worblaufen', 'Wohnüberbauung Ittigen Talmatt', 'Dachstock Gerechtigkeitsgasse 12', 'Mehrfamilienhaus Wabern, Gurtenweg 6',
  'Hotel Aarblick, Fassade', 'Pflegeheim Lindenegg, Neubau', 'Lagerhalle Niederwangen', 'Wohnhaus Belp, Aemmenmatt 3',
  'Sanierung Breitenrainplatz 4', 'Neubau Köniz Zentrum, Haus A', 'Fassade Bollwerk 21', 'Villa Elfenauweg 8',
  'Schulhaus Steigerhubel, Dach', 'Mehrfamilienhaus Burgdorf, Kirchbühl 7', 'Turmgerüst Kirche Münsingen', 'Wohnüberbauung Thun Lerchenfeld',
  'Gewerbebau Lyss, Industriering 14', 'Balkonsanierung Bethlehem, Block 4', 'Fassade Schwarztorstrasse 70', 'Wohnhaus Bremgarten, Kalchackerstr. 5',
  'Neubau Worb, Bahnhofareal', 'Treppenhaus Länggasse, Fabrikstrasse 12', 'Dachsanierung Ostermundigen Rüti', 'Kindergarten Wylerfeld',
  'Mehrfamilienhaus Spiegel, Föhrenweg 7', 'Lift-Anbau Seftigenstrasse 41', 'Fassade Effingerstrasse 30', 'Reparatur Vordach Bümpliz Nord',
  'Wohnhaus Hinterkappelen, Aumatt 2', 'Sanierung Schosshalde, Laubeggstrasse 9', 'Dachfenster Marktgasse 16', 'Neubau Gümligen, Feldstrasse 3',
];
const STRASSEN = ['Bernstrasse', 'Dorfstrasse', 'Bahnhofstrasse', 'Kirchweg', 'Lindenweg', 'Gartenstrasse', 'Schulhausweg', 'Mühleweg', 'Sonnenweg', 'Birkenweg', 'Waldeggstrasse', 'Hofmattweg', 'Rosenweg', 'Feldweg', 'Aarestrasse', 'Grabenweg'];
const ORTE = ['Bern', 'Köniz', 'Muri', 'Ittigen', 'Ostermundigen', 'Zollikofen', 'Belp', 'Worb', 'Bolligen', 'Kehrsatz', 'Wohlen', 'Münsingen', 'Lyss', 'Thun', 'Burgdorf'];

/**
 * Sprachnotizen, wie die Teams sie am Abend sprechen: Original in der Sprache des Vorarbeiters,
 * dazu der deutsche Text, den der Bauführer liest. `ueber` = Grund für Überstunden.
 */
const NOTIZEN: { ueber: boolean; de: string; it: string; fr: string; pl: string; pt: string }[] = [
  { ueber: true,
    de: 'Gerüst auf der Nordseite um ein Feld verlängert, die Bauleitung wollte das heute noch. Eine Stunde länger geblieben.',
    it: 'Abbiamo allungato il ponteggio sul lato nord di una campata, la direzione lavori lo voleva ancora oggi. Siamo rimasti un’ora in più.',
    fr: 'Nous avons prolongé l’échafaudage d’une travée côté nord, la direction des travaux le voulait encore aujourd’hui. Nous sommes restés une heure de plus.',
    pl: 'Przedłużyliśmy rusztowanie po stronie północnej o jedno pole, kierownictwo budowy chciało to jeszcze dziś. Zostaliśmy godzinę dłużej.',
    pt: 'Prolongámos o andaime do lado norte em um vão, a direção da obra queria isso ainda hoje. Ficámos uma hora a mais.' },
  { ueber: true,
    de: 'Zusätzliche Konsole beim Eingang montiert, der Bauleiter war vor Ort und hat es angeordnet.',
    it: 'Abbiamo montato una mensola in più all’ingresso, il direttore dei lavori era sul posto e l’ha ordinato.',
    fr: 'Nous avons monté une console supplémentaire à l’entrée, le chef de chantier était sur place et l’a demandé.',
    pl: 'Zamontowaliśmy dodatkową konsolę przy wejściu, kierownik budowy był na miejscu i to zlecił.',
    pt: 'Montámos uma consola adicional na entrada, o diretor da obra estava no local e mandou fazer.' },
  { ueber: true,
    de: 'Treppenturm für den Dachdecker um zwei Lagen erhöht, darum später fertig.',
    it: 'Abbiamo alzato la torre scala di due piani per il copritetto, per questo abbiamo finito più tardi.',
    fr: 'Nous avons rehaussé la tour d’escalier de deux niveaux pour le couvreur, c’est pourquoi nous avons fini plus tard.',
    pl: 'Podnieśliśmy wieżę schodową o dwa poziomy dla dekarza, dlatego skończyliśmy później.',
    pt: 'Subimos a torre de escadas dois níveis para o telhador, por isso acabámos mais tarde.' },
  { ueber: true,
    de: 'Schutznetz an der Strassenseite ergänzt, die Polizei hat das verlangt.',
    it: 'Abbiamo aggiunto la rete di protezione sul lato strada, la polizia l’ha richiesto.',
    fr: 'Nous avons complété le filet de protection côté rue, la police l’a exigé.',
    pl: 'Uzupełniliśmy siatkę ochronną od strony ulicy, policja tego zażądała.',
    pt: 'Completámos a rede de proteção do lado da rua, a polícia exigiu.' },
  { ueber: true,
    de: 'Zwei Beläge waren beschädigt, vermutlich vom Dachdecker. Ersetzt, das hat eine Stunde gebraucht.',
    it: 'Due tavole erano danneggiate, probabilmente dal copritetto. Le abbiamo sostituite, ci è voluta un’ora.',
    fr: 'Deux planchers étaient endommagés, probablement par le couvreur. Nous les avons remplacés, ça a pris une heure.',
    pl: 'Dwa pomosty były uszkodzone, pewnie przez dekarza. Wymieniliśmy je, zajęło to godzinę.',
    pt: 'Duas pranchas estavam danificadas, provavelmente pelo telhador. Substituímos, demorou uma hora.' },
  { ueber: true,
    de: 'Gerüst beim Balkon versetzt, weil der Maurer nicht durchgekommen ist. Die Bauleitung hat es so verlangt.',
    it: 'Abbiamo spostato il ponteggio vicino al balcone perché il muratore non riusciva a passare. La direzione lavori l’ha chiesto.',
    fr: 'Nous avons déplacé l’échafaudage près du balcon parce que le maçon ne pouvait pas passer. La direction des travaux l’a demandé.',
    pl: 'Przestawiliśmy rusztowanie przy balkonie, bo murarz nie mógł przejść. Kierownictwo budowy tak zażądało.',
    pt: 'Mudámos o andaime junto à varanda porque o pedreiro não conseguia passar. A direção da obra pediu assim.' },
  { ueber: false,
    de: 'Eine Stunde gewartet, weil der Kran vom Baumeister das Feld blockiert hat.',
    it: 'Abbiamo aspettato un’ora perché la gru dell’impresa edile bloccava la zona.',
    fr: 'Nous avons attendu une heure parce que la grue de l’entreprise de maçonnerie bloquait la zone.',
    pl: 'Czekaliśmy godzinę, bo dźwig firmy budowlanej blokował pole.',
    pt: 'Esperámos uma hora porque a grua do construtor bloqueava a zona.' },
  { ueber: false,
    de: 'Material kam zu spät, wir konnten erst um neun anfangen.',
    it: 'Il materiale è arrivato in ritardo, abbiamo potuto iniziare solo alle nove.',
    fr: 'Le matériel est arrivé en retard, nous n’avons pu commencer qu’à neuf heures.',
    pl: 'Materiał przyjechał za późno, mogliśmy zacząć dopiero o dziewiątej.',
    pt: 'O material chegou tarde, só conseguimos começar às nove.' },
  { ueber: false,
    de: 'Bauleitung war vor Ort, alles in Ordnung. Morgen brauchen wir mehr Beläge.',
    it: 'La direzione lavori era sul posto, tutto in ordine. Domani ci servono più tavole.',
    fr: 'La direction des travaux était sur place, tout est en ordre. Demain, il nous faut plus de planchers.',
    pl: 'Kierownictwo budowy było na miejscu, wszystko w porządku. Jutro potrzebujemy więcej pomostów.',
    pt: 'A direção da obra esteve no local, tudo em ordem. Amanhã precisamos de mais pranchas.' },
  { ueber: false,
    de: 'Ab drei Uhr Regen, wir haben früher aufgehört.',
    it: 'Dalle tre ha piovuto, abbiamo smesso prima.',
    fr: 'Pluie dès trois heures, nous avons arrêté plus tôt.',
    pl: 'Od trzeciej padał deszcz, skończyliśmy wcześniej.',
    pt: 'A partir das três choveu, parámos mais cedo.' },
];
const NOTIZ_SPAET = 7; // «erst um neun angefangen»
const NOTIZ_REGEN = 9; // «früher aufgehört»

/**
 * Feste Notizen fürs Video. `woche` relativ zur laufenden (−1 = Vorwoche), `tag` 0 = Montag;
 * `vorTagen` statt `woche`/`tag` = relativ zu heute (0 = heute). `ende` = Feierabend der zwei,
 * die länger geblieben sind (Minuten seit Mitternacht).
 */
const FESTE_NOTIZEN: { team: number; notiz: number; ende?: number; woche?: number; tag?: number; vorTagen?: number }[] = [
  // Vorwoche: sechs Überstunden-Tage in fünf Sprachen und zwei Bemerkungen — das füllt «Zum Anschauen»
  { woche: -1, tag: 0, team: 1, notiz: 0, ende: 18 * 60 },        // Team 2 · Italienisch
  { woche: -1, tag: 1, team: 4, notiz: 1, ende: 17 * 60 + 30 },   // Team 5 · Portugiesisch
  { woche: -1, tag: 1, team: 6, notiz: 2, ende: 18 * 60 + 30 },   // Team 7 · Polnisch
  { woche: -1, tag: 2, team: 8, notiz: 3, ende: 18 * 60 },        // Team 9 · Französisch
  { woche: -1, tag: 3, team: 10, notiz: 4, ende: 17 * 60 + 30 },  // Team 11 · Italienisch
  { woche: -1, tag: 4, team: 13, notiz: 5, ende: 18 * 60 },       // Team 14 · Deutsch
  { woche: -1, tag: 2, team: 3, notiz: 6 },                       // Team 4 · Bemerkung (Kran)
  { woche: -1, tag: 3, team: 15, notiz: NOTIZ_REGEN },            // Team 16 · Polnisch, Regen
  // Diese Woche, relativ zu heute — nur Werktage, die schon vorbei sind
  { vorTagen: 1, team: 2, notiz: 5, ende: 18 * 60 },              // Team 3 · Italienisch, gestern
  { vorTagen: 2, team: 12, notiz: NOTIZ_SPAET },                  // Team 13 · Portugiesisch
  // Heute: zwei Teams mit Überstunden — im Team-Board bernstein
  { vorTagen: 0, team: 17, notiz: 2, ende: 17 * 60 + 30 },        // Team 18 · Italienisch
  { vorTagen: 0, team: 15, notiz: 0, ende: 18 * 60 },             // Team 16 · Polnisch
];

/**
 * Diese Teams haben heute noch nicht gemeldet (Team 3, 6, 10, 15) — so sieht das Team-Board am Abend aus.
 * Team 3 ist absichtlich dabei: im Video meldet es den Tag am Teamgerät (Italienisch).
 */
const HEUTE_OFFEN = new Set([2, 5, 9, 14]);

/**
 * Vorführung (klein): Team 1 Deutsch, 2 Französisch, 3 Italienisch, 4 Portugiesisch, 5 Polnisch.
 * Vor zwei Wochen: vier Überstunden-Fälle (daraus Regierapporte: bestätigt, Frist abgelaufen, bestätigt, Rückfrage).
 * Vorwoche: vier Überstunden-Fälle — zwei schon Rapport (verschickt, Entwurf), zwei warten auf den Bauführer —
 * und eine Bemerkung. Diese Woche: eine Bemerkung. Heute melden alle einen normalen Tag, nur Team 3 fehlt — es meldet
 * live (seit 08.10.2026 ohne Überstunden bei Team 5: Amir will heute genau einen Fall, den aus seiner Vorführung).
 */
const FESTE_NOTIZEN_KLEIN: typeof FESTE_NOTIZEN = [
  { woche: -2, tag: 0, team: 0, notiz: 4, ende: 17 * 60 + 30 },  // Team 1 · Deutsch
  { woche: -2, tag: 1, team: 3, notiz: 1, ende: 17 * 60 + 30 },  // Team 4 · Portugiesisch
  { woche: -2, tag: 2, team: 2, notiz: 3, ende: 18 * 60 },       // Team 3 · Italienisch
  { woche: -2, tag: 3, team: 4, notiz: 5, ende: 18 * 60 },       // Team 5 · Polnisch
  { woche: -1, tag: 0, team: 2, notiz: 0, ende: 18 * 60 },       // Team 3 · Italienisch → Rapport verschickt
  { woche: -1, tag: 1, team: 3, notiz: 2, ende: 18 * 60 + 30 },  // Team 4 · Portugiesisch → Rapport-Entwurf
  { woche: -1, tag: 2, team: 1, notiz: 3, ende: 18 * 60 },       // Team 2 · Französisch → wartet auf Entscheid
  { woche: -1, tag: 3, team: 4, notiz: 5, ende: 17 * 60 + 30 },  // Team 5 · Polnisch → wartet auf Entscheid
  { woche: -1, tag: 2, team: 0, notiz: 6 },                      // Team 1 · Bemerkung (Kran)
  { vorTagen: 2, team: 3, notiz: NOTIZ_SPAET },                  // Team 4 · Bemerkung (Material zu spät)
];

/** Wie gross der Demo-Betrieb ist. «gross» ist der Betrieb aus dem Launch-Video (gleicher Seed = gleiche Daten). */
export type DemoUmfang = 'klein' | 'gross';

interface Aufbau {
  bauf: number; vorarbeiter: [Herkunft, Sprache][]; interne: number; temps: number; tempJeTeam: (teamIdx: number) => number;
  bueros: readonly string[]; kunden: number; aktiv: number; fertig: number; kundeFuerAbgeschlossene: boolean;
  wochen: number; zufall: boolean; feste: typeof FESTE_NOTIZEN; heuteOffen: Set<number>;
  wechsel: Set<number>; reparatur: Set<number>; frei: Set<number>;
}

const AUFBAU: Record<DemoUmfang, Aufbau> = {
  gross: {
    bauf: 5, vorarbeiter: VORARBEITER, interne: 20, temps: 30, tempJeTeam: (i) => (i < 10 ? 2 : 1), // 10×2 + 10×1 = 30
    bueros: TEMPORAERBUEROS, kunden: 30, aktiv: 80, fertig: 60, kundeFuerAbgeschlossene: true,
    wochen: 5, zufall: true, feste: FESTE_NOTIZEN, heuteOffen: HEUTE_OFFEN,
    wechsel: new Set([4, 10]), reparatur: new Set([3, 13]), frei: new Set([8, 16]),
  },
  klein: {
    bauf: 2, vorarbeiter: [['ch', 'de'], ['fr', 'fr'], ['it', 'it'], ['pt', 'pt'], ['pl', 'pl']], interne: 5, temps: 5, tempJeTeam: () => 1,
    bueros: ['Adecco', 'Randstad', 'Manpower'], kunden: 6, aktiv: 12, fertig: 3, kundeFuerAbgeschlossene: false,
    wochen: 3, zufall: false, feste: FESTE_NOTIZEN_KLEIN, heuteOffen: new Set([2]),
    wechsel: new Set([1]), reparatur: new Set([3]), frei: new Set([4]),
  },
};

// ── Zeilen (1:1 die Tabellen) ─────────────────────────────────────────────────

export interface MitarbeiterRow { id: string; name: string; typ: 'intern' | 'extern' | 'temporaer'; funktion: string; sprache: Sprache; temporaerbuero: string | null; aktiv: boolean; oev_standard: boolean; km_standard: number; eintritt: string }
export interface TeamRow { id: string; bezeichnung: string; fahrzeug: string; chefmonteur_id: string; aktiv: boolean }
export interface TeamMitgliedRow { team_id: string; mitarbeiter_id: string; von: string }
export interface KundeRow { id: string; name: string; praeferenz: 'einzel' | 'sammel'; ansprechperson: string; email: string; telefon: string }
export interface BaustelleUpdate { id: string; konto_nr: string; bezeichnung: string | null; kunde_id: string | null; status: 'aktiv' | 'fertig_gemeldet' | 'abgeschlossen'; fertigstellung_am: string | null }
export interface JahresplanRow { id: string; baustelle_id: string; team_id: string; von: string; bis: string }
export interface TagesmeldungRow { id: string; client_uuid: string; team_id: string; datum: string; baustelle_id: string; normalfall: boolean; abweichung_typ: string | null; wer_hats_gewollt: string | null; transkript: string | null; transkript_quelle: string | null; transkript_sprache: string | null; audio_sekunden: number | null; erfasst_von: string; erfasst_am: string; status: 'offen' | 'freigegeben' }
export interface ZeiteintragRow { id: string; tagesmeldung_id: string; mitarbeiter_id: string; normal_min: number; ueber_min: number; oev: boolean; km: number; baustelle_id: string; konto_nr: string; status: 'offen' | 'freigegeben'; von_min: number | null; bis_min: number | null; von2_min: number | null; bis2_min: number | null }
export interface FreigabeLogRow { id: string; zeiteintrag_id: string; wer: string; wann: string; feld: string; alt: string; neu: string }

export interface DemoBetrieb {
  umfang: DemoUmfang;
  mitarbeiter: MitarbeiterRow[];
  teams: TeamRow[];
  teamMitglieder: TeamMitgliedRow[];
  kunden: KundeRow[];
  baustellen: BaustelleUpdate[];
  jahresplan: JahresplanRow[];
  meldungen: TagesmeldungRow[];
  eintraege: ZeiteintragRow[];
  freigaben: FreigabeLogRow[];
}

export interface BaustelleQuelle { id: string; konto_nr: string; bezeichnung: string | null }

function ts(d: Date, h: number, m: number): string {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c] ?? c).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Mo = 0 … So = 6 */
function wochentag(d: Date): number {
  return (d.getDay() + 6) % 7;
}

// ── Generator ────────────────────────────────────────────────────────────────

export function erzeugeDemoBetrieb(opts: { baustellen: BaustelleQuelle[]; heute: Date; userId: string; seed?: number; umfang?: DemoUmfang; normaltagMin?: number }): DemoBetrieb {
  const umfang = opts.umfang ?? 'gross';
  const A = AUFBAU[umfang];
  const z = new Zufall(opts.seed ?? 20261006);
  const jetzt = new Date(opts.heute);
  const heute = new Date(opts.heute);
  heute.setHours(12, 0, 0, 0);
  const heuteIso = iso(heute);
  const wochenStart = montag(heute);

  // Mitarbeitende ---------------------------------------------------------
  const vergeben = new Set<string>();
  function name(h: Herkunft): string {
    const [vn, nn] = NAMEN[h];
    for (let i = 0; i < 80; i++) {
      const n = `${z.pick(vn)} ${z.pick(nn)}`;
      if (!vergeben.has(n)) {
        vergeben.add(n);
        return n;
      }
    }
    const n = `${z.pick(vn)} ${z.pick(nn)} ${vergeben.size}`;
    vergeben.add(n);
    return n;
  }
  const mitarbeiter: MitarbeiterRow[] = [];
  const person = (p: Omit<MitarbeiterRow, 'id' | 'aktiv' | 'eintritt'> & { jahre?: number }): MitarbeiterRow => {
    const row: MitarbeiterRow = {
      id: z.uuid(), aktiv: true,
      eintritt: iso(addTage(heute, -z.int(60, (p.jahre ?? 6) * 365))),
      name: p.name, typ: p.typ, funktion: p.funktion, sprache: p.sprache,
      temporaerbuero: p.temporaerbuero, oev_standard: p.oev_standard, km_standard: p.km_standard,
    };
    mitarbeiter.push(row);
    return row;
  };

  for (let i = 0; i < A.bauf; i++) person({ name: name('ch'), typ: 'intern', funktion: 'bauf', sprache: 'de', temporaerbuero: null, oev_standard: false, km_standard: z.int(15, 40), jahre: 15 });

  const chefs = A.vorarbeiter.map(([h, sp]) =>
    person({ name: name(h), typ: 'intern', funktion: 'gruppe', sprache: sp, temporaerbuero: null, oev_standard: false, km_standard: z.int(10, 45), jahre: 12 }),
  );

  const interne: MitarbeiterRow[] = [];
  for (let i = 0; i < A.interne; i++) {
    const r = z.next();
    const [h, sp]: [Herkunft, Sprache] = r < 0.3 ? ['alb', 'de'] : r < 0.5 ? ['ch', 'de'] : r < 0.65 ? ['it', 'it'] : r < 0.8 ? ['pt', 'pt'] : ['pl', 'pl'];
    const oev = z.chance(0.3);
    interne.push(person({ name: name(h), typ: 'intern', funktion: z.chance(0.7) ? 'monteur' : 'mitarbeiter', sprache: sp, temporaerbuero: null, oev_standard: oev, km_standard: oev ? 0 : z.chance(0.25) ? z.int(8, 30) : 0, jahre: 8 }));
  }

  const temps: MitarbeiterRow[] = [];
  for (let i = 0; i < A.temps; i++) {
    const r = z.next();
    const [h, sp]: [Herkunft, Sprache] = r < 0.25 ? ['ar', 'ar'] : r < 0.5 ? ['pl', 'pl'] : r < 0.6 ? ['en', 'en'] : r < 0.75 ? ['pt', 'pt'] : r < 0.88 ? ['alb', 'de'] : ['ch', 'de'];
    const oev = z.chance(0.5);
    temps.push(person({ name: name(h), typ: 'temporaer', funktion: z.chance(0.4) ? 'monteur' : 'mitarbeiter', sprache: sp, temporaerbuero: z.pick(A.bueros), oev_standard: oev, km_standard: 0, jahre: 1 }));
  }

  // Teams -------------------------------------------------------------------
  const teams: TeamRow[] = [];
  const teamMitglieder: TeamMitgliedRow[] = [];
  const mitgliederVon = new Map<string, MitarbeiterRow[]>();
  let tempIdx = 0;
  for (let i = 0; i < A.vorarbeiter.length; i++) {
    const team: TeamRow = {
      id: z.uuid(), bezeichnung: `Team ${i + 1}`,
      fahrzeug: `${z.pick(FAHRZEUGE)} · BE ${z.int(10, 99)} ${z.int(100, 999)}`,
      chefmonteur_id: chefs[i].id, aktiv: true,
    };
    teams.push(team);
    const leute = [chefs[i], interne[i]];
    const anzTemp = A.tempJeTeam(i);
    for (let k = 0; k < anzTemp && tempIdx < temps.length; k++) leute.push(temps[tempIdx++]);
    mitgliederVon.set(team.id, leute);
    for (const m of leute) teamMitglieder.push({ team_id: team.id, mitarbeiter_id: m.id, von: m.typ === 'temporaer' ? iso(addTage(heute, -z.int(20, 120))) : iso(addTage(heute, -z.int(200, 900))) });
  }

  // Kunden (Stammdaten: wem gehört die Baustelle) ------------------------------
  const kunden: KundeRow[] = KUNDEN.slice(0, A.kunden).map(([firma, ap]) => ({
    id: z.uuid(), name: firma, praeferenz: z.chance(0.3) ? 'sammel' : 'einzel',
    ansprechperson: ap,
    email: `${slug(ap.split('. ')[1] ?? ap)}@${slug(firma).slice(0, 18).replace(/-+$/, '')}.example`,
    telefon: `031 ${z.int(300, 999)} ${z.int(10, 99)} ${z.int(10, 99)}`,
  }));

  // Baustellen: erfundene Namen, die ersten (gross 80, klein 12) aktiv ------------------------------
  const vorhanden = new Set(opts.baustellen.map((b) => (b.bezeichnung ?? '').toLowerCase()));
  const namenGesehen = new Set<string>();
  const ersatzName = (i: number): string => {
    if (i < BAUSTELLEN_NAMEN.length) return BAUSTELLEN_NAMEN[i];
    for (let k = 0; k < 50; k++) {
      const ort = z.pick(ORTE);
      const n = `${ort === 'Bern' ? '' : ort + ', '}${z.pick(STRASSEN)} ${z.int(1, 120)}`;
      // Nie zufällig den Namen einer echten Baustelle aus der ursprünglichen Liste treffen
      if (!namenGesehen.has(n) && !vorhanden.has(n.toLowerCase())) { namenGesehen.add(n); return n; }
    }
    return `Baustelle ${i + 1}`;
  };
  const baustellen: BaustelleUpdate[] = opts.baustellen.map((b, i) => {
    const status: BaustelleUpdate['status'] = i < A.aktiv ? 'aktiv' : i < A.aktiv + A.fertig ? 'fertig_gemeldet' : 'abgeschlossen';
    const kunde = z.pick(kunden).id;
    return {
      id: b.id, konto_nr: b.konto_nr, bezeichnung: ersatzName(i),
      // Vorführung: alte, abgeschlossene Konten ohne Kunde — die Kundenliste zeigt nur, was gerade läuft
      kunde_id: status === 'abgeschlossen' && !A.kundeFuerAbgeschlossene ? null : kunde, status,
      fertigstellung_am: status === 'aktiv' ? null : iso(addTage(heute, status === 'fertig_gemeldet' ? -z.int(3, 45) : -z.int(60, 300))),
    };
  });
  const aktive = baustellen.filter((b) => b.status === 'aktiv');

  // Planung -----------------------------------------------------------------
  // Jetzt: Vorwoche bis Ende nächster Woche, danach die nächste Baustelle. Abwechslung fürs Video:
  // zwei Teams wechseln mitten in der Woche, zwei sind am Mittwoch für eine Reparatur anderswo und danach
  // zurück (kein Team steht je auf zwei Baustellen gleichzeitig), zwei sind nächste Woche noch frei.
  // Die ersten Namen der Liste stehen damit in der Planung von heute.
  const jahresplan: JahresplanRow[] = [];
  const plan = (team: TeamRow, b: BaustelleUpdate, von: Date, bis: Date) => jahresplan.push({ id: z.uuid(), baustelle_id: b.id, team_id: team.id, von: iso(von), bis: iso(bis) });
  const mo = (w: number) => addTage(wochenStart, 7 * w);
  const fr = (w: number) => addTage(wochenStart, 7 * w + 4);
  // gross: Team 5/11 ab Donnerstag woanders, Team 4/14 Mittwoch Reparatur, Team 9/17 nächste Woche noch frei
  const { wechsel, reparatur, frei } = A;
  let naechste = teams.length;
  const neueBaustelle = () => aktive[naechste++ % aktive.length];
  for (const [i, team] of teams.entries()) {
    const jetzt1 = aktive[i];
    plan(team, neueBaustelle(), mo(-4), fr(-2));
    if (wechsel.has(i)) {
      plan(team, jetzt1, mo(-1), addTage(mo(0), 2));
      plan(team, neueBaustelle(), addTage(mo(0), 3), fr(1));
    } else if (reparatur.has(i)) {
      const mi = addTage(mo(0), 2);
      plan(team, jetzt1, mo(-1), addTage(mo(0), 1));
      plan(team, neueBaustelle(), mi, mi);
      plan(team, jetzt1, addTage(mo(0), 3), fr(1));
    } else if (frei.has(i)) {
      plan(team, jetzt1, mo(-1), fr(0));
    } else {
      plan(team, jetzt1, mo(-1), fr(1));
    }
    plan(team, neueBaustelle(), mo(2), fr(2 + z.int(1, 3)));
  }
  /** Baustelle eines Teams an einem Tag laut Planung — Einsätze überschneiden sich in der Demo nie. */
  const baustelleAm = (teamId: string, tagIso: string): BaustelleUpdate => {
    const treffer = jahresplan.filter((j) => j.team_id === teamId && j.von <= tagIso && j.bis >= tagIso);
    const id = treffer.sort((a, b) => a.von.localeCompare(b.von))[0]?.baustelle_id;
    return baustellen.find((b) => b.id === id) ?? aktive[0];
  };

  // Tagesmeldungen ----------------------------------------------------------
  // Je Person echte Zeiten: 7:00–12:00 · 13:00–16:00. Wer länger bleibt, hat einen späteren Feierabend;
  // daraus rechnet die App Normal (bis 8.4 h) und Überstunden — genau wie bei einer echten Meldung.
  const meldungen: TagesmeldungRow[] = [];
  const eintraege: ZeiteintragRow[] = [];
  const freigaben: FreigabeLogRow[] = [];

  const festAm = (teamIdx: number, tag: Date) => {
    const tagIso = iso(tag);
    const w = Math.round((montag(tag).getTime() - wochenStart.getTime()) / (7 * 86400000));
    return A.feste.find((n) =>
      n.team === teamIdx && (n.vorTagen !== undefined ? iso(addTage(heute, -n.vorTagen)) === tagIso : n.woche === w && n.tag === wochentag(tag)),
    );
  };

  for (const [teamIdx, team] of teams.entries()) {
    const leute = mitgliederVon.get(team.id)!;
    const chef = leute[0];
    // Ältere Wochen: zufällig ein Notiz-Tag pro Woche (Überstunden oder Bemerkung) — daraus entsteht Regie-Geschichte
    for (let w = -(A.wochen - 1); w <= 0; w++) {
      const wStart = addTage(wochenStart, w * 7);
      const freigegeben = w <= -2;
      const zufallsNotiz = A.zufall && w <= -2 && z.chance(0.4) ? { tag: z.int(0, 4), ueber: z.chance(0.75) } : null;
      for (let t = 0; t < 6; t++) {
        const tag = addTage(wStart, t);
        const tagIso = iso(tag);
        if (tagIso > heuteIso) continue;
        // Samstag nur ausnahmsweise und nur in alten Wochen
        if (t === 5 && !(freigegeben && teamIdx === 11 && w === -3)) continue;
        if (tagIso === heuteIso && A.heuteOffen.has(teamIdx)) continue;
        // Welche Notiz gilt heute für dieses Team?
        const fest = festAm(teamIdx, tag);
        // Video (gross): Die Vorwoche ist halb geprüft — Mo–Mi freigegeben, Do/Fr und die Notiz-Tage («Zum Anschauen»)
        // noch offen. 09.10.2026, Amir: «100 Team-Tage warten auf Freigabe» wirkte unausgewogen; so sind es rund 45.
        const halbGeprueft = umfang === 'gross' && w === -1 && t <= 2 && !fest;
        const tagFreigegeben = freigegeben || halbGeprueft;
        const status: 'offen' | 'freigegeben' = tagFreigegeben ? 'freigegeben' : 'offen';
        const bs = baustelleAm(team.id, tagIso);

        let notiz: (typeof NOTIZEN)[number] | null = null;
        let notizIdx = -1;
        let ende = 16 * 60;
        if (fest) {
          notizIdx = fest.notiz;
          notiz = NOTIZEN[notizIdx];
          if (fest.ende) ende = fest.ende;
        } else if (zufallsNotiz && zufallsNotiz.tag === t) {
          const pool = NOTIZEN.map((n, k) => ({ n, k })).filter((x) => x.n.ueber === zufallsNotiz.ueber);
          const wahl = z.pick(pool);
          notiz = wahl.n;
          notizIdx = wahl.k;
          if (notiz.ueber) ende = z.pick([17 * 60 + 30, 18 * 60, 18 * 60 + 30]);
        }

        const sprache = chef.sprache;
        const meldung: TagesmeldungRow = {
          id: z.uuid(), client_uuid: z.uuid(), team_id: team.id, datum: tagIso, baustelle_id: bs.id,
          normalfall: true, abweichung_typ: null, wer_hats_gewollt: null,
          transkript: notiz ? notiz.de : null,
          transkript_quelle: notiz && sprache !== 'de' && sprache in notiz ? notiz[sprache as 'it' | 'fr' | 'pl' | 'pt'] : null,
          transkript_sprache: notiz ? (sprache in notiz ? sprache : 'de') : null,
          audio_sekunden: notiz ? z.int(9, 24) : null,
          erfasst_von: opts.userId, erfasst_am: '', status,
        };
        // Heute gemeldet: am Abend — wird die Demo tagsüber geladen, liegt die Meldung kurz vor jetzt statt in der Zukunft
        const abends = new Date(ts(tag, 16, 5 + teamIdx * 4));
        meldung.erfasst_am = (tagIso === heuteIso && abends > jetzt ? new Date(jetzt.getTime() - (20 - teamIdx) * 3 * 60000) : abends).toISOString();
        meldungen.push(meldung);

        // Freitag manchmal um drei fertig
        const kurzerFreitag = A.zufall && t === 4 && !notiz && z.chance(0.3);
        let tagesBeginn = 7 * 60;
        let tagesEnde = kurzerFreitag ? 15 * 60 : 16 * 60;
        if (notizIdx === NOTIZ_SPAET) tagesBeginn = 9 * 60;
        if (notizIdx === NOTIZ_REGEN) tagesEnde = 15 * 60;

        let ueberstuendler = 0;
        for (const m of leute) {
          const istChef = m.id === chef.id;
          // In der Vorwoche und heute sind alle da — die Zahlen im Video sollen ruhig sein
          const anwesend = istChef || w >= -1 || !A.zufall || (m.typ === 'temporaer' ? z.chance(0.9) : z.chance(0.95));
          if (!anwesend) continue;
          // Überstunden für den Vorarbeiter und einen zweiten — die zwei sind länger geblieben
          const bleibtLaenger = !!notiz?.ueber && ueberstuendler < 2;
          if (bleibtLaenger) ueberstuendler++;
          const bis2 = bleibtLaenger ? ende : tagesEnde;
          const total = (12 * 60 - tagesBeginn) + (bis2 - 13 * 60);
          const { normal_min, ueber_min } = aufteilen(total, opts.normaltagMin);
          eintraege.push({
            id: z.uuid(), tagesmeldung_id: meldung.id, mitarbeiter_id: m.id,
            normal_min, ueber_min,
            oev: false, km: m.km_standard,
            baustelle_id: bs.id, konto_nr: bs.konto_nr, status,
            von_min: tagesBeginn, bis_min: 12 * 60, von2_min: 13 * 60, bis2_min: bis2,
          });
        }
        if (tagFreigegeben) {
          for (const e of eintraege.filter((x) => x.tagesmeldung_id === meldung.id)) {
            freigaben.push({ id: z.uuid(), zeiteintrag_id: e.id, wer: opts.userId, wann: ts(addTage(wStart, 7), 8, z.int(5, 55)), feld: 'status', alt: 'offen', neu: 'freigegeben' });
          }
        }
      }
    }
  }

  return { umfang, mitarbeiter, teams, teamMitglieder, kunden, baustellen, jahresplan, meldungen, eintraege, freigaben };
}

// ── Laden / Zurücksetzen ─────────────────────────────────────────────────────

export type Protokoll = (zeile: string) => void;

async function inChunks(client: SupabaseClient, tabelle: string, rows: object[], log: Protokoll, groesse = 200): Promise<void> {
  for (let i = 0; i < rows.length; i += groesse) {
    const { error } = await client.from(tabelle).insert(rows.slice(i, i + groesse) as Record<string, unknown>[]);
    if (error) throw new Error(`${tabelle}: ${error.message}`);
  }
  log(`${tabelle}: ${rows.length}`);
}

function nurDemoFirma(): void {
  if (!istDemoFirma()) throw new Error('Der Demo-Betrieb lässt sich nur in einer Demo-Firma laden — hier würde er echte Daten löschen.');
}

/** Löscht alle Bewegungs- und Stammdaten (nicht die Baustellen) — in FK-Reihenfolge.
 *  Die Regie-Tabellen (zustellung_log, regie_position, regierapport, zusatzauftrag) bleiben in der Datenbank
 *  und werden hier mitgeleert, damit alte Demo-Daten nicht im Weg stehen. Fotos hängen an Meldungen und
 *  Rapporten — sie gehen zuerst. */
export async function demoZuruecksetzen(client: SupabaseClient, log: Protokoll): Promise<void> {
  nurDemoFirma();
  const alles = async (tabelle: string, spalte = 'id') => {
    const { error } = await client.from(tabelle).delete().not(spalte, 'is', null);
    if (error) throw new Error(`${tabelle} löschen: ${error.message}`);
  };
  for (const t of ['foto', 'freigabe_log', 'zeiteintrag', 'zustellung_log', 'regie_position', 'regierapport', 'tagesmeldung', 'zusatzauftrag', 'planaenderung', 'jahresplan']) await alles(t);
  await alles('team_mitglied', 'team_id');
  await alles('team');
  await alles('mitarbeiter');
  // Baustellen zeigen auf Kunden — erst lösen, dann die Kunden löschen
  const { error } = await client.from('baustelle').update({ kunde_id: null, status: 'aktiv', fertigstellung_am: null }).not('id', 'is', null);
  if (error) throw new Error('baustelle zurücksetzen: ' + error.message);
  await alles('kunde');
  log('Alles geleert — die Konten bleiben.');
}

export interface DemoZusammenfassung { mitarbeiter: number; teams: number; kunden: number; meldungen: number; eintraege: number; regierapporte?: number }

/** Lädt den Demo-Betrieb. Standard = «klein» (Vorführung); «gross» = 20 Teams wie im Launch-Video. */
export async function demoLaden(client: SupabaseClient, userId: string, log: Protokoll, umfang: DemoUmfang = 'klein'): Promise<DemoZusammenfassung> {
  nurDemoFirma();
  const { data: bs, error } = await client.from('baustelle').select('id,konto_nr,bezeichnung').order('konto_nr');
  if (error || !bs || bs.length === 0) throw new Error('Keine Baustellen gefunden — zuerst die Kontenliste importieren.');
  log(`${bs.length} Baustellen gefunden`);

  await demoZuruecksetzen(client, log);
  const d = erzeugeDemoBetrieb({ baustellen: bs, heute: new Date(), userId, umfang, normaltagMin: normaltagMin() });

  await inChunks(client, 'kunde', d.kunden, log);
  await inChunks(client, 'mitarbeiter', d.mitarbeiter, log);
  await inChunks(client, 'team', d.teams, log);
  await inChunks(client, 'team_mitglied', d.teamMitglieder, log);
  {
    const { error: e } = await client.from('baustelle').upsert(d.baustellen, { onConflict: 'id' });
    if (e) throw new Error('baustelle zuordnen: ' + e.message);
    log(`baustelle: ${d.baustellen.length} zugeordnet`);
  }
  await inChunks(client, 'jahresplan', d.jahresplan, log);
  await inChunks(client, 'tagesmeldung', d.meldungen, log);
  await inChunks(client, 'zeiteintrag', d.eintraege, log);
  await inChunks(client, 'freigabe_log', d.freigaben, log);

  // Regie nur, wenn die Firma sie führt — sonst bleiben die vier Tabellen leer (Firmen-Schalter 02.10.)
  let regierapporte: number | undefined;
  if (einstellungen().erfassung === 'regie') {
    const { demoRegieLaden } = await import('./demo_regie');
    const r = await demoRegieLaden(client, d, userId, log);
    regierapporte = r.rapporte;
  }

  return { mitarbeiter: d.mitarbeiter.length, teams: d.teams.length, kunden: d.kunden.length, meldungen: d.meldungen.length, eintraege: d.eintraege.length, regierapporte };
}
