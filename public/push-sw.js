// Benachrichtigungen empfangen (25.10.2026, Schritt 5): wird in den Service Worker der PWA geladen
// (vite.config.ts → workbox.importScripts). Der Inhalt kommt verschlüsselt vom Push-Dienst; der Browser entschlüsselt ihn.
// Tippen öffnet Rapporto auf der Startseite des Teams (Karte «Morgen», «Plan geändert»).
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { text: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.titel || 'Rapporto', {
    body: d.text || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: 'de-CH',
    data: { ziel: d.ziel || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = new URL((event.notification.data && event.notification.data.ziel) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) {
      if (new URL(f.url).origin !== self.location.origin) continue;
      try { await f.focus(); } catch { /* egal */ }
      if ('navigate' in f) { try { await f.navigate(ziel); } catch { /* fremde Seite */ } }
      return;
    }
    await self.clients.openWindow(ziel);
  })());
});
