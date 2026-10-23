import { describe, it, expect } from 'vitest';
import { adresseText, hausnummerFehlt, istApple, navigationsLink, suchText, trefferAusAntwort, trefferSortieren, wgsZuLv03 } from './adresse';

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
