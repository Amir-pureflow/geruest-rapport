/**
 * Benutzerkonten für Monteure und Chefmonteure (10.10.2026, Erin).
 *
 * Wer in der Verwaltung eine Person erfasst, gibt ihr gleich ein Konto: Adresse
 * `vorname.nachname@<Domain der Firma>` (Gerüst GmbH: `@geruest.ch`) und ein Passwort, das man vorlesen
 * kann. Die Domain steht in `firma.mail_domain`. Fehlt sie, nimmt die Datenbank `ERSATZ_DOMAIN`.
 *
 * Angelegt wird über die Datenbankfunktion `konto_anlegen` (Migration 0034).
 */

/** Wenn eine Firma noch keine eigene Domain hat. Gleich wie in 0034. */
export const ERSATZ_DOMAIN = 'rapporto.pureflow-ai.com';

/** «Ismail Vaiti» → «ismail.vaiti». Umlaute ausgeschrieben, Akzente weg, alles andere wird ein Punkt. */
export function benutzername(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** «Ismail Vaiti» + «geruest.ch» → «ismail.vaiti@geruest.ch». Ohne Domain die Ersatz-Domain. */
export function kontoAdresse(name: string, domain: string | null | undefined): string {
  return `${benutzername(name)}@${(domain ?? '').trim().toLowerCase() || ERSATZ_DOMAIN}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Rollen (10.10.2026, Erin: «Was ist, wenn eine Sekretärin kommt?»)
// ────────────────────────────────────────────────────────────────────────────────────────────

export type KontoRolle = 'monteur' | 'chef' | 'bauf' | 'sekretariat';

export const KONTO_ROLLEN: { key: KontoRolle; titel: string; text: string }[] = [
  { key: 'monteur', titel: 'Monteur', text: 'Sieht die eigenen Stunden, wie auf dem Wochenblatt.' },
  { key: 'chef', titel: 'Chefmonteur', text: 'Macht am Abend die Tagesmeldung fürs Team.' },
  { key: 'bauf', titel: 'Bauführer', text: 'Prüft und gibt Stunden frei, pflegt die Verwaltung.' },
  { key: 'sekretariat', titel: 'Sekretariat', text: 'Stunden je Person, Lohn- und Temporär-Export, Verwaltung.' },
];

/**
 * Funktion für Leute im Büro (Sekretariat, Buchhaltung). Kein SGUV-Tarif — diese Leute melden keine Stunden.
 * Wer sie hat, erscheint im Teamgerät nicht als Gast und lässt sich keinem Team zuteilen.
 */
export const FUNKTION_BUERO = 'buero';

/** Welche Rolle passt zur Funktion? Nur ein Vorschlag — der Bauführer kann umwählen. */
export function rolleVorschlag(funktion: string): KontoRolle {
  if (funktion === FUNKTION_BUERO) return 'sekretariat';
  if (funktion === 'bauf') return 'bauf';
  if (funktion === 'gruppe' || funktion === 'objekt') return 'chef';
  return 'monteur';
}

/**
 * Darf, wer mit Ansicht `ich` angemeldet ist, Konten dieser Rolle verwalten? Gleiche Regel wie
 * `konten_recht()` in 0034 — die Datenbank entscheidet, das hier graut nur die Knöpfe aus.
 * `ich` null = Firmen-Zugang (Inhaber): darf alles.
 * Bauführer: alles ausser Sekretariat — Lohn sieht nur das Sekretariat (Bauführer 20.09.).
 */
export function darfVergeben(ich: string | null, rolle: KontoRolle): boolean {
  if (ich === 'monteur' || ich === 'chef') return false;
  if (ich === 'bauf' && rolle === 'sekretariat') return false;
  return true;
}

/** Kurze, deutsche, eindeutige Wörter — kein Umlaut, nichts zum Verwechseln. */
const WOERTER = ['Rohr', 'Brett', 'Kran', 'Haken', 'Leiter', 'Stange', 'Anker', 'Bohle', 'Kupplung', 'Riegel'];

/**
 * Passwort, das der Bauführer am Telefon vorlesen kann: «Anker-4827». Mindestens 8 Zeichen
 * (so prüft es auch 0034). Kein Hochsicherheitspasswort — wer mehr will, tippt selbst eines.
 */
export function passwortVorschlag(zufall: () => number = Math.random): string {
  const wort = WOERTER[Math.floor(zufall() * WOERTER.length)];
  const zahl = 1000 + Math.floor(zufall() * 9000);
  return `${wort}-${zahl}`;
}
