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
        name: 'Gerüst Rapport',
        short_name: 'Rapport',
        description: 'Zeiterfassung, Rapporte und Regie',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#EDF1F0',
        theme_color: '#EDF1F0',
        // TODO: Icons ergänzen (192/512 px), bevor das erste Gerät eingerichtet wird
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
