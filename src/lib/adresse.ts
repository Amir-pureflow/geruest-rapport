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
const PROJEKTWOERTER = /(?<!\p{L})(fassaden?|dachsanierung|dach|sanierung|gesamtsanierung|neubau|umbau|anbau|ausbau|renovation|renovierung|wohnüberbauung|überbauung|mehrfamilienhaus|mfh|efh|einfamilienhaus|reihenhäuser|reihenhaus|siedlung|schulanlage|schulhaus|turnhalle|bürohaus|gewerbehaus|alterszentrum|etappe|baufeld|haus|gebäude|areal)(?!\p{L})/giu;

/** Womit die Suche beginnt: die gespeicherte Adresse, sonst die Bezeichnung ohne Projektwörter, mit PLZ — änderbar. */
export function suchText(b: Lage): string {
  const ort = [b.plz, b.ort].filter(Boolean).join(' ');
  if (b.strasse) return [b.strasse, ort].filter(Boolean).join(' ');
  const ohne = (b.bezeichnung ?? '').replace(PROJEKTWOERTER, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
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

/** Kennt das Verzeichnis die gesuchte Hausnummer nicht («Monbijoustrasse 55»), steht das dabei — dann genau hinschauen. */
export function hausnummerFehlt(suche: string, treffer: Treffer[]): string | null {
  const nr = /(?<![\d\p{L}])(\d{1,4}[a-z]?)(?![\d\p{L}])/iu.exec(suche.replace(/\b\d{4}\b(?=\s+\p{L})/u, ''))?.[1];
  if (!nr || treffer.length === 0) return null;
  return treffer.some((t) => new RegExp(`(^|\\s)${nr}$`, 'i').test(t.strasse)) ? null : nr;
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
