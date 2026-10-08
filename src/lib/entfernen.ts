/**
 * Mitarbeitende und Teams aus der Verwaltung entfernen (Amir, 09.10.2026: «Ich möchte einen Mitarbeiter in der
 * Verwaltung löschen können … und Teams auch.»).
 *
 * Der Lohn darf dabei nie Stunden verlieren. Darum zwei Wege, und die Daten entscheiden, nicht der Knopf:
 * - **Löschen** — nur, was nie gearbeitet hat: eine Person ohne Zeiteintrag, ein Team ohne Meldung. Mit weg geht nur
 *   Einrichtung: Teamzugehörigkeiten, der Verweis als Chefmonteur, beim Team seine Einsätze in der Planung (die lassen
 *   sich in der Planung ohnehin einzeln entfernen).
 * - **Entfernen** (deaktivieren) — alles mit Stunden: `aktiv = false`, die Teamzugehörigkeit endet heute, der Platz als
 *   Chefmonteur wird frei, beim Team fällt die Planung ab morgen weg. Erfassung, Planung und die Listen fragen nur
 *   Aktive ab; Wochenübersicht, Export und Lohn lesen die Zeiteinträge und zeigen die Stunden weiter.
 *
 * Die Datenbank sichert das zusätzlich ab: `zeiteintrag` und `tagesmeldung` zeigen ohne «on delete cascade» auf Person
 * und Team — wer Stunden hat, lässt sich gar nicht löschen (Fehler 23503).
 *
 * Ein Team mit Stunden, die noch nicht freigegeben sind, wird erst nach der Freigabe entfernt: die Wochenübersicht
 * zeigt nur aktive Teams, die Stunden liessen sich danach nicht mehr freigeben und fehlten im Lohn-Export
 * («nur Freigegebenes»). Bei Personen gilt das nicht — die Wochenübersicht zeigt sie über ihr Team.
 *
 * Rechte: die Regeln aus 0019 gelten «for all» (lesen, ändern, löschen) innerhalb der eigenen Firma, es braucht keine
 * neue Migration. Lehnt eine Regel ab, meldet Postgres keinen Fehler — die Zeile fehlt nur im Ergebnis. Darum wird
 * beim entscheidenden Schritt gezählt.
 */
import { supabase } from './supabase';
import { iso } from './datum';

export type Entscheid = 'loeschen' | 'deaktivieren' | 'bleibt' | 'erst_freigeben';

/** Person: ohne Stunden löschen, mit Stunden aus den Listen nehmen. Schon inaktiv mit Stunden → bleibt, wie sie ist. */
export function personEntscheid(p: { aktiv: boolean; hatStunden: boolean }): Entscheid {
  if (!p.hatStunden) return 'loeschen';
  return p.aktiv ? 'deaktivieren' : 'bleibt';
}

/** Team: ohne Meldung löschen. Mit Meldungen erst, wenn alles freigegeben ist — dann aus den Listen nehmen. */
export function teamEntscheid(t: { aktiv: boolean; hatMeldungen: boolean; hatOffeneStunden: boolean }): Entscheid {
  if (!t.hatMeldungen) return 'loeschen';
  if (!t.aktiv) return 'bleibt';
  return t.hatOffeneStunden ? 'erst_freigeben' : 'deaktivieren';
}

export interface Plan { id: string; von: string; bis: string }

/** Planung ab morgen: was erst später beginnt, fällt weg; was heute läuft, endet heute. Vergangenes bleibt stehen. */
export function planungAbMorgen(plaene: Plan[], heute: string): { weg: string[]; kuerzen: Plan[] } {
  return {
    weg: plaene.filter((p) => p.von > heute).map((p) => p.id),
    kuerzen: plaene.filter((p) => p.von <= heute && p.bis > heute),
  };
}

/** «Team 3», «Team 3 und Team 5», «Team 1, Team 3 und Team 5» */
function aufzaehlen(namen: string[]): string {
  return namen.length <= 1 ? (namen[0] ?? '') : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

export interface Rueckfrage {
  entscheid: Entscheid;
  text: string;
  /** Beschriftung des roten Knopfs — null: es gibt nichts zu tun, nur «Abbrechen» */
  knopf: string | null;
}

/** Was die Rückfrage zur Person sagt. `chefVon` = aktive Teams, in denen sie Chefmonteur ist. */
export function personFrage(name: string, entscheid: Entscheid, chefVon: string[] = []): Rueckfrage {
  const chef = chefVon.length > 0 ? ` ${aufzaehlen(chefVon)} ${chefVon.length === 1 ? 'hat' : 'haben'} danach keinen Chefmonteur.` : '';
  switch (entscheid) {
    case 'loeschen':
      return { entscheid, text: `«${name}» löschen? Das lässt sich nicht rückgängig machen.${chef}`, knopf: 'Löschen' };
    case 'deaktivieren':
      return { entscheid, text: `«${name}» hat schon Stunden — wird aus allen Listen entfernt, die Stunden bleiben im Lohn-Export.${chef}`, knopf: 'Entfernen' };
    default:
      return { entscheid, text: `«${name}» hat Stunden im Lohn-Export und ist schon aus allen Listen entfernt — ganz löschen geht darum nicht.`, knopf: null };
  }
}

/** Was die Rückfrage zum Team sagt. `mitglieder` = Leute im Team heute, `plaene` = Einsätze, die wegfallen. */
export function teamFrage(name: string, entscheid: Entscheid, mitglieder: number, plaene: number): Rueckfrage {
  const leute = mitglieder > 0 ? ' Die Leute bleiben als Mitarbeitende.' : '';
  switch (entscheid) {
    case 'loeschen':
      return { entscheid, text: `«${name}» löschen? Das lässt sich nicht rückgängig machen.${leute}${plaene > 0 ? ' Die Einsätze in der Planung fallen mit weg.' : ''}`, knopf: 'Löschen' };
    case 'deaktivieren':
      return { entscheid, text: `«${name}» hat schon Meldungen — wird aus allen Listen entfernt, die Stunden bleiben im Lohn-Export.${leute}${plaene > 0 ? ' Die Planung ab morgen fällt weg.' : ''}`, knopf: 'Entfernen' };
    case 'erst_freigeben':
      return { entscheid, text: `«${name}» hat noch Stunden, die nicht freigegeben sind. Zuerst in der Wochenübersicht freigeben, dann entfernen.`, knopf: null };
    default:
      return { entscheid, text: `«${name}» ist schon inaktiv und hat Meldungen — ganz löschen geht darum nicht, sonst fehlen die Stunden im Lohn-Export.`, knopf: null };
  }
}

/** Die Datenbank hat abgelehnt — als Fehler (42501) oder still, indem keine Zeile betroffen war. */
export const ABGELEHNT = 'Die Datenbank lässt das nicht zu. Entweder ist Migration 0019 noch nicht eingespielt, oder dieser Zugang hängt an keiner Firma.';

/** Datenbankfehler in einen Satz für die Verwaltung übersetzen. */
export function fehlerText(e: { code?: string; message: string }): string {
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message)) return ABGELEHNT;
  if (/failed to fetch|networkerror|load failed/i.test(e.message)) return 'Keine Verbindung zur Datenbank — bitte später nochmals versuchen.';
  return 'Konnte nicht löschen: ' + e.message;
}

type Ergebnis = { fehler: string } | { ergebnis: 'geloescht' | 'deaktiviert' };

const KEINE_VERBINDUNG = 'Keine Datenverbindung.';

// ── Person ───────────────────────────────────────────────────────────────────────────────────────────────

/** Nachschauen, was mit der Person passiert: hat sie Stunden, ist sie Chefmonteur? */
export async function personPruefen(p: { id: string; name: string; aktiv: boolean }): Promise<Rueckfrage | { fehler: string }> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  const [z, c] = await Promise.all([
    supabase.from('zeiteintrag').select('id').eq('mitarbeiter_id', p.id).limit(1),
    supabase.from('team').select('bezeichnung').eq('chefmonteur_id', p.id).eq('aktiv', true),
  ]);
  const e = z.error ?? c.error;
  if (e) return { fehler: fehlerText(e) };
  const chefVon = ((c.data ?? []) as { bezeichnung: string }[]).map((t) => t.bezeichnung).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  return personFrage(p.name, personEntscheid({ aktiv: p.aktiv, hatStunden: (z.data ?? []).length > 0 }), chefVon);
}

/** Aus allen Listen nehmen: inaktiv, Teamzugehörigkeit endet heute, Platz als Chefmonteur frei. Die Stunden bleiben. */
async function personDeaktivieren(id: string): Promise<Ergebnis> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  const r1 = await supabase.from('mitarbeiter').update({ aktiv: false }, { count: 'exact' }).eq('id', id);
  if (r1.error) return { fehler: fehlerText(r1.error) };
  if (!r1.count) return { fehler: ABGELEHNT };
  const r2 = await supabase.from('team_mitglied').update({ bis: iso(new Date()) }).eq('mitarbeiter_id', id).is('bis', null);
  if (r2.error) return { fehler: fehlerText(r2.error) };
  const r3 = await supabase.from('team').update({ chefmonteur_id: null }).eq('chefmonteur_id', id);
  if (r3.error) return { fehler: fehlerText(r3.error) };
  return { ergebnis: 'deaktiviert' };
}

/**
 * Person löschen oder aus den Listen nehmen — nach dem Entscheid aus `personPruefen`.
 * Kamen seit der Prüfung Stunden dazu (Teamgerät hat eben gesendet), lehnt die Datenbank das Löschen ab (23503);
 * dann wird die Person stattdessen aus den Listen genommen — das Ergebnis sagt es.
 */
export async function personEntfernen(id: string, entscheid: Entscheid): Promise<Ergebnis> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  if (entscheid === 'deaktivieren') return personDeaktivieren(id);
  if (entscheid !== 'loeschen') return { fehler: 'Hier gibt es nichts zu löschen.' };
  // Erst die Einrichtung, die auf die Person zeigt — sonst hält der Fremdschlüssel das Löschen auf
  const r1 = await supabase.from('team').update({ chefmonteur_id: null }).eq('chefmonteur_id', id);
  if (r1.error) return { fehler: fehlerText(r1.error) };
  const r2 = await supabase.from('team_mitglied').delete().eq('mitarbeiter_id', id);
  if (r2.error) return { fehler: fehlerText(r2.error) };
  const r3 = await supabase.from('mitarbeiter').delete({ count: 'exact' }).eq('id', id);
  if (r3.error?.code === '23503') return personDeaktivieren(id);
  if (r3.error) return { fehler: fehlerText(r3.error) };
  if (!r3.count) return { fehler: ABGELEHNT };
  return { ergebnis: 'geloescht' };
}

// ── Team ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Nachschauen, was mit dem Team passiert: Meldungen? Noch nicht freigegebene Stunden? Wie viel Planung fällt weg? */
export async function teamPruefen(t: { id: string; bezeichnung: string; aktiv: boolean }, mitglieder: number): Promise<Rueckfrage | { fehler: string }> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  const [m, o, p] = await Promise.all([
    supabase.from('tagesmeldung').select('id').eq('team_id', t.id).limit(1),
    supabase.from('zeiteintrag').select('id,tagesmeldung:tagesmeldung_id!inner(team_id)').eq('tagesmeldung.team_id', t.id).eq('status', 'offen').limit(1),
    supabase.from('jahresplan').select('id,von,bis').eq('team_id', t.id),
  ]);
  const e = m.error ?? o.error ?? p.error;
  if (e) return { fehler: fehlerText(e) };
  const entscheid = teamEntscheid({ aktiv: t.aktiv, hatMeldungen: (m.data ?? []).length > 0, hatOffeneStunden: (o.data ?? []).length > 0 });
  const plaene = (p.data ?? []) as Plan[];
  const ab = planungAbMorgen(plaene, iso(new Date()));
  return teamFrage(t.bezeichnung, entscheid, mitglieder, entscheid === 'loeschen' ? plaene.length : ab.weg.length + ab.kuerzen.length);
}

/** Einsätze samt ihrer Terminhistorie entfernen — wie «Einsatz entfernen» in der Planung. */
async function einsaetzeEntfernen(ids: string[]): Promise<string | null> {
  if (!supabase || ids.length === 0) return null;
  const { error: e1 } = await supabase.from('planaenderung').delete().in('jahresplan_id', ids);
  if (e1) return fehlerText(e1);
  const { error: e2 } = await supabase.from('jahresplan').delete().in('id', ids);
  return e2 ? fehlerText(e2) : null;
}

/** Aus allen Listen nehmen: inaktiv, Leute frei, Planung ab morgen weg (was heute läuft, endet heute — protokolliert). */
async function teamDeaktivieren(id: string): Promise<Ergebnis> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  const heute = iso(new Date());
  const r1 = await supabase.from('team').update({ aktiv: false, chefmonteur_id: null }, { count: 'exact' }).eq('id', id);
  if (r1.error) return { fehler: fehlerText(r1.error) };
  if (!r1.count) return { fehler: ABGELEHNT };
  const r2 = await supabase.from('team_mitglied').update({ bis: heute }).eq('team_id', id).is('bis', null);
  if (r2.error) return { fehler: fehlerText(r2.error) };
  const p = await supabase.from('jahresplan').select('id,von,bis').eq('team_id', id).gte('bis', heute);
  if (p.error) return { fehler: fehlerText(p.error) };
  const { weg, kuerzen } = planungAbMorgen((p.data ?? []) as Plan[], heute);
  const f = await einsaetzeEntfernen(weg);
  if (f) return { fehler: f };
  if (kuerzen.length > 0) {
    const { data: u } = await supabase.auth.getUser();
    for (const k of kuerzen) {
      const { error } = await supabase.from('jahresplan').update({ bis: heute }).eq('id', k.id);
      if (error) return { fehler: fehlerText(error) };
      // Terminhistorie wie in der Planung: wer, wann, von, auf, warum — scheitert nur das, ist das Team trotzdem entfernt
      await supabase.from('planaenderung').insert({ jahresplan_id: k.id, feld: 'bis', alt: k.bis, neu: heute, geaendert_von: u.user?.id ?? null, grund: 'Team entfernt' });
    }
  }
  return { ergebnis: 'deaktiviert' };
}

/**
 * Team löschen oder aus den Listen nehmen — nach dem Entscheid aus `teamPruefen`.
 * Kam seit der Prüfung eine Meldung dazu, lehnt die Datenbank das Löschen ab (23503); dann nochmals prüfen lassen,
 * denn die neuen Stunden sind noch nicht freigegeben.
 */
export async function teamEntfernen(id: string, entscheid: Entscheid): Promise<Ergebnis> {
  if (!supabase) return { fehler: KEINE_VERBINDUNG };
  if (entscheid === 'deaktivieren') return teamDeaktivieren(id);
  if (entscheid !== 'loeschen') return { fehler: 'Hier gibt es nichts zu löschen.' };
  const p = await supabase.from('jahresplan').select('id').eq('team_id', id);
  if (p.error) return { fehler: fehlerText(p.error) };
  const f = await einsaetzeEntfernen(((p.data ?? []) as { id: string }[]).map((x) => x.id));
  if (f) return { fehler: f };
  const r1 = await supabase.from('team_mitglied').delete().eq('team_id', id);
  if (r1.error) return { fehler: fehlerText(r1.error) };
  const r2 = await supabase.from('team').delete({ count: 'exact' }).eq('id', id);
  if (r2.error?.code === '23503') return { fehler: 'Inzwischen ist eine Meldung dieses Teams angekommen — Löschen geht nicht mehr. Bitte nochmals auf den Papierkorb tippen.' };
  if (r2.error) return { fehler: fehlerText(r2.error) };
  if (!r2.count) return { fehler: ABGELEHNT };
  return { ergebnis: 'geloescht' };
}
