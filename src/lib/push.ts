/**
 * Benachrichtigungen «Plan für morgen» (25.10.2026, Schritt 5, Migration 0052): Das Teamgerät bzw. das Handy des
 * Chefmonteurs bekommt um 16:00 den Plan für den nächsten Arbeitstag und eine Nachricht, wenn das Büro den Plan für heute
 * oder morgen ändert. Mehr nicht (Amir: keine Quittung, keine Erinnerung).
 *
 * Web Push: Der Browser gibt ein Abo (Adresse beim Push-Dienst + Schlüssel), das in `push_abo` landet — zusammen mit dem
 * Team, das auf dem Gerät gewählt ist. Wechselt das Gerät das Team, wird das Abo nachgezogen. Auf dem iPhone gibt es Web
 * Push nur, wenn Rapporto auf dem Home-Bildschirm installiert ist (ab iOS 16.4).
 */
import { supabase } from './supabase';
import { istApple } from './adresse';

export type PushStand = 'an' | 'aus' | 'blockiert' | 'iphone-installieren' | 'nicht-moeglich';

const AUS_BIS_KEY = 'push-hinweis-aus-bis';
const ABGLEICH_KEY = 'push-abgleich';

/** Unterstützt der Browser Web Push überhaupt? */
export function pushMoeglich(w: { navigator: Navigator } & Partial<Window> = window): boolean {
  return 'serviceWorker' in w.navigator && 'PushManager' in w && 'Notification' in w;
}

/** Als App installiert (Home-Bildschirm) statt im Browser-Tab? */
export function installiert(): boolean {
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * Stand auf diesem Gerät — rein, damit testbar: `moeglich` (Web Push vorhanden), `apple` (iPhone/iPad), `installiert`,
 * `erlaubnis` (Notification.permission), `abo` (ein Abo liegt im Browser).
 */
export function standAus(o: { moeglich: boolean; apple: boolean; installiert: boolean; erlaubnis: NotificationPermission | null; abo: boolean }): PushStand {
  if (!o.moeglich) return o.apple && !o.installiert ? 'iphone-installieren' : 'nicht-moeglich';
  if (o.erlaubnis === 'denied') return 'blockiert';
  return o.erlaubnis === 'granted' && o.abo ? 'an' : 'aus';
}

async function registrierung(ms = 6000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // `ready` wartet ewig, wenn kein Service Worker läuft (Entwicklung, privater Modus) — darum mit Frist
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function pushStand(): Promise<PushStand> {
  const moeglich = pushMoeglich();
  const apple = istApple(navigator.userAgent, navigator.maxTouchPoints);
  let abo = false;
  if (moeglich) {
    const reg = await registrierung(3000);
    abo = !!(await reg?.pushManager.getSubscription().catch(() => null));
  }
  return standAus({ moeglich, apple, installiert: installiert(), erlaubnis: moeglich ? Notification.permission : null, abo });
}

function ausB64u(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const geraetText = () => {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Gerät';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ' · ' + br : ''}${installiert() ? ' · App' : ''}`;
};

async function aboSpeichern(sub: PushSubscription, teamId: string): Promise<string | null> {
  if (!supabase) return 'keine Verbindung';
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return 'Abo unvollständig';
  const { error } = await supabase.rpc('push_abo_setzen', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_team: teamId, p_geraet: geraetText() });
  return error ? error.message : null;
}

/** Einschalten (nur aus einem Tipp heraus — sonst fragt der Browser nicht). Gibt einen Fehlertext zurück oder null. */
export async function pushEinschalten(teamId: string): Promise<string | null> {
  if (!supabase) return 'keine Verbindung';
  if (!pushMoeglich()) return 'Dieser Browser kann keine Benachrichtigungen.';
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') return erlaubnis === 'denied' ? 'blockiert' : 'abgebrochen';
  const { data: schluessel, error } = await supabase.rpc('push_schluessel');
  if (error) return error.message;
  if (typeof schluessel !== 'string' || !schluessel) return 'Benachrichtigungen sind noch nicht eingerichtet.';
  const reg = await registrierung();
  if (!reg) return 'Die App ist noch nicht fertig geladen — bitte neu laden und nochmals versuchen.';
  let sub = await reg.pushManager.getSubscription();
  // Abo mit einem anderen Schlüssel (Schlüssel gewechselt): neu abonnieren
  const altKey = sub?.options.applicationServerKey;
  if (sub && altKey) {
    const a = new Uint8Array(altKey), b = ausB64u(schluessel);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) { await sub.unsubscribe().catch(() => undefined); sub = null; }
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ausB64u(schluessel) });
  } catch (e) {
    return 'Abonnieren ging nicht: ' + (e instanceof Error ? e.message : String(e));
  }
  const f = await aboSpeichern(sub, teamId);
  if (!f) try { localStorage.setItem(ABGLEICH_KEY, `${teamId}|${new Date().toDateString()}`); } catch { /* egal */ }
  return f;
}

/**
 * Beim Öffnen der Team-Startseite: Ist das Gerät abonniert, das Abo dem gewählten Team zuordnen (Teamwechsel) — einmal
 * am Tag je Team genügt. Still: Fehler stören das Team nicht.
 */
export async function pushAbgleichen(teamId: string): Promise<void> {
  try {
    if (!pushMoeglich() || Notification.permission !== 'granted') return;
    const merk = `${teamId}|${new Date().toDateString()}`;
    if (localStorage.getItem(ABGLEICH_KEY) === merk) return;
    const reg = await registrierung(3000);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (!(await aboSpeichern(sub, teamId))) localStorage.setItem(ABGLEICH_KEY, merk);
  } catch { /* still */ }
}

/** «Nicht jetzt»: Hinweis zwei Wochen nicht zeigen */
export function hinweisAusblenden(): void {
  try { localStorage.setItem(AUS_BIS_KEY, String(Date.now() + 14 * 24 * 3600 * 1000)); } catch { /* egal */ }
}

export function hinweisAusgeblendet(): boolean {
  try { return Number(localStorage.getItem(AUS_BIS_KEY) ?? 0) > Date.now(); } catch { return false; }
}
