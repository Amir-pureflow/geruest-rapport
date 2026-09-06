import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './index.css';
import { Start } from './seiten/Start';
import { Erfassung } from './seiten/Erfassung';
import { Cockpit } from './seiten/Cockpit';
import { Tag } from './seiten/Tag';
import { Bestaetigung } from './seiten/Bestaetigung';
import { Anmelden } from './seiten/Anmelden';
import { Zusatzauftrag } from './seiten/Zusatzauftrag';
import { RegieListe } from './seiten/RegieListe';
import { RegieDetail } from './seiten/RegieDetail';
import { Export } from './seiten/Export';
import { Board } from './seiten/Board';
import { Verwaltung } from './seiten/verwaltung/Verwaltung';
import { startAutoFlush, flushNachSupabase } from './lib/db';
import { supabase } from './lib/supabase';

if (supabase) {
  const client = supabase;
  startAutoFlush(() => flushNachSupabase(client));
}

function App() {
  // undefined = noch am Prüfen, null = nicht angemeldet
  const [session, setSession] = useState<Session | null | undefined>(
    supabase ? undefined : null,
  );

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_ereignis, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (supabase && session === undefined) return null; // kurzer Moment beim Start

  // Ohne konfiguriertes Supabase läuft die App offen (lokaler Offline-Modus).
  const eingeloggt = !supabase || session !== null;

  return (
    <BrowserRouter>
      <Routes>
        {/* Kundenlink bleibt immer erreichbar — der Kunde hat kein Konto */}
        <Route path="/b/:token" element={<Bestaetigung />} />
        {eingeloggt && <Route path="/" element={<Start />} />}
        {eingeloggt && <Route path="/zusatzauftrag" element={<Zusatzauftrag />} />}
        {eingeloggt && <Route path="/erfassung" element={<Erfassung />} />}
        {eingeloggt && <Route path="/heute" element={<Tag />} />}
        {eingeloggt && <Route path="/cockpit" element={<Cockpit />} />}
        {eingeloggt && <Route path="/regie" element={<RegieListe />} />}
        {eingeloggt && <Route path="/regie/:id" element={<RegieDetail />} />}
        {eingeloggt && <Route path="/export" element={<Export />} />}
        {eingeloggt && <Route path="/board" element={<Board />} />}
        {eingeloggt && <Route path="/verwaltung" element={<Verwaltung />} />}
        {!eingeloggt && <Route path="*" element={<Anmelden />} />}
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
