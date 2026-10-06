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

export interface Einstellungen {
  /** 'wochenblatt' = nur Normal + Überstunden · 'regie' = zusätzlich Symbole, «Wer wollte das?», Stunden je Person */
  erfassung: 'wochenblatt' | 'regie';
  /** 'stunden' = nur Stunden, Export, Verwaltung · 'voll' = alles wie der Bauführer */
  sekretariat: 'stunden' | 'voll';
}

export const STANDARD: Einstellungen = { erfassung: 'wochenblatt', sekretariat: 'stunden' };

const KEY = 'firma-einstellungen';
/** Spalte in `firma` je Schalter. */
const SPALTE = {
  erfassung: 'modus_erfassung',
  sekretariat: 'modus_sekretariat',
} as const;

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
    return x ? { ...STANDARD, ...x } : STANDARD;
  } catch {
    return STANDARD;
  }
}

/** Was die App gerade annimmt — sofort verfügbar, auch offline. */
export function einstellungen(): Einstellungen {
  return zwischenspeicher;
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
  const neu: Einstellungen = {
    erfassung: r.modus_erfassung === 'regie' ? 'regie' : 'wochenblatt',
    sekretariat: r.modus_sekretariat === 'voll' ? 'voll' : 'stunden',
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
    return /row-level security|permission denied|does not exist/i.test(error.message)
      ? 'Die Datenbank lässt das nicht zu. Entweder ist Migration 0019 noch nicht eingespielt, oder dieser Zugang hängt an keiner Firma.'
      : error.message;
  }
  zwischenspeicher = { ...zwischenspeicher, [feld]: wert };
  try { localStorage.setItem(KEY, JSON.stringify(zwischenspeicher)); } catch { /* egal */ }
  return null;
}
