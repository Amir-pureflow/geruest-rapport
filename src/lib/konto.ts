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
import { ansichtSetzen } from './ansicht';

const FIRMA_KEY = 'firma-name';

/** Name der angemeldeten Firma, für die Kopfzeile. Kommt aus dem Konto, liegt fürs Offline im Gerät. */
export function firmaName(): string | null {
  try {
    return localStorage.getItem(FIRMA_KEY);
  } catch {
    return null;
  }
}

function firmaMerken(name: string | null) {
  try {
    if (name) localStorage.setItem(FIRMA_KEY, name);
    else localStorage.removeItem(FIRMA_KEY);
  } catch {
    /* privater Modus — dann steht der Name eben nicht in der Kopfzeile */
  }
}

/** Anmelden. null heisst geklappt, sonst ein Satz für den Bildschirm. */
export async function anmelden(email: string, passwort: string): Promise<string | null> {
  if (!supabase) return 'Keine Datenverbindung.';
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: passwort });
  if (error) {
    const m = error.message;
    if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
    if (/email not confirmed/i.test(m)) return 'Dieses Konto ist noch nicht freigeschaltet.';
    if (/rate limit/i.test(m)) return 'Zu viele Versuche. Kurz warten und nochmals probieren.';
    return m;
  }
  firmaMerken((data.user?.user_metadata?.firma as string | undefined) ?? null);
  return null;
}

/** Abmelden: Sitzung weg, Rollenwahl weg. Was in der Warteschlange liegt, bleibt auf dem Gerät. */
export async function abmelden(): Promise<void> {
  ansichtSetzen(null);
  firmaMerken(null);
  if (supabase) await supabase.auth.signOut();
}

/**
 * Ist eine Firma angemeldet? Eine anonyme Sitzung zählt nicht — die hatte früher jeder,
 * der die Adresse kannte.
 */
export async function angemeldet(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (s && s.user.is_anonymous !== true) {
    firmaMerken((s.user.user_metadata?.firma as string | undefined) ?? firmaName());
    return true;
  }
  return false;
}
