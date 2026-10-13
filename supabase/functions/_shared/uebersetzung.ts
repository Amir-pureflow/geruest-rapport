// Die Übertragung: (bestätigter) Text in der Sprache des Sprechers → Schweizer Hochdeutsch (Mistral, Paris/EU).
// Gemeinsam für `transkribieren` (die App) und den Prüfstand — so wird geprüft, was die App wirklich tut.
// Beim Deploy über die CLI (`--use-api`) wird diese Datei mitgebündelt.

export const SPRACHEN: Record<string, string> = { de: 'Deutsch', sq: 'Albanisch', pt: 'Portugiesisch', it: 'Italienisch', fr: 'Französisch', es: 'Spanisch', ar: 'Arabisch', pl: 'Polnisch', en: 'Englisch' };

const ANWEISUNG =
  'Du bereinigst gesprochene Notizen von einer Gerüstbau-Baustelle zu klarem Schweizer Hochdeutsch («ss» statt «ß»). ' +
  'Regeln: Grammatik und Wortstellung korrigieren. Füllwörter, Wiederholungen und Versprecher entfernen. ' +
  'Selbstkorrekturen auflösen: es gilt die zuletzt genannte Fassung (z. B. «der Chefmonteur … ah, der Bauführer meine ich» → Bauführer). ' +
  'Zahlen, Uhrzeiten, Stunden, Namen, Baustellen und Mengenangaben wörtlich übernehmen — «ein Feld mehr» bleibt «ein Feld mehr», nicht umdeuten. ' +
  'Eigennamen (Personen, Firmen, Baustellen) unverändert lassen. Ist ein Wort kein bekanntes Wort der Ausgangssprache (Hörfehler der Erkennung), dann NICHT raten, was gemeint sein könnte: das Wort unübersetzt in «…» übernehmen. Beispiel: «Unë çuhem amir» → «Ich "çuhem" Amir» (çuhem gibt es nicht, also stehen lassen). ' +
  'Fachbegriffe des Gerüstbaus beibehalten (Feld, Lage, Treppenturm, Konsole, versetzen). ' +
  // Glossar (11.10.2026): ein kurzer italienischer Satz ohne Subjekt liess «ponteggio» stehen (07.10.) — die
  // Baustellenwörter der Sprachen des Betriebs sind hier fest zugeordnet, damit nie ein Fremdwort im Rapport landet.
  'Gerüstbau-Wörter immer so übersetzen: Gerüst = ponteggio, andaime, andamio, échafaudage, rusztowanie, skelë, scaffolding; ' +
  'Feld = campata, tramo, travée, przęsło, bay; Lage = piano/livello, nivel/altura, niveau, poziom, lift; ' +
  'Belag = tavola/impalcato, plataforma/tablón, plancher, podest, deck/board; Geländer = parapetto, barandilla, garde-corps, poręcz, guardrail; ' +
  'Treppenturm = torre scale, torre de escalera, tour d’escalier, wieża schodowa, stair tower; Konsole = mensola, ménsula, console, konsola, bracket; ' +
  'Verankerung = ancoraggio, anclaje, ancrage, kotwienie, anchor/tie; Schutznetz = rete, red, filet, siatka, netting; ' +
  'Bauleitung = direzione lavori, dirección de obra, direction des travaux; Kran = gru, grúa, grue, dźwig, crane. ' +
  'Eine Höhe am Gerüst heisst «Lage» (dritte Lage), nie «Stock» oder «Etage» — ausser es geht ausdrücklich um das Stockwerk des Gebäudes. ' +
  'Nichts hinzufügen, nichts Wichtiges weglassen, nichts bewerten. Bei Unklarheit die Worte des Sprechers lassen. ' +
  'Kurz und sachlich, wie ein Eintrag im Rapport. Nur den bereinigten Text ausgeben, ohne Anführungszeichen, ohne Erklärung. ' +
  'Ist die Notiz nicht auf Deutsch, zuerst sinngemäss übersetzen, dann bereinigen.';

/**
 * Regeln gegen die Fehler aus dem Prüfstand (13.10.2026, Amir: «Albanisch … übersetzt nicht gut», «Italienisch,
 * Arabisch, Polnisch, Spanisch müssen perfekt sein»). Gesehen: «wir» wurde «ich», eine Verneinung wurde erfunden,
 * «verlangt» wurde «erlaubt», deutsche Wörter in fremdem Satz blieben verstümmelt stehen («Boletoune», «grue»),
 * Rollen wurden vertauscht («jefe de obra» → Bauleitung).
 */
const REGELN =
  '\n\nWichtig — diese Fehler nie machen:\n' +
  '- Die Person bleibt: «wir» bleibt «wir», «ich» bleibt «ich». Oft steckt sie nur in der Verbform (kemi/kena, abbiamo, hicimos, zrobiliśmy, ركّبنا, on a = wir).\n' +
  '- Eine Verneinung nur, wenn sie gesagt wurde (s\'/nuk/mos, non, no, nie, ما/لا/مش, ne … pas, não) — nie eine erfinden, nie eine weglassen.\n' +
  '- Wer was wollte, genau übernehmen: «verlangt», «gesagt», «erlaubt», «wollte» sind verschieden.\n' +
  '- «noch», «zusätzlich», «mehr» (edhe, in più, más, więcej, زيادة, de plus, mais) bleiben drin; «etwa», «ungefähr» (nja, un\'oretta, como, z, شي) auch.\n' +
  '- Uhrzeiten am Ende des Arbeitstags im 24-Stunden-Format (halb sieben → 18:30), Morgenzeiten so, wie sie gemeint sind.\n' +
  '- Die Zeitform bleibt: Was gemacht wurde, steht in der Vergangenheit. «früher» heisst früher (prima, antes, wcześniej, më herët), nicht «vorher».\n' +
  '- Kein Wort der Ausgangssprache stehen lassen, ausser einem Namen oder einem unklaren Teil in «…».\n' +
  '- Sauberes, grammatisch richtiges Deutsch (nicht «haben wir später fertig», sondern «waren wir später fertig»).\n' +
  '- Mitten im Satz stehen oft deutsche Baustellenwörter, manchmal mit fremder Endung oder von der Spracherkennung verstümmelt. ' +
  'Sie richtig auf Deutsch schreiben: Gerüst (Gerüst-in, gerust, jerust, geras, juruste, جرست), Polier (Polier-i, poli, pali, poljeri, بولير), ' +
  'Bauleitung (Bauleitung-u, bauleytum, boletoune, baulei tungu, بوليتر), Baumeister (Baumeistra, baumisterit, ميستر), Bauführer, Pause, ' +
  'Feierabend (fajrant), Kran, Lift, Magazin.\n' +
  '- Rollen fest so: capo, jefe, chef, szef, shefi, المعلم allein = immer «Chef» (nie «Polier»); capocantiere, chef de chantier, encargado, encarregado, brygadzista, ' +
  'رئيس الورشة, shefi i kantierit = «Polier»; jefe de obra, kierownik budowy, conducteur de travaux = «Bauführer»; direzione lavori, ' +
  'dirección de obra, direction des travaux, direção de obra, drejtuesi i punimeve = «Bauleitung».\n' +
  '- Fachwörter: gru, grúa, grue, dźwig, رافعة, krani = Kran; lattoniere, hojalatero, ferblantier, blacharz = Spengler; couvreur, telhador, ' +
  'dekarz = Dachdecker; muratore, albañil, maçon, murarz, muratori, بنّاء = Maurer; camion, camión, caminhão, camião, samochód, kamioni, ' +
  'شاحنة = Lastwagen; Gerüst erhöhen (alzare, subir, podnieść, رفع, ngrit) = «um … Lagen erhöht»; Gerüst verlängern (allungare, ' +
  'alargar, przedłużyć, zgjat, prolonger) = «um … Felder verlängert» — erhöhen (in die Höhe) und verlängern (in die Länge) nie verwechseln.\n' +
  '- Strassen-, Baustellen- und Personennamen nie erraten oder weglassen. Steht ein «Kontext» dabei (Baustelle, Leute im Team), ' +
  'einen verstümmelten Namen nach dem Kontext richtig schreiben (artrase, Arstrasse → Aarstrasse). Den Kontext sonst nie in den Text einbauen.\n' +
  '- Lieber eine Lücke als eine Erfindung. Die Spracherkennung macht aus Mundart manchmal Wortsalat. Ergibt ein Teil keinen klaren Sinn, ' +
  'nichts dazudenken, nichts umdeuten und keinen eigenen Zusammenhang bauen: übersetzen, was sicher ist, und den unklaren Teil wörtlich in «…» ' +
  'setzen. Beispiel: «kam vet veç kamioni» → «… «kam vet» … nur noch der Lastwagen …». Lieber ein kurzer, sicherer Satz als ein flüssiger, falscher.';

/** Umgangssprache und Mundart je Sprache — so reden die Leute auf der Baustelle wirklich. */
const MUNDART: Record<string, string> = {
  sq:
    'Albanisch wird oft als Kosovo-Mundart (Gegisch) gesprochen: kena/kem/kemi = wir haben; jemi = wir sind; ' +
    'me + Verb = Infinitiv (me punu = arbeiten, me kalu = durchkommen, me kontrollu = kontrollieren, me e marrë = holen); ' +
    's\'kemi mujt / s\'kena mujt = wir konnten nicht; lyp = verlangen; bo/bë = machen; pas = gehabt; tha = sagte; ' +
    'von/vonë = spät, ma von = später; ma/më = mehr; veç/veq = nur; nja = etwa; krejt = ganz/alles; kah = in Richtung; tash = jetzt; ' +
    'n\' = in/um (n\'gjashtë = um sechs); e gjysë = halb (gjashtë e gjysë = 18:30); ka ra shi = es hat geregnet; prit = gewartet; ' +
    'mbaru = fertig gemacht; ka mbet = es bleibt/fehlt noch; skelë/skela = Gerüst; fushë/fusha = Feld; kati = Stockwerk; ' +
    'kantier = Baustelle; çmontu = abbauen; montu = montieren; zgjat/zgjatëm = verlängern/wir haben verlängert; rrjeta = Netze; bllokú = blockiert. ' +
    'Die Spracherkennung lässt oft ë und ç weg und schreibt Zahlen als Ziffern («1 or» = eine Stunde).',
  ar:
    'Arabisch oft als syrische/levantinische oder irakische Umgangssprache: هيك = so; بدّو = will; ما قدرنا = wir konnten nicht; ' +
    'استنينا = wir haben gewartet; خلّصنا = wir sind fertig geworden; فكّينا = wir haben abgebaut; ركّبنا = wir haben montiert; ' +
    'سادّة/سدّ = blockiert; تيجي تاخد = kommt holen; الغراض = das Material; شي ساعة = etwa eine Stunde; ستة ونص = 18:30; ' +
    'طابق (am Gerüst) = Lage; سقالة = Gerüst; الشبك = Netz; ورشة = Baustelle; المعلم = Chef. ' +
    'Die Spracherkennung schreibt deutsche Wörter in arabischer Schrift (الجرست = Gerüst, البولير = Polier, البوليتر = Bauleitung, ' +
    'بومايستر/ميستر = Baumeister) und verwechselt ähnliche Wörter (المطار statt المطر = Regen, wenn es ums Wetter geht).',
  it:
    'Italienisch, auch süditalienisch gefärbt (\'o = il/lo, amm\' = abbiamo): stamattina = heute Morgen; stasera = heute Abend; ' +
    'un\'oretta = etwa eine Stunde; prima = früher (bei Zeiten); ' +
    'campata = Feld; piano (am Gerüst) = Lage; smontare = abbauen.',
  es:
    'Spanisch aus Spanien und Lateinamerika: ahorita = jetzt/gerade — mit Vergangenheitsform (ahorita desarmamos) = «gerade eben abgebaut», ' +
    'also Vergangenheit; nomás = nur; como una hora = etwa eine Stunde; desarmar = abbauen; ' +
    'tramo = Feld; nivel = Lage; antes = früher (bei Zeiten); estorbar = behindern.',
  pl:
    'Polnisch, auch umgangssprachlich: robić = arbeiten; fajrant = Feierabend; z godzinkę = etwa eine Stunde; przęsło = Feld; ' +
    'poziom (rusztowania) = Lage; deutsche Wörter oft mit polnischer Endung (od Baumeistra = des Baumeisters).',
  pt:
    'Portugiesisch aus Portugal und Brasilien: a gente = wir; caminhão/camião = Lastwagen; nível = Lage; encarregado = Polier.',
  fr:
    'Französisch, auch umgangssprachlich: on = wir; bosser = arbeiten; travée = Feld; niveau = Lage.',
};

/** Die Anweisung für eine Sprache: Grundregeln, die Fehlerliste und die Mundart dieser Sprache. */
function anweisungFuer(sprache: string): string {
  return ANWEISUNG + REGELN + (MUNDART[sprache] ? '\n\n' + MUNDART[sprache] : '');
}

/**
 * Schritt 2 — die Übertragung: (bestätigter) Text → bereinigtes Schweizer Hochdeutsch.
 * `opts` nur für den Prüfstand: anderes Modell, alte Anweisung zum Vergleich.
 */
export async function verdeutschen(
  k: Record<string, string>,
  text: string,
  sprache: string,
  opts: { modell?: string; alt?: boolean; kontext?: string | null } = {},
) {
  // Kontext (Baustelle, Leute im Team) nur zum richtigen Schreiben von Namen — siehe REGELN
  const kontext = opts.kontext && !opts.alt ? `\n\nKontext (nicht übersetzen, nur für Namen): ${opts.kontext}` : '';
  const uebersetzer = opts.modell || k.UEBERSETZUNG_MODELL || 'mistral-small-latest';
  const anfrage = () => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: uebersetzer,
      temperature: 0,
      messages: [
        { role: 'system', content: opts.alt ? ANWEISUNG : anweisungFuer(sprache) },
        { role: 'user', content: `Sprache des Sprechers: ${SPRACHEN[sprache] ?? 'Deutsch'}${kontext}\n\nNotiz:\n${text}` },
      ],
    }),
  });
  // Mistral bremst bei vielen Anfragen gleichzeitig (429 «Rate limit exceeded», 13.10.2026 im Prüfstand) — abends
  // melden alle Teams fast gleichzeitig. Kurz warten und nochmals, statt dem Chefmonteur einen Fehler zu zeigen.
  let ue = await anfrage();
  for (let versuch = 1; ue.status === 429 && versuch <= 4; versuch++) {
    await new Promise((w) => setTimeout(w, 800 * versuch + Math.random() * 400));
    ue = await anfrage();
  }
  if (!ue.ok) throw new Error(`Übersetzung ${ue.status}: ${(await ue.text()).slice(0, 300)}`);
  const j = (await ue.json()) as { choices?: { message?: { content?: string } }[] };
  const deutsch = (j.choices?.[0]?.message?.content ?? '').trim() || text;
  return { transkript: deutsch, quelle: deutsch === text ? null : text, sprache };
}
