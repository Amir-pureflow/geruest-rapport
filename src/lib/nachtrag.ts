/**
 * Wie weit zurück darf ein Team einen Tag nachtragen? (13.10.2026)
 *
 * Eine Regel für alle Stellen: die Erfassung (Pfeil ‹, «Anderen Tag nachtragen», Sprung mit `?tag=`) und die Startseite
 * des Chefmonteurs («nachtragen ›»). Vorher bot die Startseite jeden vergangenen Tag an, die Erfassung nahm aber nur
 * sieben Tage zurück — ein älterer Tag öffnete still «heute», und der Chefmonteur meldete auf den falschen Tag.
 *
 * Verglichen wird als Text «JJJJ-MM-TT» — nie mit Uhrzeit, sonst hängt das Ergebnis davon ab, wann man nachschaut.
 */
import { addTage, iso } from './datum';

/** So viele Tage zurück geht es — ältere Tage korrigiert der Bauführer in der Wochenübersicht. */
export const NACHTRAG_TAGE = 7;

/** Der früheste Tag, der sich noch nachtragen lässt. */
export function fruehesterNachtrag(heute: Date): string {
  return iso(addTage(heute, -NACHTRAG_TAGE));
}

/** Lässt sich dieser Tag melden? Heute und bis `NACHTRAG_TAGE` zurück, nie in der Zukunft. */
export function nachtragMoeglich(tagIso: string, heute: Date): boolean {
  return tagIso >= fruehesterNachtrag(heute) && tagIso <= iso(heute);
}

/**
 * `?tag=` aus der Adresse lesen. `tag` = gültiger Tag oder null (dann heute); `hinweis` = warum ein Tag NICHT
 * genommen wurde — der Bildschirm sagt es, statt still auf heute zu springen.
 */
export function tagAusAdresse(roh: string | null, heute: Date): { tag: string | null; hinweis: string | null } {
  if (!roh) return { tag: null, hinweis: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(roh) || Number.isNaN(new Date(roh + 'T12:00:00').getTime())) {
    return { tag: null, hinweis: 'Der Tag in der Adresse ist ungültig — gezeigt wird heute.' };
  }
  if (roh > iso(heute)) return { tag: null, hinweis: 'Für einen Tag in der Zukunft lässt sich nichts melden — gezeigt wird heute.' };
  if (roh < fruehesterNachtrag(heute)) {
    return { tag: null, hinweis: `Der ${roh.slice(8, 10)}.${roh.slice(5, 7)}. liegt mehr als ${NACHTRAG_TAGE} Tage zurück und lässt sich hier nicht mehr nachtragen. Bitte den Bauführer fragen — er trägt es in der Wochenübersicht ein. Gezeigt wird heute.` };
  }
  return { tag: roh, hinweis: null };
}
