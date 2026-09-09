import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { Start } from './seiten/Start';
import { Ansicht } from './seiten/Ansicht';
import { Erfassung } from './seiten/Erfassung';
import { Cockpit } from './seiten/Cockpit';
import { Tag } from './seiten/Tag';
import { Bestaetigung } from './seiten/Bestaetigung';
import { Zusatzauftrag } from './seiten/Zusatzauftrag';
import { RegieListe } from './seiten/RegieListe';
import { RegieDetail } from './seiten/RegieDetail';
import { RegieVorschau } from './seiten/RegieVorschau';
import { Export } from './seiten/Export';
import { Board } from './seiten/Board';
import { Verwaltung } from './seiten/verwaltung/Verwaltung';
import { startAutoFlush, flushNachSupabase } from './lib/db';
import { supabase } from './lib/supabase';
import { SEITEN, useAnsicht } from './lib/ansicht';

if (supabase) {
  const client = supabase;
  startAutoFlush(() => flushNachSupabase(client));
}

// Neue Version holen, auch wenn der Tab den ganzen Tag offen bleibt (Bauführer-PC):
// stündlich nachschauen; autoUpdate lädt die Seite neu, sobald die neue Version aktiv ist.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
  },
});

function App() {
  const ansicht = useAnsicht();
  const [bereit, setBereit] = useState(!supabase);
  const [verbindungsHinweis, setVerbindungsHinweis] = useState('');

  // Kein Login (09.09.): Die Datenbank braucht trotzdem eine Sitzung, damit ihre Rechte greifen.
  // Darum im Hintergrund eine anonyme Sitzung — einmal pro Gerät, unsichtbar.
  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    void (async () => {
      const { data } = await c.auth.getSession();
      if (!data.session) {
        const { error } = await c.auth.signInAnonymously();
        if (error) setVerbindungsHinweis(error.message);
      }
      setBereit(true);
    })();
  }, []);

  if (!bereit) return null; // kurzer Moment beim Start

  const hat = (seite: string) => !!ansicht && SEITEN[ansicht].includes(seite);

  return (
    <BrowserRouter>
      <Routes>
        {/* Kundenlink bleibt immer erreichbar — der Kunde hat kein Konto */}
        <Route path="/b/:token" element={<Bestaetigung />} />
        <Route path="/ansicht" element={<Ansicht hinweis={verbindungsHinweis} />} />
        {!ansicht && <Route path="*" element={<Ansicht hinweis={verbindungsHinweis} />} />}
        {ansicht && <Route path="/" element={<Start />} />}
        {hat('zusatzauftrag') && <Route path="/zusatzauftrag" element={<Zusatzauftrag />} />}
        {hat('erfassung') && <Route path="/erfassung" element={<Erfassung />} />}
        {hat('heute') && <Route path="/heute" element={<Tag />} />}
        {hat('cockpit') && <Route path="/cockpit" element={<Cockpit />} />}
        {hat('regie') && <Route path="/regie" element={<RegieListe />} />}
        {hat('regie') && <Route path="/regie/neu" element={<RegieVorschau />} />}
        {hat('regie') && <Route path="/regie/:id" element={<RegieDetail />} />}
        {hat('export') && <Route path="/export" element={<Export />} />}
        {hat('board') && <Route path="/board" element={<Board />} />}
        {hat('verwaltung') && <Route path="/verwaltung" element={<Verwaltung />} />}
        {ansicht && <Route path="*" element={<Navigate to="/" replace />} />}
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
