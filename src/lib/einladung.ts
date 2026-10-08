/**
 * Zugang für Monteur und Chefmonteur per Einladungslink (Erin, 09.10.2026).
 *
 * Der Bauführer schickt dem Monteur einen Link per WhatsApp. Der Monteur tippt ihn **einmal**
 * an, danach bleibt das Gerät gekoppelt und er meldet sich nie wieder an. Das muss so sein:
 *   · Regel #4 — offline zuerst. Am Abend auf dem Gerüst gibt es kein Netz für eine Anmeldung.
 *   · Regel #2 — keine Freitext-Eingabe. Kein Tippen von Mailadresse oder Passwort.
 *   · Die meisten Monteure sind nie im Büro, ein QR-Code am Empfang nützt ihnen nichts.
 *
 * Hier stehen nur die reinen Funktionen (Link bauen, Nummer aufbereiten, Gültigkeit lesen) —
 * die sind getestet. Das Einlösen selbst macht `koppeln()` weiter unten über die Edge Function
 * `einladung`, weil das Gerät zu diesem Zeitpunkt noch keine Sitzung hat.
 *
 * Siehe Migration 0028 und `supabase/functions/einladung/index.ts`.
 */
import { supabase, supabaseUrl } from './supabase';

export type Koppelansicht = 'monteur' | 'chef';

/** Wie lange ein frischer Link gilt. Kurz, weil er ein Schlüssel ist — aber lang genug für einen Feierabend. */
export const GUELTIG_STUNDEN = 24;

/** Die Adresse, die der Monteur antippt. */
export function einladungsLink(basis: string, token: string): string {
  return `${basis.replace(/\/+$/, '')}/e/${token}`;
}

/**
 * Schweizer Nummer für `wa.me`: nur Ziffern, führende 0 wird zu 41.
 * Leere oder unbrauchbare Nummern geben null — dann zeigt die Oberfläche nur «Link kopieren».
 */
export function waNummer(telefon: string | null | undefined): string | null {
  if (!telefon) return null;
  let n = telefon.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '41' + n.slice(1);
  return /^\d{10,15}$/.test(n) ? n : null;
}

/** Fertiger WhatsApp-Link. Ohne brauchbare Nummer null. */
export function waLink(telefon: string | null | undefined, text: string): string | null {
  const n = waNummer(telefon);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** Der Satz, der im WhatsApp steht. Kurz, ohne Fachsprache — der Monteur soll nur tippen. */
export function einladungsText(name: string, link: string): string {
  const vorname = name.trim().split(/\s+/)[0] || name;
  return `Hallo ${vorname}, hier ist dein Zugang zu Rapporto. Einmal antippen, dann bleibt er auf deinem Handy:\n${link}\nDer Link gilt ${GUELTIG_STUNDEN} Stunden.`;
}

export type Stand = 'offen' | 'verfallen' | 'eingeloest';

/** Stand einer Einladung — für die Liste in der Verwaltung. */
export function stand(e: { gueltig_bis: string; eingeloest_am: string | null }, jetzt = new Date()): Stand {
  if (e.eingeloest_am) return 'eingeloest';
  return new Date(e.gueltig_bis) < jetzt ? 'verfallen' : 'offen';
}

/** «noch 7 Stunden», «noch 20 Minuten», «abgelaufen» — für den Bauführer, nicht für den Monteur. */
export function restText(gueltigBis: string, jetzt = new Date()): string {
  const min = Math.floor((new Date(gueltigBis).getTime() - jetzt.getTime()) / 60000);
  if (min <= 0) return 'abgelaufen';
  if (min < 60) return `noch ${min} Minuten`;
  const h = Math.round(min / 60);
  return `noch ${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
}

/**
 * Was der Monteur in der Hand hält — grob, nur damit der Bauführer die Geräte auseinanderhält.
 * Bewusst keine Gerätenummer, kein Fingerabdruck: Regel gegen Standortverfolgung gilt sinngemäss.
 */
export function geraeteName(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android-Handy';
  if (/Windows/i.test(ua)) return 'Windows-PC';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Gerät';
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Einlösen — braucht Netz, aber nur dieses eine Mal
// ────────────────────────────────────────────────────────────────────────────────────────────

const funktionsUrl = (p: string) => `${supabaseUrl}/functions/v1/einladung${p}`;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface Eingeladener {
  name: string;
  ansicht: Koppelansicht;
}

/** Wer ist eingeladen? Verändert nichts — die Seite zeigt erst «Bist du das?». */
export async function einladungPruefen(token: string): Promise<Eingeladener | { fehler: string }> {
  if (!supabaseUrl || !anonKey) return { fehler: 'Keine Datenverbindung.' };
  try {
    const r = await fetch(funktionsUrl(`?token=${encodeURIComponent(token)}`), {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const j = (await r.json()) as { name?: string; ansicht?: Koppelansicht; fehler?: string };
    if (!r.ok) return { fehler: j.fehler ?? 'Dieser Link gilt nicht mehr.' };
    return { name: j.name ?? '', ansicht: j.ansicht ?? 'monteur' };
  } catch {
    return { fehler: 'Keine Verbindung. Bitte nochmals probieren, wenn du Empfang hast.' };
  }
}

export interface Gekoppelt {
  mitarbeiterId: string;
  name: string;
  ansicht: Koppelansicht;
}

/**
 * Link einlösen: Sitzung holen und ins Gerät legen. Danach ist das Gerät angemeldet —
 * dauerhaft, weil Supabase den Refresh-Token im Gerät behält.
 */
export async function koppeln(token: string): Promise<Gekoppelt | { fehler: string }> {
  if (!supabase || !supabaseUrl || !anonKey) return { fehler: 'Keine Datenverbindung.' };
  try {
    const r = await fetch(funktionsUrl(''), {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, bezeichnung: geraeteName() }),
    });
    const j = (await r.json()) as {
      access_token?: string;
      refresh_token?: string;
      mitarbeiter_id?: string;
      name?: string;
      ansicht?: Koppelansicht;
      fehler?: string;
    };
    if (!r.ok || !j.access_token || !j.refresh_token) return { fehler: j.fehler ?? 'Das hat nicht geklappt.' };

    const { error } = await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
    if (error) return { fehler: 'Die Anmeldung liess sich nicht speichern.' };

    return { mitarbeiterId: j.mitarbeiter_id ?? '', name: j.name ?? '', ansicht: j.ansicht ?? 'monteur' };
  } catch {
    return { fehler: 'Keine Verbindung. Bitte nochmals probieren, wenn du Empfang hast.' };
  }
}
