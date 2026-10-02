/**
 * Ansicht statt Login (Entscheid 09.09.): Beim Start wählt man, als wer man die App sieht.
 * Die Wahl liegt im Gerät (localStorage). Die Datenverbindung läuft über eine unsichtbare
 * anonyme Sitzung (main.tsx), damit die Datenbankrechte weiter greifen.
 *
 * Rechte werden damit in der Oberfläche gesteuert, nicht auf dem Server. Für den Pilot mit
 * echten Leuten ist das bewusst so — für echte Kundendaten muss ein Login zurück.
 *
 * Die Ansicht «Kunde» (Kundenlink für Regierapporte) gibt es nur, wenn die Firma mit Regie arbeitet
 * (Firmen-Schalter `MODUS_ERFASSUNG`, Verwaltung → Einstellungen, 02.10.2026).
 */
import { useSyncExternalStore } from 'react';
import { einstellungen } from './einstellungen';

export type Ansicht = 'bauf' | 'chef' | 'monteur' | 'sekretariat' | 'kunde';

export const ANSICHT_KEY = 'ansicht';
const EREIGNIS = 'ansicht-geaendert';

export type Gruppe = 'buero' | 'baustelle' | 'extern';
const GRUPPEN_ALLE: { key: Gruppe; titel: string; text: string }[] = [
  { key: 'buero', titel: 'Im Büro', text: 'am PC oder iPad' },
  { key: 'baustelle', titel: 'Auf der Baustelle', text: 'am Handy' },
  { key: 'extern', titel: 'Extern', text: 'per Link' },
];
/**
  * «Extern» gibt es nur, wenn die Firma mit Regie arbeitet — sonst gibt es keinen Kundenlink.
  *
  * Absichtlich eine Funktion, keine Konstante: die Schalter werden beim Start aus der Datenbank
  * nachgeladen (`einstellungenLaden()` in main.tsx). Eine Konstante stünde schon fest, bevor das
  * passiert ist, und wäre beim ersten Besuch auf einem neuen Gerät falsch.
  */
export function gruppen() {
  return GRUPPEN_ALLE.filter((g) => g.key !== 'extern' || einstellungen().erfassung === 'regie');
}

const ANSICHTEN_ALLE: { key: Ansicht; titel: string; text: string; gruppe: Gruppe }[] = [
  { key: 'bauf', titel: 'Bauführer', text: 'Prüfen, freigeben, in SORBA übertragen', gruppe: 'buero' },
  { key: 'sekretariat', titel: 'Sekretariat', text: 'Stunden, Lohn-Export, Temporärbüros, Mitarbeitende', gruppe: 'buero' },
  { key: 'chef', titel: 'Chefmonteur', text: 'Tagesmeldung fürs Team, ein Knopf am Abend', gruppe: 'baustelle' },
  { key: 'monteur', titel: 'Monteur', text: 'Meine Stunden, wie auf dem Wochenblatt', gruppe: 'baustelle' },
  { key: 'kunde', titel: 'Kunde', text: 'Bauleitung bestätigt den Regierapport per Link', gruppe: 'extern' },
];

/** Die Ansicht «Kunde» gibt es nur im Regie-Modus (Firmen-Schalter MODUS_ERFASSUNG). Siehe `gruppen()`. */
export function ansichten() {
  return ANSICHTEN_ALLE.filter((a) => a.key !== 'kunde' || einstellungen().erfassung === 'regie');
}

/** Beschriftung für alle Ansichten — hängt nicht an den Schaltern, darum eine Tabelle. */
export const ANSICHT_LABEL: Record<Ansicht, string> = Object.fromEntries(ANSICHTEN_ALLE.map((a) => [a.key, a.titel])) as Record<Ansicht, string>;

/** Welche Seiten jede Ansicht ohne Regie hat. «/» gibt es immer. */
const SEITEN_BASIS: Record<Ansicht, string[]> = {
  bauf: ['erfassung', 'heute', 'cockpit', 'export', 'verwaltung'],
  // Sekretariat (Entscheid 17.09.): nur Stunden, Export, Stammdaten
  sekretariat: ['export', 'verwaltung'],
  chef: ['erfassung'],
  monteur: [],
  kunde: [],
};

/**
 * Seiten je Ansicht — abhängig von den Firmen-Schaltern (Verwaltung → Einstellungen, 02.10.2026):
 * MODUS_ERFASSUNG = regie   → Zusatzauftrag, Regierapporte, Auswertung, Board kommen dazu.
 * MODUS_SEKRETARIAT = voll  → das Sekretariat sieht dasselbe wie der Bauführer (ohne Teamgerät).
 */
export function seitenFuer(a: Ansicht): string[] {
  const e = einstellungen();
  const regie = e.erfassung === 'regie';
  if (a === 'bauf') return regie ? ['zusatzauftrag', 'erfassung', 'heute', 'cockpit', 'regie', 'auswertung', 'export', 'board', 'verwaltung'] : SEITEN_BASIS.bauf;
  if (a === 'sekretariat') {
    if (e.sekretariat !== 'voll') return SEITEN_BASIS.sekretariat;
    return regie ? ['zusatzauftrag', 'heute', 'cockpit', 'regie', 'auswertung', 'export', 'board', 'verwaltung'] : ['heute', 'cockpit', 'export', 'verwaltung'];
  }
  return SEITEN_BASIS[a];
}

/** @deprecated — `seitenFuer(a)` nehmen, damit die Firmen-Schalter gelten. */
export const SEITEN = SEITEN_BASIS;

export function ansichtLesen(): Ansicht | null {
  try {
    const a = localStorage.getItem(ANSICHT_KEY);
    return ansichten().some((x) => x.key === a) ? (a as Ansicht) : null;
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
