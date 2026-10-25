import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Port 3000 = Standard-Site-URL der Supabase-Auth → Magic Links landen
  // im Dev ohne Dashboard-Konfiguration am richtigen Ort.
  server: { port: 3000 },
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      // 'prompt' statt 'autoUpdate' (13.10.2026): eine neue Fassung wartet, bis main.tsx sie im ruhigen Moment einspielt —
      // nie mitten in einer angefangenen Tagesmeldung (lib/aktualisierung.ts)
      registerType: 'prompt',
      manifest: {
        name: 'Rapporto',
        short_name: 'Rapporto',
        description: 'Tagesmeldung, Stunden und Rapporte für Gerüstbauer',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#fafafa',
        theme_color: '#fafafa',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Die Karten (MapLibre, ~1 MB) braucht nur das Büro (Tageskarte, Ort der Baustelle), und nur mit Netz —
        // nicht bei jedem Update auf jedes Teamgerät laden (25.10.2026)
        globIgnores: ['**/Landkarte-*.{js,css}', '**/kartenstil-*.{js,css}', '**/OrtWahl-*.{js,css}'],
        // Benachrichtigungen «Plan für morgen» empfangen und antippen (25.10.2026, public/push-sw.js)
        importScripts: ['push-sw.js'],
        // Kein skipWaiting mehr: die neue Version übernimmt erst, wenn main.tsx sie ruft (Hintergrund, Seitenwechsel).
        // Dass kein Tab tagelang auf dem alten Stand bleibt, regelt aktualisierung.ts (spätestens nach einem halben Tag).
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/functions\//],
      },
    }),
  ],
  test: {
    environment: 'node',
    // Nur der ausgelieferte Code wird getestet — `archiv/` bleibt liegen wie es ist
    // (dort steht der Stand mit Regie und Board, siehe archiv/regie-und-board/README.md).
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
