import { describe, it, expect } from 'vitest';
import { adresseText, aufbereiten, hausnummerFehlt, istApple, navigationsLink, suchText, trefferAusAntwort, trefferBewerten, trefferSortieren, wgsZuLv03 } from './adresse';

describe('wgsZuLv03 — Suchgebiet für die Adresssuche', () => {
  it('alte Sternwarte Bern ≈ 600 000 / 200 000 (Ursprung von LV03), Bundesplatz daneben', () => {
    const s = wgsZuLv03(46.9510811, 7.4386372);
    expect(Math.abs(s.e - 600000)).toBeLessThan(5);
    expect(Math.abs(s.n - 200000)).toBeLessThan(5);
    const b = wgsZuLv03(46.946774, 7.444191);
    expect(Math.round((b.e - s.e) / 10) * 10).toBe(420);
    expect(Math.round((b.n - s.n) / 10) * 10).toBe(-480);
  });
});

describe('trefferAusAntwort — Adresssuche geo.admin.ch', () => {
  it('liest Strasse, PLZ, Ort und Koordinaten aus dem Label', () => {
    const json = { results: [
      { attrs: { label: 'Bundesplatz 3 <b>3011 Bern</b>', lat: 46.94677, lon: 7.44419 } },
      { attrs: { label: 'Waldstrasse 6 <b>3052 Zollikofen</b>', lat: 47.00368, lon: 7.45991 } },
    ] };
    expect(trefferAusAntwort(json)).toEqual([
      { strasse: 'Bundesplatz 3', plz: '3011', ort: 'Bern', lat: 46.94677, lon: 7.44419 },
      { strasse: 'Waldstrasse 6', plz: '3052', ort: 'Zollikofen', lat: 47.00368, lon: 7.45991 },
    ]);
  });
  it('Ortsnamen mit Leerzeichen und Zusatz', () => {
    expect(trefferAusAntwort({ results: [{ attrs: { label: 'Dorfstrasse 1 <b>3123 Belp</b>', lat: 1, lon: 2 } }, { attrs: { label: 'Bahnhofplatz 2 <b>2502 Biel/Bienne</b>', lat: 3, lon: 4 } }] }).map((t) => t.ort))
      .toEqual(['Belp', 'Biel/Bienne']);
  });
  it('Unbrauchbares fällt weg, kaputte Antwort = leer', () => {
    expect(trefferAusAntwort({ results: [{ attrs: { label: 'ohne PLZ', lat: 1, lon: 2 } }, { attrs: { label: 'X 1 <b>3000 Bern</b>' } }, {}] })).toEqual([]);
    expect(trefferAusAntwort(null)).toEqual([]);
    expect(trefferAusAntwort({ results: 'x' })).toEqual([]);
  });
});

describe('suchText', () => {
  it('gespeicherte Adresse zuerst, sonst Bezeichnung und PLZ', () => {
    expect(suchText({ bezeichnung: 'Neubau X', strasse: 'Waldstrasse 6', plz: '3052', ort: 'Zollikofen' })).toBe('Waldstrasse 6 3052 Zollikofen');
    expect(suchText({ bezeichnung: 'Zollikofen Waldstrasse 6', plz: '3052' })).toBe('Zollikofen Waldstrasse 6 3052');
  });
  it('Projektwörter fallen weg (sonst findet die Suche Unsinn), Orte bleiben', () => {
    expect(suchText({ bezeichnung: 'Fassade Monbijoustrasse 55' })).toBe('Monbijoustrasse 55');
    expect(suchText({ bezeichnung: 'Dachsanierung Kramgasse 41' })).toBe('Kramgasse 41');
    expect(suchText({ bezeichnung: 'Reihenhäuser Muri, Thunstrasse' })).toBe('Muri Thunstrasse');
    expect(suchText({ bezeichnung: 'Mehrfamilienhaus Lorrainestrasse 18', plz: '3013' })).toBe('Lorrainestrasse 18 3013');
    expect(suchText({ bezeichnung: 'Wohnüberbauung Brünnenpark, Haus B' })).toBe('Brünnenpark B');
    expect(suchText({ bezeichnung: 'Hausmattweg 4' })).toBe('Hausmattweg 4'); // «Haus» nur als ganzes Wort
  });
});

describe('aufbereiten — Bezeichnungen, wie das Büro sie tippt (217 Konten der Gerüst GmbH)', () => {
  it('«str.» ausgeschrieben, Nummer abgetrennt, Bereich = erste Nummer, Unterstrich = Leerschlag', () => {
    expect(aufbereiten('Gümligen Worbstr.262')).toBe('Gümligen Worbstrasse 262');
    expect(aufbereiten('Wabern Seftigenstr. 309 Grünau')).toBe('Wabern Seftigenstrasse 309 Grünau');
    expect(aufbereiten('Zollikofen Linckweg 2-15')).toBe('Zollikofen Linckweg 2');
    expect(aufbereiten('Ittigen Mühlestrasse 11-23')).toBe('Ittigen Mühlestrasse 11');
    expect(aufbereiten('Aarstrasse_Hängegerüst')).toBe('Aarstrasse Hängegerüst');
    expect(aufbereiten('Bottigenstrasse 217a')).toBe('Bottigenstrasse 217a');
    expect(aufbereiten('Steffisburg Glockentalstr 4-10')).toBe('Steffisburg Glockentalstrasse 4');
    expect(aufbereiten('Biel General-Dufour-Str. 104')).toBe('Biel General-Dufour-strasse 104');
  });
  it('Listen von Nummern: die erste; eine PLZ nach dem Komma bleibt', () => {
    expect(aufbereiten('Moosseedorf Nassegasse19,21,23')).toBe('Moosseedorf Nassegasse 19');
    expect(aufbereiten('Blumenweg 5+7')).toBe('Blumenweg 5');
    expect(aufbereiten('Gümligen Vorackerrain 1 + 3')).toBe('Gümligen Vorackerrain 1');
    expect(aufbereiten('Schosshaldenstrasse 22, 22a')).toBe('Schosshaldenstrasse 22');
    expect(aufbereiten('Rubigen Schulhausgasse 2a + 4a')).toBe('Rubigen Schulhausgasse 2a');
    expect(aufbereiten('Waldstrasse 6, 3052 Zollikofen')).toBe('Waldstrasse 6, 3052 Zollikofen');
  });
  it('suchText nimmt die aufbereitete Bezeichnung, Gerüst-Wörter fallen weg', () => {
    expect(suchText({ bezeichnung: 'Aarstrasse_Hängegerüst' })).toBe('Aarstrasse');
    expect(suchText({ bezeichnung: 'Billeweg 3_Längsbau Brünnen' })).toBe('Billeweg 3 Brünnen');
    expect(suchText({ bezeichnung: 'Neuenegg Laupenstr. 10' })).toBe('Neuenegg Laupenstrasse 10');
  });
});

describe('trefferBewerten — was das Büro gesammelt übernehmen darf', () => {
  const t = (strasse: string, plz: string, ort: string, lat = 46.94, lon = 7.45) => ({ strasse, plz, ort, lat, lon });
  it('Strasse und Nummer stimmen: sicher', () => {
    expect(trefferBewerten('Muri Thunstrasse 99', [t('Thunstrasse 99', '3074', 'Muri b. Bern'), t('Thunstrasse 99b', '3074', 'Muri b. Bern')]).stufe).toBe('sicher');
    expect(trefferBewerten('Morgenstrasse 70', [t('Morgenstrasse 70', '3018', 'Bern')]).stufe).toBe('sicher');
    expect(trefferBewerten('Bottigenstrasse 217a', [t('Bottigenstrasse 217a', '3018', 'Bern')]).stufe).toBe('sicher');
  });
  it('andere Strasse oder andere Nummer: prüfen', () => {
    const r = trefferBewerten('Spiegel Föhrenweg 54', [t('Spiegelstrasse 54', '3095', 'Spiegel b. Bern')]);
    expect(r.stufe).toBe('pruefen');
    expect(r.grund).toContain('Spiegelstrasse 54');
    expect(trefferBewerten('Monbijoustrasse 55', [t('Monbijoustrasse 5', '3011', 'Bern')]).grund).toBe('Hausnummer 55 nicht im Verzeichnis');
  });
  it('ohne Hausnummer oder ohne Treffer', () => {
    expect(trefferBewerten('Ittigen Altikofen', [t('Altikofenstrasse 2', '3048', 'Worblaufen')]).stufe).toBe('pruefen');
    expect(trefferBewerten('Biel Schnyder', []).stufe).toBe('keiner');
  });
  it('gleiche Adresse in zwei Orten: nur sicher, wenn der Ort in der Bezeichnung steht', () => {
    const zwei = [t('Hirschengraben 24', '3011', 'Bern'), t('Hirschengraben 24', '8001', 'Zürich', 47.37, 8.55)];
    expect(trefferBewerten('Hirschengraben 24', zwei).stufe).toBe('pruefen');
    expect(trefferBewerten('Bern Hirschengraben 24', zwei).stufe).toBe('sicher');
  });
  it('weit weg vom Gebiet der Firma: prüfen, ausser der Ort ist genannt', () => {
    const zuerich = [t('Seminarstrasse 18', '8057', 'Zürich', 47.39, 8.54)];
    expect(trefferBewerten('Seminarstrasse 18', zuerich, { lat: 46.95, lon: 7.45 }).stufe).toBe('pruefen');
    expect(trefferBewerten('Zürich Seminarstrasse 18', zuerich, { lat: 46.95, lon: 7.45 }).stufe).toBe('sicher');
  });
  it('genau die gesuchte Nummer, auch wenn «15a» zuerst kommt', () => {
    const r = trefferBewerten('Brückenstrasse 15', [t('Brückenstrasse 15a', '3005', 'Bern'), t('Brückenstrasse 15', '3005', 'Bern')]);
    expect(r.stufe).toBe('sicher');
    expect(r.treffer?.strasse).toBe('Brückenstrasse 15');
  });
  it('zweisprachige Strasse und Akzente', () => {
    expect(trefferBewerten(suchText({ bezeichnung: 'Biel General-Dufour-Str. 104' }), [t('Rue du Général-Dufour / General-Dufour-Strasse 104', '2502', 'Biel/Bienne', 47.14, 7.25)]).stufe).toBe('sicher');
    expect(trefferBewerten('Fribourg Route du Riedle 13', [t('Route du Riedlé 13', '1700', 'Fribourg', 46.8, 7.16)]).stufe).toBe('sicher');
  });
  it('gleiche Adresse in der Nähe: sicher nur, wenn die andere deutlich weiter weg liegt', () => {
    const naehe = { lat: 46.947, lon: 7.435 };
    const fabrik = [t('Fabrikstrasse 8', '3012', 'Bern', 46.955, 7.43), t('Fabrikstrasse 8', '3250', 'Lyss', 47.074, 7.306)];
    expect(trefferBewerten('Fabrikstrasse 8', fabrik, naehe).stufe).toBe('sicher');
    const bantiger = [t('Bantigerstrasse 20', '3006', 'Bern', 46.952, 7.46), t('Bantigerstrasse 20', '3072', 'Ostermundigen', 46.955, 7.485)];
    expect(trefferBewerten('Bantigerstrasse 20', bantiger, naehe).stufe).toBe('pruefen');
    expect(trefferBewerten('Fabrikstrasse 8', fabrik).stufe).toBe('pruefen'); // ohne Gebiet der Firma: lieber fragen
  });
  it('«str.» in der Bezeichnung zählt wie «strasse»', () => {
    expect(trefferBewerten(suchText({ bezeichnung: 'Gümligen Worbstr.262' }), [t('Worbstrasse 262', '3073', 'Gümligen')]).stufe).toBe('sicher');
  });
});

describe('trefferSortieren und hausnummerFehlt', () => {
  const t = (strasse: string, plz: string, ort: string, lat: number, lon: number) => ({ strasse, plz, ort, lat, lon });
  const herzogenbuchsee = t('Lorrainestrasse 18', '3360', 'Herzogenbuchsee', 47.19, 7.70);
  const bern = t('Lorrainestrasse 18', '3013', 'Bern', 46.957, 7.444);
  it('gleiche PLZ zuerst, sonst der nächste beim Gebiet der Firma', () => {
    expect(trefferSortieren([herzogenbuchsee, bern], { plz: '3013' })[0].ort).toBe('Bern');
    expect(trefferSortieren([herzogenbuchsee, bern], { naehe: { lat: 46.95, lon: 7.45 } })[0].ort).toBe('Bern');
    expect(trefferSortieren([herzogenbuchsee, bern], {})[0].ort).toBe('Herzogenbuchsee'); // ohne Hinweis: Reihenfolge der Suche
  });
  it('Hausnummer nicht im Verzeichnis: wird gemeldet; PLZ zählt nicht als Hausnummer', () => {
    const monbijou = [t('Monbijoustrasse 3', '3011', 'Bern', 0, 0), t('Monbijoustrasse 5', '3011', 'Bern', 0, 0)];
    expect(hausnummerFehlt('Monbijoustrasse 55', monbijou)).toBe('55');
    expect(hausnummerFehlt('Kramgasse 41', [t('Kramgasse 41', '3011', 'Bern', 0, 0)])).toBeNull();
    expect(hausnummerFehlt('3011 Bern Kramgasse 41', [t('Kramgasse 41', '3011', 'Bern', 0, 0)])).toBeNull();
    expect(hausnummerFehlt('Muri Thunstrasse', [t('Thunstrasse 2', '3074', 'Muri b. Bern', 0, 0)])).toBeNull();
  });
});

describe('adresseText — zweite Zeile ohne Doppeltes', () => {
  it('ganze Adresse, wenn die Bezeichnung ein Projektname ist', () => {
    expect(adresseText({ bezeichnung: 'Wohnüberbauung Brünnenpark, Haus B', strasse: 'Brünnenstrasse 120', plz: '3027', ort: 'Bern' })).toBe('Brünnenstrasse 120, 3027 Bern');
  });
  it('steht die Strasse schon in der Bezeichnung: nur PLZ und Ort', () => {
    expect(adresseText({ bezeichnung: 'Fassade Monbijoustrasse 55', strasse: 'Monbijoustrasse 55', plz: '3007', ort: 'Bern' })).toBe('3007 Bern');
  });
  it('Strasse und Ort in der Bezeichnung: nur die PLZ', () => {
    expect(adresseText({ bezeichnung: 'Zollikofen Waldstrasse 6', strasse: 'Waldstrasse 6', plz: '3052', ort: 'Zollikofen' })).toBe('3052');
  });
  it('ohne Strasse und Ort: null', () => {
    expect(adresseText({ bezeichnung: 'Biel Schnyder Areal', plz: '2502' })).toBeNull();
  });
});

describe('navigationsLink', () => {
  const geprueft = { bezeichnung: 'Bundeshaus', strasse: 'Bundesplatz 3', plz: '3011', ort: 'Bern', lat: 46.946774, lon: 7.4441912 };
  it('mit Koordinaten: Google bzw. Apple, genau dorthin', () => {
    expect(navigationsLink(geprueft, false)).toBe('https://www.google.com/maps/dir/?api=1&destination=46.946774,7.444191&travelmode=driving');
    expect(navigationsLink(geprueft, true)).toBe('https://maps.apple.com/?daddr=46.946774,7.444191&dirflg=d');
  });
  it('ohne Koordinaten: über den Text, mit «Schweiz»', () => {
    expect(navigationsLink({ bezeichnung: 'Zollikofen Waldstrasse 6', plz: '3052' }, false))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=Zollikofen%20Waldstrasse%206%203052%2C%20Schweiz&travelmode=driving');
    expect(navigationsLink({ strasse: 'Waldstrasse 6', plz: '3052', ort: 'Zollikofen' }, true))
      .toBe('https://maps.apple.com/?daddr=Waldstrasse%206%2C%203052%20Zollikofen%2C%20Schweiz&dirflg=d');
  });
});

describe('istApple', () => {
  it('iPhone und iPad ja, Android und Windows nein', () => {
    expect(istApple('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(istApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true); // iPadOS
    expect(istApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(istApple('Mozilla/5.0 (Linux; Android 14; SM-S918B)')).toBe(false);
  });
});
