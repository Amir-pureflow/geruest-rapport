import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { Auswertung } from './seiten/Auswertung';
import { Shell } from './ui/Shell';
import { ANSICHTEN, ANSICHT_LABEL, ansichtSetzen } from './lib/ansicht';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { startAutoFlush, flushNachSupabase } from './lib/db';
import { supabase } from './lib/supabase';
import { SEITEN, useAnsicht, type Ansicht as AnsichtKey } from './lib/ansicht';

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

/** Link zu einer Seite, die die gewählte Ansicht nicht hat: erklären und wechseln lassen, nicht stumm umleiten. */
function FremdeSeite({ ansicht }: { ansicht: AnsichtKey }) {
  const { pathname, search } = useLocation();
  const navigiere = useNavigate();
  const seite = pathname.split('/')[1];
  const passende = ANSICHTEN.filter((a) => SEITEN[a.key].includes(seite));
  function wechseln(zu: AnsichtKey) {
    ansichtSetzen(zu);
    navigiere(pathname + search, { replace: true });
  }
  return (
    <Shell zurueck>
      <div className="card space-y-3">
        <p className="font-display text-lg font-bold">Diese Seite gehört nicht zur Ansicht «{ANSICHT_LABEL[ansicht]}»</p>
        {passende.length > 0 ? (
          <>
            <p className="text-sm text-ink2">Sie ist Teil von: {passende.map((a) => a.titel).join(', ')}. Ansicht wechseln und dort weitermachen?</p>
            <div className="flex flex-wrap gap-2">
              {passende.map((a) => (
                <button key={a.key} type="button" className="btn-ghost" onClick={() => wechseln(a.key)}>Als {a.titel} öffnen</button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink2">Diese Adresse gibt es nicht.</p>
        )}
        <Link to="/" className="block text-sm font-semibold text-steel">‹ Zur Übersicht</Link>
      </div>
    </Shell>
  );
}

function App() {
  const ansicht = useAnsicht();
  const [bereit, setBereit] = useState(!supabase);
  const [verbindungsHinweis, setVerbindungsHinweis] = useState('');
  // Ohne Sitzung liefert die Datenbank leere Listen — dann lieber den Grund zeigen als «Keine Teams».
  const [sitzung, setSitzung] = useState(!supabase);

  // Kein Login (09.09.): Die Datenbank braucht trotzdem eine Sitzung, damit ihre Rechte greifen.
  // Darum im Hintergrund eine anonyme Sitzung — einmal pro Gerät, unsichtbar.
  useEffect(() => {
    if (!supabase) return;
    const c = supabase;
    void (async () => {
      const { data } = await c.auth.getSession();
      if (data.session) setSitzung(true);
      else {
        const { data: neu, error } = await c.auth.signInAnonymously();
        if (error || !neu.session) setVerbindungsHinweis(error?.message ?? 'Keine Sitzung');
        else setSitzung(true);
      }
      setBereit(true);
    })();
  }, []);

  if (!bereit) return null; // kurzer Moment beim Start

  const hat = (seite: string) => sitzung && !!ansicht && SEITEN[ansicht].includes(seite);

  return (
    <BrowserRouter>
      <Routes>
        {/* Kundenlink bleibt immer erreichbar — der Kunde hat kein Konto */}
        <Route path="/b/:token" element={<Bestaetigung />} />
        <Route path="/ansicht" element={<Ansicht hinweis={verbindungsHinweis} />} />
        {(!ansicht || !sitzung) && <Route path="*" element={<Ansicht hinweis={verbindungsHinweis} />} />}
        {sitzung && ansicht && <Route path="/" element={<Start />} />}
        {hat('zusatzauftrag') && <Route path="/zusatzauftrag" element={<Zusatzauftrag />} />}
        {hat('erfassung') && <Route path="/erfassung" element={<Erfassung />} />}
        {hat('heute') && <Route path="/heute" element={<Tag />} />}
        {hat('cockpit') && <Route path="/cockpit" element={<Cockpit />} />}
        {hat('regie') && <Route path="/regie" element={<RegieListe />} />}
        {hat('regie') && <Route path="/regie/neu" element={<RegieVorschau />} />}
        {hat('regie') && <Route path="/regie/:id" element={<RegieDetail />} />}
        {hat('auswertung') && <Route path="/auswertung" element={<Auswertung />} />}
        {hat('export') && <Route path="/export" element={<Export />} />}
        {hat('board') && <Route path="/board" element={<Board />} />}
        {hat('verwaltung') && <Route path="/verwaltung" element={<Verwaltung />} />}
        {sitzung && ansicht && <Route path="*" element={<FremdeSeite ansicht={ansicht} />} />}
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
