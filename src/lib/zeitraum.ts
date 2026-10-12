/**
 * Woche oder Monat im Export (13.10.2026): woran hängt der gewählte Zeitraum?
 *
 * Vorher war es immer ein Montag, und der Monat war der Monat dieses Montags. Das ging schief: «Monat ›» im Oktober 2026
 * sprang auf montag(1.11.) = 26.10. — wieder Oktober, man kam nie in den November. «‹» übersprang Monate, und der Link
 * der Sekretariats-Startseite (`woche=montag(1.11.)`) öffnete den Vormonat.
 *
 * Jetzt: in der Woche ist der Anker der Montag, im Monat der 1. des Monats (12:00, wie überall in datum.ts).
 * Beim Umschalten gilt die ISO-Regel «die Woche gehört dem Monat, in dem ihr Donnerstag liegt» — in beide Richtungen,
 * damit Monat → Woche → Monat wieder beim selben Monat landet.
 */
import { addTage, ausIso, montag } from './datum';

export type ZeitraumArt = 'woche' | 'monat';

/** Der 1. des Monats von `d`, 12:00. */
export function monatsErster(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
}

/** Monat vor oder zurück — immer vom 1. aus, so geht kein Monat verloren. */
export function monatBlaettern(erster: Date, richtung: -1 | 1): Date {
  return new Date(erster.getFullYear(), erster.getMonth() + richtung, 1, 12);
}

/** Der Monat, dem eine Woche gehört: der Monat ihres Donnerstags. */
export function monatDerWoche(d: Date): Date {
  return monatsErster(addTage(montag(d), 3));
}

/** Die erste Woche eines Monats: die erste, deren Donnerstag im Monat liegt. */
export function ersteWocheImMonat(erster: Date): Date {
  const mo = montag(monatsErster(erster));
  return addTage(mo, 3).getMonth() === erster.getMonth() ? mo : addTage(mo, 7);
}

/** Anker beim Umschalten: zur Woche → Montag, zum Monat → der 1. */
export function ankerFuer(anker: Date, nach: ZeitraumArt): Date {
  if (nach === 'woche') return anker.getDate() === 1 ? ersteWocheImMonat(anker) : montag(anker);
  return anker.getDate() === 1 ? monatsErster(anker) : monatDerWoche(anker);
}

/**
 * Anker aus `?woche=JJJJ-MM-TT`. Ohne gültiges Datum: die aktuelle Woche, am Montag und Dienstag die Vorwoche (dann
 * wird sie noch abgeschlossen, 09.10.2026) — im Monat deren Monat.
 *
 * Im Monat ist der 1. gemeint. Alte Links tragen noch einen Montag (`montag(1.11.)` = 26.10.): enthält dessen Woche
 * Mo–So einen 1., ist der Monat dieses 1. gemeint, sonst der Monat des Datums.
 */
export function ankerAusUrl(wert: string | null, zeitraum: ZeitraumArt, heute: Date): Date {
  const d = wert && /^\d{4}-\d{2}-\d{2}$/.test(wert) ? ausIso(wert) : null;
  if (!d || Number.isNaN(d.getTime())) {
    const vorwoche = heute.getDay() === 1 || heute.getDay() === 2;
    const mo = montag(vorwoche ? addTage(heute, -7) : heute);
    return zeitraum === 'monat' ? monatDerWoche(mo) : mo;
  }
  if (zeitraum === 'woche') return montag(d);
  if (d.getDate() === 1) return monatsErster(d);
  const mo = montag(d);
  for (let i = 0; i < 7; i++) {
    const t = addTage(mo, i);
    if (t.getDate() === 1) return monatsErster(t);
  }
  return monatsErster(d);
}

/**
 * Überstunden «seit 1. Januar»: das Jahr, in dem der Zeitraum beginnt — höchstens bis zum 31.12. dieses Jahres.
 * KW 53 (28.12.2026–3.1.2027) gehört zu 2026; vorher wurde aus dem Ende «seit 1.1.2027» und das Jahr war fast leer.
 */
export function jahresBereich(vonIso: string, bisIso: string): { jahr: string; von: string; bis: string } {
  const jahr = vonIso.slice(0, 4);
  const ende = `${jahr}-12-31`;
  return { jahr, von: `${jahr}-01-01`, bis: bisIso < ende ? bisIso : ende };
}
