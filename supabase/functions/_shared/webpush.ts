// Web Push ohne Fremdbibliothek (25.10.2026, Schritt 5 «Plan für morgen»): nur WebCrypto, läuft in Deno (Edge Function)
// und in Node (Test). Zwei Normen:
//   RFC 8292 (VAPID): der Absender weist sich mit einem signierten Kurz-Token aus (ES256), der Push-Dienst prüft es.
//   RFC 8291 + 8188 (aes128gcm): der Inhalt ist für genau dieses Gerät verschlüsselt — der Push-Dienst (Google, Apple,
//   Mozilla) sieht nur Datenmüll. Schlüsselaustausch über ECDH P-256 mit dem öffentlichen Schlüssel des Geräts.
// Getestet gegen einen unabhängigen Entschlüssler (http_ece) und eine echte Signaturprüfung.

export interface Abo {
  endpoint: string;
  /** öffentlicher Schlüssel des Geräts, base64url, 65 Byte unkomprimiert */
  p256dh: string;
  /** Geheimnis des Geräts, base64url, 16 Byte */
  auth: string;
}

export interface Vapid {
  /** öffentlicher Schlüssel, base64url, 65 Byte unkomprimiert (0x04 || x || y) */
  oeffentlich: string;
  /** privater Schlüssel d, base64url, 32 Byte */
  privat: string;
  /** Kontakt für den Push-Dienst: «mailto:…» oder «https://…» */
  kontakt: string;
}

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function ausB64u(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function verbinden(...teile: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of teile) { out.set(t, i); i += t.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, laenge: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, laenge * 8);
  return new Uint8Array(bits);
}

/** «vapid t=…, k=…» für den Authorization-Header (12 Stunden gültig). */
export async function vapidKopf(endpoint: string, v: Vapid, jetzt = Date.now()): Promise<string> {
  const pub = ausB64u(v.oeffentlich);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: v.privat, ext: true };
  const schluessel = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const kopf = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const inhalt = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(jetzt / 1000) + 12 * 3600, sub: v.kontakt })));
  // WebCrypto liefert die Signatur schon als r || s (64 Byte) — genau das will JWS
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, schluessel, enc.encode(`${kopf}.${inhalt}`)));
  return `vapid t=${kopf}.${inhalt}.${b64u(sig)}, k=${v.oeffentlich}`;
}

/** Inhalt für ein Gerät verschlüsseln (aes128gcm, ein Datensatz). */
export async function verschluesseln(abo: Abo, nutzlast: Uint8Array): Promise<Uint8Array> {
  const uaPub = ausB64u(abo.p256dh);
  const authGeheim = ausB64u(abo.auth);
  const eigene = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eigene.publicKey));
  const geraet = await crypto.subtle.importKey('raw', uaPub as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const geteilt = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: geraet }, eigene.privateKey, 256));
  // RFC 8291 §3.4: IKM aus dem geteilten Geheimnis und dem Auth-Geheimnis des Geräts
  const ikm = await hkdf(authGeheim, geteilt, verbinden(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salz, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salz, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  // Ein einziger (= letzter) Datensatz: Trennzeichen 0x02, keine Füllung
  const klartext = verbinden(nutzlast, new Uint8Array([2]));
  const geheim = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, klartext as BufferSource));
  // Kopf RFC 8188: Salz (16) · Datensatzgrösse (4, big endian) · Länge der Schlüssel-Id (1) · Schlüssel-Id = unser öffentl. Schlüssel
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return verbinden(salz, rs, new Uint8Array([asPub.length]), asPub, geheim);
}

export interface Ergebnis {
  status: number;
  /** Abo gibt es nicht mehr (Gerät abgemeldet, App gelöscht) — löschen */
  weg: boolean;
  text?: string;
}

/** Eine Nachricht an ein Gerät. `ttl` in Sekunden: so lange hält der Push-Dienst sie, wenn das Gerät aus ist. */
export async function senden(abo: Abo, daten: unknown, v: Vapid, ttl = 6 * 3600): Promise<Ergebnis> {
  const koerper = await verschluesseln(abo, enc.encode(JSON.stringify(daten)));
  const r = await fetch(abo.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidKopf(abo.endpoint, v),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body: koerper as BodyInit,
  });
  const text = r.ok ? undefined : (await r.text().catch(() => '')).slice(0, 300);
  return { status: r.status, weg: r.status === 404 || r.status === 410, text };
}
