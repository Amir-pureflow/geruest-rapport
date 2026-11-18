/**
 * Albanische Oberfläche für die Baustelle (Erin 19.11.2026, Testfassung: «für den Chefmonteur und den Monteur auf der
 * Handyansicht … irgendwo anwählen, dass sie das auf Albanisch übersetzen können»).
 *
 * - Nur in den Ansichten Chefmonteur und Monteur. Büro-Ansichten bleiben deutsch, auch auf demselben Gerät.
 * - Die Wahl liegt im Gerät (localStorage), umgeschaltet über den Knopf oben (ui/SpracheKnopf.tsx). Kein Neuladen.
 * - Baustelle, Adresse, Treffpunkt und Hinweise des Büros bleiben deutsch (`data-bleibt-deutsch`), Namen sowieso.
 * - Was im Wörterbuch fehlt, bleibt deutsch — nie geraten (albanisch_woerter.ts).
 * - Gespeichert wird weiter alles auf Deutsch: die Übersetzung ändert nur, was am Bildschirm steht.
 */
import { useSyncExternalStore } from 'react';
import { ansichtLesen } from './ansicht';
import { MUSTER, WOERTER } from './albanisch_woerter';
import { uebersetzerBauen } from './uebersetzer';

const SCHLUESSEL = 'oberflaeche-sq';
const EREIGNIS = 'oberflaeche-sq-geaendert';

const uebersetzer = uebersetzerBauen({ woerter: WOERTER, muster: MUSTER }, 'sq');
export const albanischUebersetzen = uebersetzer.uebersetzen;

export function albanischGewaehlt(): boolean {
  try { return localStorage.getItem(SCHLUESSEL) === '1'; } catch { return false; }
}

/** Nur auf der Baustelle: Chefmonteur (auch Teamgerät) und Monteur. */
export function albanischMoeglich(): boolean {
  const a = ansichtLesen();
  return a === 'chef' || a === 'monteur';
}

/** Je nach Wahl und Ansicht ein- oder ausschalten. Nach dem Start und bei jedem Ansichtswechsel aufrufen. */
export function albanischAnwenden() {
  const soll = albanischGewaehlt() && albanischMoeglich();
  if (soll && !uebersetzer.aktiv()) uebersetzer.einschalten();
  else if (!soll && uebersetzer.aktiv()) uebersetzer.ausschalten();
}

export function albanischSetzen(an: boolean) {
  try { if (an) localStorage.setItem(SCHLUESSEL, '1'); else localStorage.removeItem(SCHLUESSEL); } catch { /* privat */ }
  window.dispatchEvent(new Event(EREIGNIS));
  albanischAnwenden();
}

function abonnieren(cb: () => void) {
  window.addEventListener(EREIGNIS, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EREIGNIS, cb); window.removeEventListener('storage', cb); };
}

export function useAlbanisch(): boolean {
  return useSyncExternalStore(abonnieren, albanischGewaehlt, () => false);
}

if (typeof window !== 'undefined') {
  // Ansicht gewechselt (z. B. Teamgerät → Bauführer): dort deutsch, zurück auf der Baustelle wieder albanisch
  window.addEventListener('ansicht-geaendert', () => setTimeout(albanischAnwenden, 0));
  window.addEventListener('storage', () => albanischAnwenden());
}
