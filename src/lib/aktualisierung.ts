/**
 * Neue App-Fassung erst einspielen, wenn dabei nichts verloren geht (13.10.2026, vor dem Start bei der Gerüst GmbH).
 *
 * Bis jetzt übernahm die App eine neue Fassung sofort (`autoUpdate` + `skipWaiting`) und lud die Seite neu — auch
 * mitten im Ausfüllen der Tagesmeldung, sobald das Handy kurz in die Tasche ging und wieder hervorkam. Zeiten,
 * Häkchen, Sprachnotiz: weg.
 *
 * Jetzt wartet eine neue Fassung, bis ein ruhiger Moment kommt:
 *   - die App geht in den Hintergrund, und es ist keine Eingabe offen, oder
 *   - man wechselt die Seite (die alte Seite ist dann ohnehin weg), ausser man steht im Teamgerät mitten in einer Meldung.
 * Damit niemand tagelang auf einer alten Fassung bleibt: Liegt eine angefangene Eingabe seit Stunden unberührt und
 * wartet die neue Fassung schon einen halben Tag, gilt sie als liegen gelassen — dann kommt die neue Fassung beim
 * nächsten Wechsel in den Hintergrund trotzdem. Und beim nächsten Kaltstart der App ist sie sowieso da.
 */

/** So lange wartet eine neue Fassung höchstens auf eine fertige Eingabe … */
export const SPAETESTENS_MS = 12 * 3600 * 1000;
/** … und so lange muss die Eingabe unberührt sein, damit sie als liegen gelassen gilt. */
export const RUHE_MS = 2 * 3600 * 1000;

export type Anlass = 'hintergrund' | 'navigation';

/** Reine Entscheidung — mit Tests. */
export function jetztEinspielen(s: { anlass: Anlass; eingabe: boolean; wartetSeit: number; jetzt: number; letzteEingabe: number | null }): boolean {
  if (!s.eingabe) return true;
  if (s.anlass !== 'hintergrund') return false;
  const langeGewartet = s.jetzt - s.wartetSeit >= SPAETESTENS_MS;
  const liegenGelassen = s.letzteEingabe === null || s.jetzt - s.letzteEingabe >= RUHE_MS;
  return langeGewartet && liegenGelassen;
}

// ── Offene Eingaben ─────────────────────────────────────────────────────────────────────────────
// Das Teamgerät meldet selbst, ob eine Meldung angefangen und nicht gespeichert ist (`erfassungOffen`). Für alle anderen
// Seiten genügt: wurde seit dem letzten Seitenwechsel in ein Feld getippt (`formularBeruehrt`)?

let erfassung = false;
let formular = false;
let zuletzt: number | null = null;

export function erfassungOffen(offen: boolean): void {
  erfassung = offen;
  if (offen) zuletzt = Date.now();
}

export function formularBeruehrt(): void {
  formular = true;
  zuletzt = Date.now();
}

/** Beim Seitenwechsel: die Felder der alten Seite gibt es nicht mehr. */
export function formularVerlassen(): void {
  formular = false;
}

export function eingabeOffen(): boolean {
  return erfassung || formular;
}

export function letzteEingabe(): number | null {
  return zuletzt;
}
