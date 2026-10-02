/**
 * Einstellungen der Firma — ein Code, pro Firma anders (Entscheid 02.10.2026).
 *
 * Jede Firma arbeitet anders: die eine will nur das Wochenblatt (Normal + Überstunden),
 * die andere den vollen Regie-Ablauf mit Symbolen und Mehrkostenanzeige. Statt zwei Zweigen
 * gibt es Schalter, die in der Verwaltung gesetzt werden (Tabelle `konfiguration`, Migration 0017).
 *
 * Gelesen wird einmal beim Start (main.tsx) und danach aus dem Zwischenspeicher — die Erfassung
 * läuft offline und darf nicht auf eine Abfrage warten.
 */
import { supabase } from './supabase';

export interface Einstellungen {
  /** 'wochenblatt' = nur Normal + Überstunden · 'regie' = zusätzlich Symbole, «Wer wollte das?», Stunden je Person */
  erfassung: 'wochenblatt' | 'regie';
  /** Knopf «Bauleitung informieren» am Zusatzauftrag (Bausitzungsprotokoll 7.1) */
  mehrkostenanzeige: boolean;
  /** 'stunden' = nur Stunden, Export, Board, Verwaltung · 'voll' = zusätzlich Regie, Zusatzauftrag, Übersichten */
  sekretariat: 'stunden' | 'voll';
  /** 'ansicht' = direkt die Rollenwahl (bis 02.10.) · 'login' = davor meldet sich die Firma an */
  anmeldung: 'ansicht' | 'login';
}

export const STANDARD: Einstellungen = { erfassung: 'wochenblatt', mehrkostenanzeige: false, sekretariat: 'stunden', anmeldung: 'ansicht' };

const KEY = 'firma-einstellungen';
const SCHLUESSEL = {
  erfassung: 'MODUS_ERFASSUNG',
  mehrkostenanzeige: 'MODUS_MEHRKOSTENANZEIGE',
  sekretariat: 'MODUS_SEKRETARIAT',
  anmeldung: 'MODUS_ANMELDUNG',
} as const;

let zwischenspeicher: Einstellungen = lesenLokal();
/** Hat die Datenbank beim letzten Versuch die Schalter geliefert? null = noch nicht versucht oder offline. */
let gelesen: boolean | null = null;

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
 * `false` heisst fast immer: Migration 0017 ist im Supabase-Projekt noch nicht eingespielt.
 * Dann gilt überall der Standard — das darf die Verwaltung nicht verschweigen.
 */
export function schalterGelesen(): boolean | null {
  return gelesen;
}

/** Beim Start aus der Datenbank nachladen (und für den nächsten Start merken). */
export async function einstellungenLaden(): Promise<Einstellungen> {
  if (!supabase) return zwischenspeicher;
  const { data } = await supabase.from('konfiguration').select('schluessel,wert').in('schluessel', Object.values(SCHLUESSEL));
  // Nichts gelesen (Migration 0017 fehlt, RLS, offline)? Dann bleibt der letzte bekannte Stand —
  // sonst fiele die Firma bei jeder Störung auf die Standardwerte zurück.
  if (!data || data.length === 0) { gelesen = false; return zwischenspeicher; }
  gelesen = true;
  const m = new Map((data as { schluessel: string; wert: string }[]).map((r) => [r.schluessel, r.wert]));
  const neu: Einstellungen = {
    erfassung: m.get(SCHLUESSEL.erfassung) === 'regie' ? 'regie' : 'wochenblatt',
    mehrkostenanzeige: m.get(SCHLUESSEL.mehrkostenanzeige) === 'an',
    sekretariat: m.get(SCHLUESSEL.sekretariat) === 'voll' ? 'voll' : 'stunden',
    // Fehlt die Zeile, bleibt es beim bisherigen Weg — eine halb eingerichtete Anmeldung darf
    // niemanden aussperren. Steht sie auf «login», ist die Anmeldung Pflicht.
    anmeldung: m.get(SCHLUESSEL.anmeldung) === 'login' ? 'login' : 'ansicht',
  };
  zwischenspeicher = neu;
  try { localStorage.setItem(KEY, JSON.stringify(neu)); } catch { /* ohne Speicher läuft es auch */ }
  return neu;
}

/** Schalter umlegen (Verwaltung → Einstellungen). Schreibt in `konfiguration` und aktualisiert den Zwischenspeicher. */
export async function einstellungSetzen<K extends keyof Einstellungen>(feld: K, wert: Einstellungen[K]): Promise<string | null> {
  if (!supabase) return 'Keine Datenverbindung.';
  const text = feld === 'mehrkostenanzeige' ? (wert ? 'an' : 'aus') : String(wert);
  const { error } = await supabase.from('konfiguration').upsert({ schluessel: SCHLUESSEL[feld], wert: text }, { onConflict: 'schluessel' });
  // Ohne Migration 0017 hat die Tabelle gar keine Policy: Schreiben wird abgewiesen, Lesen gibt leer zurück.
  // Den Postgres-Satz übersetzen, sonst sucht man den Fehler in der App statt in der Datenbank.
  if (error) return /row-level security|permission denied/i.test(error.message)
    ? 'Die Datenbank lässt das nicht zu: Migration 0017 ist noch nicht eingespielt. Sie steht im Repo unter supabase/migrations/0017_firma_einstellungen.sql und muss einmal im SQL-Editor laufen.'
    : error.message;
  zwischenspeicher = { ...zwischenspeicher, [feld]: wert };
  try { localStorage.setItem(KEY, JSON.stringify(zwischenspeicher)); } catch { /* egal */ }
  return null;
}
