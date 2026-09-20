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
      registerType: 'autoUpdate',
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
        // Neue Version sofort übernehmen — sonst zeigt ein offener Tab tagelang den alten Stand
        skipWaiting: true,
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
