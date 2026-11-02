/**
 * Ort der Baustelle (24.10.2026, Amir: «eine Karte, die den Ort der Baustelle darstellt»).
 *
 * Bisher stand die Adresse nur als freier Text in der Bezeichnung («Zollikofen Waldstrasse 6»), dazu die PLZ. Jetzt:
 * Strasse, PLZ und Ort in den Spalten von 0001, dazu Koordinaten (0050) — gesucht über die Adresssuche des Bundes
 * (geo.admin.ch, swisstopo, ohne Schlüssel, «© swisstopo» muss sichtbar sein). Das Büro bestätigt jeden Treffer selbst,
 * nichts wird still übernommen.
 *
 * «Navigieren» ist nur ein Link (Google Karten, auf dem iPhone Apple Karten) — kein Kartendienst in der App, keine
 * Standortabfrage. Die Adresse geht erst beim Antippen an Google bzw. Apple.
 */

export interface Lage {
  bezeichnung?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** Ein Treffer der Adresssuche. */
export interface Treffer { strasse: string; plz: string; ort: string; lat: number; lon: number }

const SUCHE = 'https://api3.geo.admin.ch/rest/services/ech/SearchServer';

/** geo.admin.ch liefert `label` wie «Bundesplatz 3 <b>3011 Bern</b>» und `lat`/`lon` (WGS84) — daraus die Treffer. */
export function trefferAusAntwort(json: unknown): Treffer[] {
  const results = (json as { results?: { attrs?: { label?: unknown; lat?: unknown; lon?: unknown } }[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Treffer[] = [];
  for (const r of results) {
    const a = r?.attrs;
    if (!a || typeof a.label !== 'string' || typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    const m = /^(.*?)\s*<b>\s*(\d{4})\s+(.+?)\s*<\/b>\s*$/.exec(a.label);
    if (!m) continue;
    const strasse = m[1].replace(/<[^>]*>/g, '').trim();
    if (!strasse) continue;
    out.push({ strasse, plz: m[2], ort: m[3].replace(/<[^>]*>/g, '').trim(), lat: a.lat, lon: a.lon });
  }
  return out;
}

/**
 * Wörter aus Projektnamen, die keine Adresse sind. Mit ihnen sucht geo.admin.ch unscharf und findet Unsinn
 * («Fassade Monbijoustrasse 55» → «Plän Vest 55, Soglio»; ohne «Fassade» → Monbijoustrasse in Bern, getestet 24.10.2026).
 */
const PROJEKTWOERTER = /(?<!\p{L})(fassaden?|dachsanierung|dach|sanierung|gesamtsanierung|neubau|umbau|anbau|ausbau|renovation|renovierung|wohnüberbauung|überbauung|mehrfamilienhaus|mfh|efh|einfamilienhaus|reihenhäuser|reihenhaus|siedlung|schulanlage|schulhaus|turnhalle|bürohaus|gewerbehaus|alterszentrum|etappe|baufeld|haus|gebäude|areal|hängegerüst|fassadengerüst|schutzgerüst|gerüst|notdach|längsbau|querbau)(?!\p{L})/giu;

/**
 * Bezeichnung so, wie sie das Büro tippt, für die Suche aufbereiten (25.10.2026, 217 Konten der Gerüst GmbH):
 * «Worbstr.262» → «Worbstrasse 262», «Glockentalstr 4-10» → «Glockentalstrasse 4» (erste Nummer), «Nassegasse19,21,23»
 * → «Nassegasse 19», «Aarstrasse_Hängegerüst» → «Aarstrasse Hängegerüst». Sonst findet die Suche die Nummer nicht oder
 * sucht nach «262» als eigenem Wort. Eine PLZ nach einem Komma («Waldstrasse 6, 3052 Zollikofen») bleibt stehen.
 */
export function aufbereiten(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/(\p{L}-?)str\.?(?=\s|\d|$)/giu, '$1strasse ')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(?<![\d\p{L}])(\d{1,4}[a-z]?)((?:\s*(?:[-–/,+&]|und)\s*(?!\d{4}\s+\p{L})\d{1,4}[a-z]?(?![\d\p{L}]))+)/giu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Womit die Suche beginnt: die gespeicherte Adresse, sonst die Bezeichnung ohne Projektwörter, mit PLZ — änderbar. */
export function suchText(b: Lage): string {
  const ort = [b.plz, b.ort].filter(Boolean).join(' ');
  if (b.strasse) return [b.strasse, ort].filter(Boolean).join(' ');
  const ohne = aufbereiten(b.bezeichnung ?? '').replace(PROJEKTWOERTER, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  return [ohne || b.bezeichnung, b.plz].filter((x) => x && x.trim()).join(' ').trim();
}

/** Abstand in km (gross genug genau für «welcher Treffer liegt näher»). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dx = (a.lon - b.lon) * 111.3 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = (a.lat - b.lat) * 111.3;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Wahrscheinlichster Treffer zuerst: gleiche PLZ, dann die Nähe zum Gebiet der Firma (Werkhof oder Mittelpunkt der
 * schon geprüften Baustellen) — «Lorrainestrasse 18» ohne PLZ brachte zuerst Herzogenbuchsee, die Firma ist in Bern.
 */
export function trefferSortieren(treffer: Treffer[], o: { plz?: string | null; naehe?: { lat: number; lon: number } | null }): Treffer[] {
  return treffer
    .map((t, i) => ({ t, i, plz: o.plz && t.plz === o.plz ? 0 : 1, d: o.naehe ? km(t, o.naehe) : 0 }))
    .sort((x, y) => x.plz - y.plz || x.d - y.d || x.i - y.i)
    .map((x) => x.t);
}

/** Die gesuchte Hausnummer («Thunstrasse 99b» → «99b»); eine PLZ vor einem Ortsnamen zählt nicht. */
function hausnummer(suche: string): string | null {
  return /(?<![\d\p{L}])(\d{1,4}[a-z]?)(?![\d\p{L}])/iu.exec(suche.replace(/\b\d{4}\b(?=\s+\p{L})/u, ''))?.[1] ?? null;
}

/** Kennt das Verzeichnis die gesuchte Hausnummer nicht («Monbijoustrasse 55»), steht das dabei — dann genau hinschauen. */
export function hausnummerFehlt(suche: string, treffer: Treffer[]): string | null {
  const nr = hausnummer(suche);
  if (!nr || treffer.length === 0) return null;
  return treffer.some((t) => new RegExp(`(^|\\s)${nr}$`, 'i').test(t.strasse)) ? null : nr;
}

/** Zum Vergleichen: klein, ohne Akzente («Riedlé» = «Riedle»), «str.» = «strasse», ohne Leerzeichen, Bindestriche, Punkte */
const vergleich = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de-CH').replace(/ß/g, 'ss').replace(/str\.(?=\s|$)/g, 'strasse').replace(/[\s.\-–'’]/g, '');

export type Sicherheit = 'sicher' | 'pruefen' | 'keiner';

/**
 * Wie sicher ist ein Treffer (Sammel-Zuordnung, 25.10.2026)? Genommen wird der nächste Treffer mit genau der gesuchten
 * Hausnummer («15» vor «15a»). «sicher» nur, wenn Strasse UND Hausnummer so in der Bezeichnung stehen und es die
 * Adresse nicht auch in einem anderen Ort in der Nähe gibt — ausser der Ort steht in der Bezeichnung, oder der Treffer
 * liegt im Gebiet der Firma (≤ 15 km) und die anderen deutlich weiter weg («Fabrikstrasse 8»: Bern 1 km, Lyss 17 km).
 * Alles andere prüft das Büro selbst — z. B. «Spiegel Föhrenweg 54» fand nur «Spiegelstrasse 54», «Bantigerstrasse 20»
 * gibt es in Bern und gleich daneben in Ostermundigen. `treffer` schon sortiert (trefferSortieren).
 */
export function trefferBewerten(suche: string, treffer: Treffer[], naehe?: { lat: number; lon: number } | null): { stufe: Sicherheit; grund: string | null; treffer: Treffer | null } {
  if (treffer.length === 0) return { stufe: 'keiner', grund: 'Keine Adresse gefunden', treffer: null };
  const nr = hausnummer(suche);
  if (!nr) return { stufe: 'pruefen', grund: 'Ohne Hausnummer in der Bezeichnung', treffer: null };
  const nummerVon = (x: Treffer) => /\s(\d{1,4}[a-z]?)$/iu.exec(x.strasse)?.[1]?.toLowerCase() ?? null;
  const t = treffer.find((x) => nummerVon(x) === nr.toLowerCase());
  if (!t) return { stufe: 'pruefen', grund: `Hausnummer ${nr} nicht im Verzeichnis`, treffer: null };
  // Zweisprachige Strassen: «Rue du Général-Dufour / General-Dufour-Strasse 104» — eine der beiden genügt
  const namen = t.strasse.replace(/\s+\d{1,4}[a-z]?$/iu, '').split(/\s+\/\s+/);
  if (!namen.some((n) => vergleich(suche).includes(vergleich(n)))) return { stufe: 'pruefen', grund: `Gefunden: ${t.strasse} — andere Strasse?`, treffer: t };
  const ortGenannt = vergleich(suche).includes(vergleich(t.ort)) || vergleich(suche).includes(vergleich(t.ort.split(/[\s/]/)[0])) || suche.includes(t.plz);
  const anderswo = treffer.filter((x) => x !== t && vergleich(x.strasse) === vergleich(t.strasse) && x.plz !== t.plz);
  if (anderswo.length > 0 && !ortGenannt) {
    const d = naehe ? km(t, naehe) : null;
    const klar = d !== null && d <= 15 && anderswo.every((x) => km(x, naehe!) >= Math.max(3 * d, d + 8));
    if (!klar) return { stufe: 'pruefen', grund: `${t.strasse} gibt es in mehreren Orten`, treffer: t };
  }
  if (naehe && !ortGenannt && km(t, naehe) > 50) return { stufe: 'pruefen', grund: `Liegt weit weg (${t.ort})`, treffer: t };
  return { stufe: 'sicher', grund: null, treffer: t };
}

/**
 * WGS84 → Schweizer Landeskoordinaten LV03 (Näherungsformel von swisstopo, auf etwa 1 m genau). Die Adresssuche nimmt
 * ihr Suchgebiet (`bbox`) nur in LV03 an — in WGS84 kam nichts zurück (getestet 24.10.2026).
 */
export function wgsZuLv03(lat: number, lon: number): { e: number; n: number } {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lon * 3600 - 26782.5) / 10000;
  return {
    e: 600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
    n: 200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p,
  };
}

/**
 * Adresssuche des Bundes (bis 10 Treffer, sortiert wird danach). Mit `naehe` zuerst im Umkreis von etwa 60 km — dort
 * kommt der nächste Treffer zuerst («Lorrainestrasse 18»: Bern vor Herzogenbuchsee); findet sie dort nichts, in der
 * ganzen Schweiz. Wirft bei Netzfehlern (die Seite sagt es dann).
 */
export async function adresseSuchen(text: string, naehe?: { lat: number; lon: number } | null, signal?: AbortSignal): Promise<Treffer[]> {
  const q = text.trim();
  if (q.length < 3) return [];
  const basis = `${SUCHE}?searchText=${encodeURIComponent(q)}&type=locations&origins=address&sr=4326&limit=10`;
  const holen = async (url: string) => {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`Adresssuche antwortet nicht (${r.status})`);
    return trefferAusAntwort(await r.json());
  };
  if (naehe) {
    const { e, n } = wgsZuLv03(naehe.lat, naehe.lon);
    const r = 60000;
    const nah = await holen(`${basis}&bbox=${Math.round(e - r)},${Math.round(n - r)},${Math.round(e + r)},${Math.round(n + r)}`);
    if (nah.length > 0) return nah;
  }
  return holen(basis);
}

const klein = (s: string) => s.toLocaleLowerCase('de-CH').replace(/\s+/g, ' ');

/**
 * Zweite Zeile unter der Bezeichnung: «Waldstrasse 6, 3052 Zollikofen». Was wörtlich schon in der Bezeichnung steht,
 * kommt nicht nochmals (aus «Zollikofen Waldstrasse 6» wird «3052»). Ohne Strasse und Ort: null.
 */
export function adresseText(b: Lage): string | null {
  if (!b.strasse && !b.ort) return null;
  const bez = klein(b.bezeichnung ?? '');
  const strasse = b.strasse && !bez.includes(klein(b.strasse)) ? b.strasse : null;
  const ortSchon = !!b.ort && bez.includes(klein(b.ort));
  const ort = [b.plz, ortSchon && !strasse ? null : b.ort].filter(Boolean).join(' ');
  const teile = [strasse, ort].filter((x) => x && x.trim());
  return teile.length ? teile.join(', ') : null;
}

/** Sind die Koordinaten geprüft (Treffer der Suche oder von Hand gesetzt)? */
export function hatKoordinaten(b: Lage): b is Lage & { lat: number; lon: number } {
  return typeof b.lat === 'number' && typeof b.lon === 'number';
}

/** iPhone und iPad (auch iPadOS, das sich als Mac ausgibt) → Apple Karten. */
export function istApple(ua: string, beruehrungspunkte = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && beruehrungspunkte > 1);
}

/**
 * Link für «Navigieren» — Route zur Baustelle in der Karten-App des Handys. Mit geprüften Koordinaten genau dorthin,
 * sonst über den Text (Strasse, PLZ, Ort bzw. Bezeichnung und PLZ), mit «Schweiz», damit nichts im Ausland landet.
 */
export function navigationsLink(b: Lage, apple: boolean): string {
  if (hatKoordinaten(b)) {
    const ziel = `${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;
    return apple ? `https://maps.apple.com/?daddr=${ziel}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${ziel}&travelmode=driving`;
  }
  const text = `${b.strasse ? [b.strasse, [b.plz, b.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') : suchText(b)}, Schweiz`;
  return apple ? `https://maps.apple.com/?daddr=${encodeURIComponent(text)}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}&travelmode=driving`;
}
