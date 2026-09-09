/**
 * Ansicht statt Login (Entscheid 09.09.): Beim Start wählt man, als wer man die App sieht.
 * Die Wahl liegt im Gerät (localStorage). Die Datenverbindung läuft über eine unsichtbare
 * anonyme Sitzung (main.tsx), damit die Datenbankrechte weiter greifen.
 *
 * Rechte werden damit in der Oberfläche gesteuert, nicht auf dem Server. Für den Pilot mit
 * echten Leuten ist das bewusst so — für echte Kundendaten muss ein Login zurück.
 */
import { useSyncExternalStore } from 'react';

export type Ansicht = 'bauf' | 'chef' | 'monteur' | 'sekretariat' | 'kunde';

export const ANSICHT_KEY = 'ansicht';
const EREIGNIS = 'ansicht-geaendert';

export type Gruppe = 'buero' | 'baustelle' | 'extern';
export const GRUPPEN: { key: Gruppe; titel: string; text: string }[] = [
  { key: 'buero', titel: 'Im Büro', text: 'am PC' },
  { key: 'baustelle', titel: 'Auf der Baustelle', text: 'am Handy' },
  { key: 'extern', titel: 'Extern', text: 'per Link' },
];

export const ANSICHTEN: { key: Ansicht; titel: string; text: string; gruppe: Gruppe }[] = [
  { key: 'bauf', titel: 'Bauführer', text: 'Prüfen, freigeben, Regie verschicken', gruppe: 'buero' },
  { key: 'sekretariat', titel: 'Sekretariat', text: 'Anrufe festhalten, Regierapporte, Export', gruppe: 'buero' },
  { key: 'chef', titel: 'Chefmonteur', text: 'Tagesmeldung fürs Team, ein Knopf am Abend', gruppe: 'baustelle' },
  { key: 'monteur', titel: 'Monteur', text: 'Meine Stunden, wie auf dem Wochenblatt', gruppe: 'baustelle' },
  { key: 'kunde', titel: 'Kunde', text: 'Bauleitung bestätigt den Regierapport per Link', gruppe: 'extern' },
];

export const ANSICHT_LABEL: Record<Ansicht, string> = Object.fromEntries(ANSICHTEN.map((a) => [a.key, a.titel])) as Record<Ansicht, string>;

/** Welche Seiten jede Ansicht überhaupt hat. «/» und «/b/:token» gibt es immer. */
export const SEITEN: Record<Ansicht, string[]> = {
  bauf: ['zusatzauftrag', 'erfassung', 'heute', 'cockpit', 'regie', 'export', 'board', 'verwaltung'],
  sekretariat: ['zusatzauftrag', 'heute', 'cockpit', 'regie', 'export', 'board', 'verwaltung'],
  chef: ['erfassung'],
  monteur: [],
  kunde: [],
};

export function ansichtLesen(): Ansicht | null {
  try {
    const a = localStorage.getItem(ANSICHT_KEY);
    return ANSICHTEN.some((x) => x.key === a) ? (a as Ansicht) : null;
  } catch {
    return null;
  }
}

export function ansichtSetzen(a: Ansicht | null) {
  try {
    if (a) localStorage.setItem(ANSICHT_KEY, a);
    else localStorage.removeItem(ANSICHT_KEY);
  } catch {
    /* privater Modus o. ä. — dann gilt die Wahl nur bis zum Neuladen */
  }
  window.dispatchEvent(new Event(EREIGNIS));
}

function abonnieren(cb: () => void) {
  window.addEventListener(EREIGNIS, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EREIGNIS, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Aktuelle Ansicht, reagiert auf Wechsel. */
export function useAnsicht(): Ansicht | null {
  return useSyncExternalStore(abonnieren, ansichtLesen, () => null);
}
