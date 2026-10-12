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
import { eigeneFirma } from './einstellungen';
import { offeneAnzahl, warteschlangeZuordnen } from './db';
import { firmaVon, zugang, zugangMerken, zugangVergessen } from './zugang';

/** Dieselben Schlüssel wie StartMonteur.tsx (Person) und StartChef.tsx / Erfassung.tsx (Team). */
const MONTEUR_KEY = 'monteur-id';
const TEAM_KEY = 'teamgeraet-team-id';
/** Für welchen Chefmonteur das Team auf diesem Gerät gewählt wurde (13.10.2026). */
const TEAM_PERSON_KEY = 'teamgeraet-team-person';
/** Zwischenspeicher der Baustellen in Zusatzauftrag.tsx — gehört zur Firma, die angemeldet war. */
const BAUSTELLEN_CACHE_KEY = 'baustellen-cache-v2';

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

/**
 * Was im Gerät zur alten Anmeldung gehört, wegräumen: Firmen-Schalter, Rolle, Person, das gewählte Team und alles mit
 * «teamgeraet-» (zuletzt gewählte Teams, Gäste je Team), Baustellen-Zwischenspeicher, Vorrat. Sonst landete der nächste
 * Chefmonteur auf dem Team seines Vorgängers (13.10.2026). Läuft beim Abmelden und wenn der Server die Sitzung beendet.
 * Die Warteschlange bleibt — sie gehört der Firma, nicht dem Gerät (zugang.ts).
 */
export function geraetAufraeumen(): void {
  try {
    localStorage.removeItem('firma-einstellungen');
    localStorage.removeItem(FESTE_ANSICHT_KEY);
    localStorage.removeItem(MONTEUR_KEY);
    localStorage.removeItem(BAUSTELLEN_CACHE_KEY);
    const weg: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('teamgeraet-')) weg.push(k);
    }
    for (const k of weg) localStorage.removeItem(k);
  } catch { /* egal */ }
  vorratLeeren(); // Teams/Leute vom letzten Mal gehören zum alten Konto
  zugangVergessen();
  ansichtSetzen(null);
}

/**
 * Wie viele Meldungen dieser Anmeldung noch nicht beim Server sind — vor dem Abmelden fragen.
 * Sie bleiben auf dem Gerät und gehen hinaus, sobald dieselbe Firma wieder angemeldet ist.
 */
export async function ungesendet(): Promise<number> {
  return offeneAnzahl().catch(() => 0);
}

/** Abmelden: Sitzung weg, Rollenwahl und Team weg. Was in der Warteschlange liegt, bleibt auf dem Gerät. */
export async function abmelden(): Promise<void> {
  geraetAufraeumen();
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
    // Chefmonteur: sein Team (team.chefmonteur_id) — immer, wenn das Team auf diesem Gerät nicht er gewählt hat.
    // Vorher nur, wenn gar keins gewählt war: ein neuer Chefmonteur landete auf dem Team seines Vorgängers (13.10.2026).
    if (p.ansicht === 'chef' && p.mitarbeiter_id) {
      const gewaehltVon = localStorage.getItem(TEAM_PERSON_KEY);
      const gewaehlt = localStorage.getItem(TEAM_KEY);
      if (gewaehltVon !== p.mitarbeiter_id || !gewaehlt) {
        const { data: teams, error: te } = await supabase.from('team').select('id,bezeichnung').eq('chefmonteur_id', p.mitarbeiter_id).eq('aktiv', true);
        if (!te) {
          const eigene = ((teams ?? []) as { id: string; bezeichnung: string }[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
          if (eigene.length > 0) localStorage.setItem(TEAM_KEY, eigene[0].id);
          else localStorage.removeItem(TEAM_KEY); // er führt (noch) kein Team: wählen, nicht das vom Vorgänger übernehmen
          localStorage.setItem(TEAM_PERSON_KEY, p.mitarbeiter_id);
        }
      }
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
  const s = await zugangPruefen();
  return s === 'ohne_firma' || s === 'inaktiv';
}

/**
 * Stand der Anmeldung beim Start:
 *   ok         — die Datenbank kennt die Firma
 *   inaktiv    — persönlicher Zugang, die Person ist im Büro auf inaktiv gesetzt (0034: dann gibt es keine Firma)
 *   ohne_firma — der Zugang hängt an keiner Firma (Einrichtung fehlt)
 *   unklar     — keine Antwort (kein Netz, Zeitüberschreitung): weiterarbeiten wie bisher (Regel #4)
 */
export type ZugangStand = 'ok' | 'inaktiv' | 'ohne_firma' | 'unklar';

/**
 * Merkt sich nebenbei, zu welcher Firma die Anmeldung gehört (zugang.ts) — sofort den Benutzer aus der Sitzung (geht
 * ohne Netz), die Firma, sobald die Datenbank sie nennt. Danach bekommen Meldungen, die dieser Benutzer vorher ohne
 * bekannte Firma erfasst hat, ihre Firma nachgetragen.
 */
export async function zugangPruefen(): Promise<ZugangStand> {
  if (!supabase) return 'unklar';
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id ?? null;
  if (!uid) return 'unklar';
  const bekannt = firmaVon(uid);
  if (zugang()?.user !== uid) zugangMerken({ user: uid, firma: bekannt.firma, name: bekannt.name });
  const { data, error } = await supabase.rpc('aktuelle_firma');
  if (error) return 'unklar';
  if (typeof data === 'string' && data) {
    const f = eigeneFirma();
    const name = f && f.id === data ? f.name : bekannt.name;
    zugangMerken({ user: uid, firma: data, name });
    await warteschlangeZuordnen(uid, data, name).catch(() => undefined);
    return 'ok';
  }
  // Keine Firma. Persönlicher Zugang mit Person? Dann ist sie im Büro auf inaktiv gesetzt worden.
  const { data: b, error: be } = await supabase.from('benutzer').select('mitarbeiter_id').eq('auth_user_id', uid).maybeSingle();
  if (!be && (b as { mitarbeiter_id: string | null } | null)?.mitarbeiter_id) return 'inaktiv';
  return 'ohne_firma';
}

/**
 * Nur den Benutzer aus der Sitzung merken — ohne Netz, sofort beim Start. So tragen Meldungen, die gleich danach
 * erfasst werden, schon das richtige Konto, auch wenn die Datenbank noch nicht geantwortet hat.
 */
export async function zugangAusSitzung(): Promise<void> {
  if (!supabase) return;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id ?? null;
  if (!uid || zugang()?.user === uid) return;
  zugangMerken({ user: uid, firma: null, name: null });
}
