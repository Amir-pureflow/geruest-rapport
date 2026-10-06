import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { Start } from './seiten/Start';
import { Ansicht } from './seiten/Ansicht';
import { Anmelden } from './seiten/Anmelden';
import { Erfassung } from './seiten/Erfassung';
import { Cockpit } from './seiten/Cockpit';
import { Tag } from './seiten/Tag';
import { Export } from './seiten/Export';
import { Verwaltung } from './seiten/verwaltung/Verwaltung';
// Regie-Seiten: nur erreichbar, wenn die Firma mit Regie arbeitet (Firmen-Schalter MODUS_ERFASSUNG).
// Nachladen, damit der Wochenblatt-Modus den Code gar nicht erst holt.
import { lazy, Suspense } from 'react';
const Zusatzauftrag = lazy(() => import('./seiten/Zusatzauftrag').then((m) => ({ default: m.Zusatzauftrag })));
const RegieListe = lazy(() => import('./seiten/RegieListe').then((m) => ({ default: m.RegieListe })));
const RegieDetail = lazy(() => import('./seiten/RegieDetail').then((m) => ({ default: m.RegieDetail })));
const RegieVorschau = lazy(() => import('./seiten/RegieVorschau').then((m) => ({ default: m.RegieVorschau })));
const Auswertung = lazy(() => import('./seiten/Auswertung').then((m) => ({ default: m.Auswertung })));
const Planung = lazy(() => import('./seiten/Planung').then((m) => ({ default: m.Planung })));
const Bestaetigung = lazy(() => import('./seiten/Bestaetigung').then((m) => ({ default: m.Bestaetigung })));
import { Shell } from './ui/Shell';
import { ansichten, ANSICHT_LABEL, ansichtSetzen } from './lib/ansicht';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { startAutoFlush, flushNachSupabase } from './lib/db';
import { supabase } from './lib/supabase';
import { seitenFuer, useAnsicht, type Ansicht as AnsichtKey } from './lib/ansicht';
import { einstellungen, einstellungenLaden } from './lib/einstellungen';
import { angemeldet } from './lib/konto';

// Regie, Zusatzaufträge, Kundenlink und Board waren vom 20.09. bis 02.10.2026 ganz draussen (Bauführer: SORBA macht das).
// Seit 02.10. gibt es sie wieder, aber nur für Firmen, die das wollen — Schalter in der Zeile der Firma
// (Verwaltung → Einstellungen). Gerüst GmbH (Arbnor) läuft ohne, We-Plan mit. Das Archiv in
// archiv/regie-und-board/ bleibt als Nachschlagewerk stehen.
//
// Seit Migration 0019 ist die Anmeldung Pflicht: eine Datenbank für alle Firmen, und die Datenbank
// zeigt nur die Zeilen der angemeldeten Firma. Ohne Anmeldung gibt es keine einzige Zeile — darum
// gibt es auch keine anonyme Sitzung mehr.

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
  const passende = ansichten().filter((a) => seitenFuer(a.key).includes(seite));
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
  // Ohne Sitzung liefert die Datenbank leere Listen — dann lieber den Grund zeigen als «Keine Teams».
  const [sitzung, setSitzung] = useState(!supabase);

  /**
   * Beim Start: ist eine Firma angemeldet? Erst dann die Schalter dieser Firma laden.
   * Ohne Anmeldung liefert die Datenbank nichts, also hat auch das Laden keinen Sinn.
   */
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const ok = await angemeldet().catch(() => false);
      setSitzung(ok);
      if (ok) await einstellungenLaden().catch(() => undefined);
      setBereit(true);
    })();
  }, []);

  if (!bereit) return null; // kurzer Moment beim Start

  // Niemand angemeldet: nur die Anmeldeseite, sonst nichts.
  // Der Kundenlink /b/:token bleibt offen — die Bauleitung hat kein Konto und soll keines brauchen.
  if (!sitzung && !window.location.pathname.startsWith('/b/')) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Anmelden />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const hat = (seite: string) => sitzung && !!ansicht && seitenFuer(ansicht).includes(seite);
  const regieModus = einstellungen().erfassung === 'regie';

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/ansicht" element={<Ansicht />} />
        {(!ansicht || !sitzung) && <Route path="*" element={<Ansicht />} />}
        {sitzung && ansicht && <Route path="/" element={<Start />} />}
        {hat('erfassung') && <Route path="/erfassung" element={<Erfassung />} />}
        {hat('heute') && <Route path="/heute" element={<Tag />} />}
        {hat('cockpit') && <Route path="/cockpit" element={<Cockpit />} />}
        {hat('export') && <Route path="/export" element={<Export />} />}
        {hat('verwaltung') && <Route path="/verwaltung" element={<Verwaltung />} />}
        {/* Regie-Modus: Kundenlink ohne Login, Zusatzauftrag, Regierapporte, Auswertung, Planung */}
        {regieModus && <Route path="/b/:token" element={<Suspense fallback={null}><Bestaetigung /></Suspense>} />}
        {hat('zusatzauftrag') && <Route path="/zusatzauftrag" element={<Suspense fallback={null}><Zusatzauftrag /></Suspense>} />}
        {hat('regie') && <Route path="/regie" element={<Suspense fallback={null}><RegieListe /></Suspense>} />}
        {hat('regie') && <Route path="/regie/neu" element={<Suspense fallback={null}><RegieVorschau /></Suspense>} />}
        {hat('regie') && <Route path="/regie/:id" element={<Suspense fallback={null}><RegieDetail /></Suspense>} />}
        {hat('auswertung') && <Route path="/auswertung" element={<Suspense fallback={null}><Auswertung /></Suspense>} />}
        {hat('planung') && <Route path="/planung" element={<Suspense fallback={null}><Planung /></Suspense>} />}
        {/* Das Board ist seit 06.10.2026 die Planung — alte Lesezeichen leiten weiter */}
        {hat('planung') && <Route path="/board" element={<Navigate to="/planung" replace />} />}
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
