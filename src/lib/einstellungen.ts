/**
 * Einstellungen der angemeldeten Firma — ein Code, pro Firma anders (Entscheid 02.10.2026).
 *
 * Jede Firma arbeitet anders: die eine will nur das Wochenblatt (Normal + Überstunden), die andere
 * den vollen Regie-Ablauf mit Symbolen und Mehrkostenanzeige. Statt zwei Zweigen gibt es Schalter.
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
  /** Knopf «Bauleitung informieren» am Zusatzauftrag (Bausitzungsprotokoll 7.1) */
  mehrkostenanzeige: boolean;
  /** 'stunden' = nur Stunden, Export, Verwaltung · 'voll' = alles wie der Bauführer */
  sekretariat: 'stunden' | 'voll';
}

export const STANDARD: Einstellungen = { erfassung: 'wochenblatt', mehrkostenanzeige: false, sekretariat: 'stunden' };

const KEY = 'firma-einstellungen';
/** Spalte in `firma` je Schalter. */
const SPALTE = {
  erfassung: 'modus_erfassung',
  mehrkostenanzeige: 'modus_mehrkostenanzeige',
  sekretariat: 'modus_sekretariat',
} as const;

let zwischenspeicher: Einstellungen = lesenLokal();
/** Hat die Datenbank beim letzten Versuch geliefert? null = noch nicht versucht oder offline. */
let gelesen: boolean | null = null;
/** Die eigene Firma — fürs Speichern der Schalter und für den Namen in der Kopfzeile. */
let firma: { id: string; name: string } | null = null;

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
  const { data } = await supabase
    .from('firma')
    .select('id,name,modus_erfassung,modus_sekretariat,modus_mehrkostenanzeige')
    .limit(1);
  if (!data || data.length === 0) { gelesen = false; return zwischenspeicher; }
  gelesen = true;
  const r = data[0] as unknown as {
    id: string; name: string; modus_erfassung: string; modus_sekretariat: string; modus_mehrkostenanzeige: boolean;
  };
  firma = { id: r.id, name: r.name };
  const neu: Einstellungen = {
    erfassung: r.modus_erfassung === 'regie' ? 'regie' : 'wochenblatt',
    mehrkostenanzeige: r.modus_mehrkostenanzeige === true,
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
