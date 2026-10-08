/**
 * Einstellungen der angemeldeten Firma — ein Code, pro Firma anders (Entscheid 02.10.2026).
 *
 * Jede Firma arbeitet anders: die eine will nur das Wochenblatt (Normal + Überstunden), die andere
 * den vollen Regie-Ablauf mit Symbolen. Statt zwei Zweigen gibt es Schalter. (Die Mehrkostenanzeige
 * «Bauleitung informieren» ist am 06.10.2026 auf Wunsch von Amir ganz entfernt worden.)
 *
 * Seit Migration 0019 stehen sie in der Zeile der Firma (Tabelle `firma`), nicht mehr global in
 * `konfiguration`. Erst dadurch kann dieselbe App der einen Firma die Regie-Fassung zeigen und der
 * anderen das Wochenblatt. Gelesen wird nach der Anmeldung, einmal, danach aus dem Zwischenspeicher:
 * die Erfassung läuft offline und darf auf keine Abfrage warten.
 */
import { supabase } from './supabase';
import { NORMALTAG_MIN } from './datum';
import { markiertePersonen } from './zeiten';

export interface Einstellungen {
  /** 'wochenblatt' = nur Normal + Überstunden · 'regie' = zusätzlich Symbole, «Wer wollte das?», Stunden je Person */
  erfassung: 'wochenblatt' | 'regie';
  /** 'stunden' = nur Stunden, Export, Verwaltung · 'voll' = alles wie der Bauführer */
  sekretariat: 'stunden' | 'voll';
  /** Normaler Arbeitstag in Minuten (Migration 0026) — alles darüber sind Überstunden. Gerüst GmbH 504 = 8.4 h. */
  normaltagMin: number;
  /**
   * «Gelb markieren ab» in Minuten (Migration 0028): erst ab diesem Tagestotal einer Person wird ein Tag mit
   * Überstunden gelb. null = wie der normale Arbeitstag, jede Überstunde wird gelb. Gerüst GmbH 540 = 9.0 h.
   */
  markierenAbMin: number | null;
}

export const STANDARD: Einstellungen = { erfassung: 'wochenblatt', sekretariat: 'stunden', normaltagMin: NORMALTAG_MIN, markierenAbMin: null };

/** Erlaubter Bereich für den normalen Arbeitstag: 6.0 bis 10.0 h, in Schritten von 6 Minuten (0.1 h). */
export const NORMALTAG_BEREICH = { min: 360, max: 600, schritt: 6 } as const;

function gueltigerNormaltag(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= NORMALTAG_BEREICH.min && x <= NORMALTAG_BEREICH.max ? Math.round(x) : null;
}

/** Erlaubter Bereich für «Gelb markieren ab»: 6.0 bis 10.0 h — über 10 h bleibt ein Tag damit immer markiert (0028). */
const MARKIEREN_BEREICH = { min: 360, max: 600 } as const;

function gueltigeMarkierung(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= MARKIEREN_BEREICH.min && x <= MARKIEREN_BEREICH.max ? Math.round(x) : null;
}

const KEY = 'firma-einstellungen';
/** Spalte in `firma` je Schalter. */
const SPALTE = {
  erfassung: 'modus_erfassung',
  sekretariat: 'modus_sekretariat',
  normaltagMin: 'normaltag_min',
  markierenAbMin: 'markieren_ab_min',
} as const;

/** Kam der normale Arbeitstag aus der Datenbank? `false` = Migration 0026 fehlt, es gilt der Standard 8.4 h. */
let normaltagGelesen: boolean | null = null;
/** Kam «Gelb markieren ab» aus der Datenbank? `false` = Migration 0028 fehlt, jede Überstunde wird gelb. */
let markierenGelesen: boolean | null = null;

let zwischenspeicher: Einstellungen = lesenLokal();
/** Hat die Datenbank beim letzten Versuch geliefert? null = noch nicht versucht oder offline. */
let gelesen: boolean | null = null;
/** Die eigene Firma — fürs Speichern der Schalter und für den Namen in der Kopfzeile. */
let firma: { id: string; name: string } | null = null;

/**
 * Briefkopf für den Regierapport als PDF (Migration 0021). Steht bei der Firma, nicht global:
 * das PDF landet beim Kunden, dort muss der richtige Betrieb oben stehen.
 */
export interface Briefkopf {
  name: string; slogan: string; adresse: string; tel: string; fax: string;
  mail: string; web: string; bank: string; mwst: string;
}
export const BRIEFKOPF_LEER: Briefkopf = { name: '', slogan: '', adresse: '', tel: '', fax: '', mail: '', web: '', bank: '', mwst: '' };
const BRIEFKOPF_SPALTE: Record<keyof Briefkopf, string> = {
  name: 'briefkopf_name', slogan: 'briefkopf_slogan', adresse: 'briefkopf_adresse',
  tel: 'briefkopf_tel', fax: 'briefkopf_fax', mail: 'briefkopf_mail',
  web: 'briefkopf_web', bank: 'briefkopf_bank', mwst: 'briefkopf_mwst',
};
let briefkopfStand: Briefkopf = BRIEFKOPF_LEER;

/** Der zuletzt gelesene Briefkopf. */
export function briefkopf(): Briefkopf {
  return briefkopfStand;
}

/** Briefkopf speichern. Leere Felder werden zu null, damit das PDF sie weglässt. */
export async function briefkopfSetzen(neu: Briefkopf): Promise<string | null> {
  if (!supabase) return 'Keine Datenverbindung.';
  if (!firma) return 'Die Firma ist noch nicht geladen. Seite neu laden und nochmals versuchen.';
  const zeile: Record<string, string | null> = {};
  for (const [feld, spalte] of Object.entries(BRIEFKOPF_SPALTE)) {
    zeile[spalte] = neu[feld as keyof Briefkopf].trim() || null;
  }
  const { error } = await supabase.from('firma').update(zeile).eq('id', firma.id);
  if (error) {
    return /does not exist/i.test(error.message)
      ? 'Migration 0021 ist noch nicht eingespielt — ohne sie gibt es die Felder nicht.'
      : error.message;
  }
  briefkopfStand = neu;
  return null;
}

function lesenLokal(): Einstellungen {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Einstellungen> | null;
    return x
      ? { ...STANDARD, ...x, normaltagMin: gueltigerNormaltag(x.normaltagMin) ?? NORMALTAG_MIN, markierenAbMin: gueltigeMarkierung(x.markierenAbMin) }
      : STANDARD;
  } catch {
    return STANDARD;
  }
}

/** Was die App gerade annimmt — sofort verfügbar, auch offline. */
export function einstellungen(): Einstellungen {
  return zwischenspeicher;
}

/** Normaler Arbeitstag dieser Firma in Minuten — Grundlage für Normal/Überstunden in Erfassung, Korrektur und Demo. */
export function normaltagMin(): number {
  return gueltigerNormaltag(zwischenspeicher.normaltagMin) ?? NORMALTAG_MIN;
}

/** Stand die Einstellung «Normaler Arbeitstag» in der Datenbank? `false` = Migration 0026 fehlt noch. */
export function normaltagAusDatenbank(): boolean | null {
  return normaltagGelesen;
}

/**
 * «Gelb markieren ab» dieser Firma in Minuten — null = wie der normale Arbeitstag (jede Überstunde wird gelb).
 * Nur für die Markierung in Übersicht, Wochen- und Tagesübersicht; Lohn und Export zählen ab `normaltagMin()`.
 */
export function markierenAbMin(): number | null {
  return gueltigeMarkierung(zwischenspeicher.markierenAbMin);
}

/** Stand «Gelb markieren ab» in der Datenbank? `false` = Migration 0028 fehlt noch. */
export function markierenAusDatenbank(): boolean | null {
  return markierenGelesen;
}

/**
 * Welche Personen sind gelb — nach der Schwelle dieser Firma. Kurzform von `markiertePersonen` (zeiten.ts):
 * alle Einträge einer Person am selben Tag zählen zusammen, `person` wählt der Aufrufer.
 */
export function gelbePersonen(eintraege: { person: string; normal_min: number; ueber_min: number }[]): Set<string> {
  return markiertePersonen(eintraege, markierenAbMin());
}

/**
 * Standen die Schalter beim letzten Laden wirklich in der Datenbank?
 * `false` heisst fast immer: Migration 0019 fehlt, oder der Zugang hängt an keiner Firma.
 */
export function schalterGelesen(): boolean | null {
  return gelesen;
}

/** Die angemeldete Firma, sobald sie gelesen wurde. */
export function eigeneFirma(): { id: string; name: string } | null {
  return firma;
}

/**
 * Nach der Anmeldung aus der Datenbank laden (und für den nächsten Start merken).
 *
 * Die Regel auf `firma` lässt genau eine Zeile durch: die eigene. Darum reicht «nimm die erste».
 * Kommt nichts zurück (Migration fehlt, offline, Zugang ohne Firma), bleibt der letzte bekannte
 * Stand gültig — sonst fiele eine Regie-Firma bei jeder Störung auf das Wochenblatt zurück.
 */
export async function einstellungenLaden(): Promise<Einstellungen> {
  if (!supabase) return zwischenspeicher;
  // Der Briefkopf kommt seit 0021 dazu. Fehlt die Migration, scheitert die Abfrage mit den
  // neuen Spalten — dann nochmals ohne sie, damit die App trotzdem startet.
  const mitBriefkopf = await supabase
    .from('firma')
    .select('id,name,modus_erfassung,modus_sekretariat,briefkopf_name,briefkopf_slogan,briefkopf_adresse,briefkopf_tel,briefkopf_fax,briefkopf_mail,briefkopf_web,briefkopf_bank,briefkopf_mwst')
    .limit(1);
  const ohneBriefkopf = mitBriefkopf.data && mitBriefkopf.data.length > 0
    ? null
    : await supabase.from('firma').select('id,name,modus_erfassung,modus_sekretariat').limit(1);
  const data = ((mitBriefkopf.data ?? ohneBriefkopf?.data ?? null) as unknown) as Record<string, string | boolean | null>[] | null;
  if (!data || data.length === 0) { gelesen = false; return zwischenspeicher; }
  gelesen = true;
  const r = data[0] as unknown as {
    id: string; name: string; modus_erfassung: string; modus_sekretariat: string;
  };
  firma = { id: r.id, name: r.name };
  const bk = data[0] as Record<string, string | null>;
  briefkopfStand = {
    name: bk.briefkopf_name ?? '', slogan: bk.briefkopf_slogan ?? '', adresse: bk.briefkopf_adresse ?? '',
    tel: bk.briefkopf_tel ?? '', fax: bk.briefkopf_fax ?? '', mail: bk.briefkopf_mail ?? '',
    web: bk.briefkopf_web ?? '', bank: bk.briefkopf_bank ?? '', mwst: bk.briefkopf_mwst ?? '',
  };
  // Normaler Arbeitstag (0026) als eigene Abfrage: fehlt die Spalte noch, bleiben die übrigen Schalter gültig
  const nt = await supabase.from('firma').select('normaltag_min').eq('id', r.id).limit(1);
  const ntWert = !nt.error && nt.data?.[0] ? gueltigerNormaltag((nt.data[0] as { normaltag_min: unknown }).normaltag_min) : null;
  normaltagGelesen = ntWert !== null;
  // «Gelb markieren ab» (0028) genauso für sich. null ist hier ein echter Wert («wie der Arbeitstag») —
  // darum zählt, ob die Abfrage geklappt hat, nicht ob ein Wert kam
  const ma = await supabase.from('firma').select('markieren_ab_min').eq('id', r.id).limit(1);
  const maZeile = !ma.error && ma.data?.[0] ? (ma.data[0] as { markieren_ab_min: unknown }) : null;
  markierenGelesen = maZeile !== null;
  const neu: Einstellungen = {
    erfassung: r.modus_erfassung === 'regie' ? 'regie' : 'wochenblatt',
    sekretariat: r.modus_sekretariat === 'voll' ? 'voll' : 'stunden',
    // Fehlt die Spalte noch, kann auch nichts anderes als der Standard gespeichert sein — sonst (kurz kein Netz) der letzte bekannte Wert
    normaltagMin: ntWert ?? zwischenspeicher.normaltagMin,
    markierenAbMin: maZeile ? gueltigeMarkierung(maZeile.markieren_ab_min) : zwischenspeicher.markierenAbMin,
  };
  zwischenspeicher = neu;
  try { localStorage.setItem(KEY, JSON.stringify(neu)); } catch { /* ohne Speicher läuft es auch */ }
  return neu;
}

/** Schalter umlegen (Verwaltung → Einstellungen). Schreibt in die eigene Firmenzeile. */
export async function einstellungSetzen<K extends keyof Einstellungen>(feld: K, wert: Einstellungen[K]): Promise<string | null> {
  if (!supabase) return 'Keine Datenverbindung.';
  if (!firma) return 'Die Firma ist noch nicht geladen. Seite neu laden und nochmals versuchen.';
  const { error } = await supabase.from('firma').update({ [SPALTE[feld]]: wert }).eq('id', firma.id);
  // Ohne Migration 0019 gibt es die Tabelle nicht, und ohne Eintrag in `benutzer` greift keine Regel.
  if (error) {
    if (feld === 'normaltagMin' && /normaltag_min|does not exist|column/i.test(error.message)) {
      return 'Die Datenbank kennt diese Einstellung noch nicht — Migration 0026 fehlt.';
    }
    if (feld === 'markierenAbMin' && /markieren_ab_min|does not exist|column/i.test(error.message) && !/check constraint/i.test(error.message)) {
      return 'Die Datenbank kennt «Gelb markieren ab» noch nicht — Migration 0028 fehlt.';
    }
    return /row-level security|permission denied|does not exist/i.test(error.message)
      ? 'Die Datenbank lässt das nicht zu. Entweder ist Migration 0019 noch nicht eingespielt, oder dieser Zugang hängt an keiner Firma.'
      : error.message;
  }
  zwischenspeicher = { ...zwischenspeicher, [feld]: wert };
  try { localStorage.setItem(KEY, JSON.stringify(zwischenspeicher)); } catch { /* egal */ }
  return null;
}
