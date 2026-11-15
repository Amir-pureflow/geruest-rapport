/**
 * Zwischenspeicher für Seiten (Amir 15.11.2026: «das Routing soll clean sein wie eine richtige Software, es stockt»).
 *
 * Wer eine Seite schon einmal offen hatte, sieht beim Zurückkommen sofort den letzten Stand — die Seite lädt still im
 * Hintergrund nach (wie Linear, Gmail …). Vorher startete jede Seite leer mit «lädt …» und sprang dann.
 *
 * Nur im Arbeitsspeicher: Neuladen oder Abmelden (lädt die Seite neu) leert ihn. Nichts landet auf dem Gerät.
 */
const speicher = new Map<string, unknown>();

export function gemerkt<T>(schluessel: string): T | undefined {
  return speicher.get(schluessel) as T | undefined;
}

export function merken<T>(schluessel: string, wert: T): void {
  speicher.set(schluessel, wert);
}

/** Nur für Tests */
export function merkerLeeren(): void {
  speicher.clear();
}
