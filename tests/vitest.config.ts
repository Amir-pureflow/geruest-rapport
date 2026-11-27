/**
 * Prüf-Konfiguration (Branch «pruefung», 27.11.2026).
 *
 * Unterschied zur normalen Konfiguration in vite.config.ts:
 *  - `envDir` zeigt auf tests/umgebung — die echte `.env` (Live-Datenbank) wird NIE geladen.
 *  - `sperre.ts` läuft vor jedem Test: jede Anfrage an etwas anderes als 127.0.0.1/localhost bricht ab.
 *
 * Start:  npx vitest run --config tests/vitest.config.ts
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  envDir: fileURLToPath(new URL('./umgebung', import.meta.url)),
  resolve: {
    // Edge-Function-Code (Deno) im Test laden: npm:-Importe auf Node-Pakete bzw. Ersatz umbiegen
    alias: {
      'npm:pdf-lib@1.17.1': fileURLToPath(new URL('./ersatz/pdf-lib.ts', import.meta.url)),
      'npm:@supabase/supabase-js@2': '@supabase/supabase-js',
    },
  },
  test: {
    environment: 'node',
    setupFiles: [fileURLToPath(new URL('./sperre.ts', import.meta.url))],
    include: ['src/**/*.test.{ts,tsx}', 'tests/einheit/**/*.test.ts', 'tests/rls/**/*.test.ts'],
    // RLS-Tests brauchen die lokale Datenbank und laufen nacheinander (gemeinsame Daten)
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
