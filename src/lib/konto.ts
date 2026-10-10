/**
 * Anmeldung der Firma (Entscheid 02.10.2026, Amir).
 *
 * Vorher kam direkt «Welche Ansicht?» und die Datenbank bekam eine anonyme Sitzung. Jeder, der die
 * Adresse kannte, war drin. Jetzt steht davor eine Anmeldung: **eine je Firma**, nicht je Person
 * und nicht je Rolle. Nach dem Anmelden bleibt alles wie bisher — man wählt Bauführer, Chefmonteur,
 * Monteur oder Sekretariat und arbeitet weiter.
 *
 * Was das löst und was nicht, damit es niemand verwechselt:
 *   gelöst   — ohne Zugang kommt niemand mehr in die App.
 *   offen    — innerhalb der Firma unterscheidet die Datenbank weiterhin niemanden. Das
 *              `freigabe_log` hält dann die Firma fest, nicht die Person. Persönliche Konten und
 *              Rechte je Rolle in der Datenbank sind der nächste Schritt (siehe CLAUDE.md).
 *
 * Passwörter stehen nirgends im Code und nirgends im Repo.
 *
 * Offline: Supabase legt die Sitzung im Gerät ab. Verliert das Teamgerät das Netz, bleibt die
 * Anmeldung bestehen und die Meldungen gehen weiter in die Warteschlange (CLAUDE.md #4).
 */
import { supabase } from './supabase';
import { vorratLeeren } from './vorrat';
import { ansichtSetzen, FESTE_ANSICHT_KEY, type Ansicht } from './ansicht';

/** Dieselben Schlüssel wie StartMonteur.tsx (Person) und StartChef.tsx / Erfassung.tsx (Team). */
const MONTEUR_KEY = 'monteur-id';
const TEAM_KEY = 'teamgeraet-team-id';

/** Anmelden. null heisst geklappt, sonst ein Satz für den Bildschirm. */
export async function anmelden(email: string, passwort: string): Promise<string | null> {
  if (!supabase) return 'Keine Datenverbindung.';
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: passwort });
  if (error) {
    const m = error.message;
    if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
    if (/email not confirmed/i.test(m)) return 'Dieses Konto ist noch nicht freigeschaltet.';
    if (/rate limit/i.test(m)) return 'Zu viele Versuche. Kurz warten und nochmals probieren.';
    return m;
  }
  // Welche Firma das ist, holt die App gleich danach aus der Datenbank (einstellungenLaden).
  return null;
}

/** Abmelden: Sitzung weg, Rollenwahl weg. Was in der Warteschlange liegt, bleibt auf dem Gerät. */
export async function abmelden(): Promise<void> {
  try {
    localStorage.removeItem('firma-einstellungen');
    localStorage.removeItem(FESTE_ANSICHT_KEY);
    localStorage.removeItem(MONTEUR_KEY);
  } catch { /* egal */ }
  vorratLeeren(); // Teams/Leute vom letzten Mal gehören zum alten Konto
  ansichtSetzen(null);
  // Nur dieses Gerät (10.10.2026). Ohne `scope: 'local'` meldet Supabase alle Geräte mit demselben Zugang ab — bei geteilten
  // Zugängen (buero@, pureflow@) schlug dann auf den anderen Geräten jedes Speichern fehl («row-level security»).
  if (supabase) await supabase.auth.signOut({ scope: 'local' });
}

/**
 * Ist eine Firma angemeldet? Eine anonyme Sitzung zählt nicht — die hatte früher jeder,
 * der die Adresse kannte.
 */
export async function angemeldet(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  return !!s && s.user.is_anonymous !== true;
}

/**
 * Persönlicher Zugang (Migration 0033, 09.10.2026): Gehört die Anmeldung zu einer Person, stehen in
 * `benutzer` die Person und ihre Ansicht. Dann wählt das Gerät beides selbst — der Chefmonteur landet
 * direkt bei seinem Team, der Monteur bei «Meine Woche».
 *
 * Läuft beim Start nach der Anmeldung. Ohne Netz oder ohne Migration tut es nichts: dann gilt, was
 * schon im Gerät liegt (Regel #4, gleiches Muster wie die Firmen-Schalter).
 */
export async function personLaden(): Promise<void> {
  if (!supabase) return;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return;
  const { data, error } = await supabase.from('benutzer').select('mitarbeiter_id, ansicht').eq('auth_user_id', uid).maybeSingle();
  if (error) return;
  const p = data as { mitarbeiter_id: string | null; ansicht: Ansicht | null } | null;
  if (!p?.ansicht) {
    try { localStorage.removeItem(FESTE_ANSICHT_KEY); } catch { /* egal */ }
    return;
  }
  try {
    localStorage.setItem(FESTE_ANSICHT_KEY, p.ansicht);
    if (p.mitarbeiter_id) localStorage.setItem(MONTEUR_KEY, p.mitarbeiter_id);
    // Chefmonteur: sein Team vorwählen, wenn er genau eines führt und noch keines gewählt ist.
    if (p.ansicht === 'chef' && p.mitarbeiter_id && !localStorage.getItem(TEAM_KEY)) {
      const { data: teams } = await supabase.from('team').select('id').eq('chefmonteur_id', p.mitarbeiter_id).eq('aktiv', true);
      if (teams?.length === 1) localStorage.setItem(TEAM_KEY, (teams[0] as { id: string }).id);
    }
  } catch { /* privater Modus — dann wählt man von Hand */ }
  ansichtSetzen(p.ansicht);
}

/**
 * Angemeldet, aber ohne Firma? Dann zeigt die App das, statt leerer Listen (10.10.2026).
 * Nur `true`, wenn die Datenbank wirklich antwortet und null sagt — offline oder bei einem Fehler `false`,
 * damit ein Teamgerät ohne Netz weiterarbeitet (Regel #4).
 */
export async function zugangOhneFirma(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('aktuelle_firma');
  return !error && data === null;
}
