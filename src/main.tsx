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
// Nachgeladen, damit der Start schnell bleibt — und gleich nach dem Start im Hintergrund vorgeladen (siehe vorladen()),
// damit der erste Klick auf «Regierapporte» nicht erst auf den Code warten muss (08.10.2026: weisses Aufblitzen).
import { lazy, Suspense } from 'react';
const NACHLADEN = {
  zusatzauftrag: () => import('./seiten/Zusatzauftrag'),
  regieListe: () => import('./seiten/RegieListe'),
  regieDetail: () => import('./seiten/RegieDetail'),
  regieVorschau: () => import('./seiten/RegieVorschau'),
  auswertung: () => import('./seiten/Auswertung'),
  planung: () => import('./seiten/Planung'),
  bestaetigung: () => import('./seiten/Bestaetigung'),
};
const Zusatzauftrag = lazy(() => NACHLADEN.zusatzauftrag().then((m) => ({ default: m.Zusatzauftrag })));
const RegieListe = lazy(() => NACHLADEN.regieListe().then((m) => ({ default: m.RegieListe })));
const RegieDetail = lazy(() => NACHLADEN.regieDetail().then((m) => ({ default: m.RegieDetail })));
const RegieVorschau = lazy(() => NACHLADEN.regieVorschau().then((m) => ({ default: m.RegieVorschau })));
const Auswertung = lazy(() => NACHLADEN.auswertung().then((m) => ({ default: m.Auswertung })));
const Planung = lazy(() => NACHLADEN.planung().then((m) => ({ default: m.Planung })));
const Bestaetigung = lazy(() => NACHLADEN.bestaetigung().then((m) => ({ default: m.Bestaetigung })));

/** Nach dem Start, wenn der Browser Luft hat: die nachgeladenen Seiten schon holen (ohne Regie nur den Zusatzauftrag). */
function vorladen(regie: boolean) {
  const los = () => {
    void NACHLADEN.zusatzauftrag().catch(() => undefined);
    if (!regie) return;
    for (const [k, f] of Object.entries(NACHLADEN)) if (k !== 'zusatzauftrag') void f().catch(() => undefined);
  };
  if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(los);
  else setTimeout(los, 1500);
}

/** Solange eine Seite zum ersten Mal lädt: ruhiger Grund statt einer weissen Fläche. */
function SeiteLaedt() {
  return <div className="min-h-dvh bg-ground" aria-busy="true" />;
}
import { Shell } from './ui/Shell';
import { ansichten, ANSICHT_LABEL, ansichtSetzen } from './lib/ansicht';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { startAutoFlush, flushNachSupabase } from './lib/db';
import { supabase } from './lib/supabase';
import { seitenFuer, useAnsicht, type Ansicht as AnsichtKey } from './lib/ansicht';
import { einstellungen, einstellungenLaden } from './lib/einstellungen';
import { abmelden, angemeldet, personLaden, zugangOhneFirma } from './lib/konto';

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
  // Sitzung weg (abgemeldet, Konto gelöscht, Zugang abgelaufen): zur Anmeldung, statt mit einer Oberfläche weiterzumachen,
  // in der jedes Speichern scheitert (10.10.2026). Was in der Warteschlange liegt, bleibt auf dem Gerät.
  let hatteSitzung = false;
  client.auth.onAuthStateChange((ereignis, sitzung) => {
    if (sitzung) hatteSitzung = true;
    if (ereignis === 'SIGNED_OUT' && hatteSitzung) { hatteSitzung = false; location.replace('/'); }
  });
}

// Neue Version holen, auch wenn der Tab den ganzen Tag offen bleibt (Bauführer-PC):
// stündlich nachschauen; autoUpdate lädt die Seite neu, sobald die neue Version aktiv ist.
// Handy: die installierte App läuft oft tagelang aus dem Hintergrund weiter, der Stunden-Takt ruht dort —
// darum auch beim Zurückholen in den Vordergrund nachschauen (09.10.2026: Amir sah noch die alte Erfassung).
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    setInterval(() => void reg.update(), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void reg.update();
    });
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

function OhneFirma() {
  const [email, setEmail] = useState('');
  useEffect(() => { void supabase?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? '')); }, []);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <div className="card space-y-3">
        <p className="font-display text-lg font-bold">Dieser Zugang gehört zu keiner Firma</p>
        <p className="text-sm text-ink2">Angemeldet als <span className="font-mono">{email || '…'}</span>. Die Datenbank kennt dazu keine Firma, darum gibt es nichts zu sehen und nichts zu speichern.</p>
        <p className="text-sm text-ink3">Mit einem anderen Zugang anmelden, oder den Zugang in Supabase einer Firma zuordnen (Tabelle «benutzer»).</p>
        <button type="button" className="btn-ghost" onClick={() => void abmelden().then(() => location.replace('/'))}>Abmelden</button>
      </div>
    </main>
  );
}

function App() {
  const ansicht = useAnsicht();
  const [bereit, setBereit] = useState(!supabase);
  // Ohne Sitzung liefert die Datenbank leere Listen — dann lieber den Grund zeigen als «Keine Teams».
  const [sitzung, setSitzung] = useState(!supabase);
  /** Angemeldet, aber die Datenbank kennt keine Firma dazu (10.10.2026: «Team weg», «row-level security»). */
  const [ohneFirma, setOhneFirma] = useState(false);

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
      // Persönlicher Zugang (0033): Ansicht und Person stehen fest, niemand muss wählen.
      if (ok) await personLaden().catch(() => undefined);
      if (ok) setOhneFirma(await zugangOhneFirma().catch(() => false));
      setBereit(true);
      if (ok) vorladen(einstellungen().erfassung === 'regie');
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

  // Angemeldet, aber ohne Firma: sonst wären alle Listen leer und jedes Speichern meldete «row-level security».
  if (sitzung && ohneFirma && !window.location.pathname.startsWith('/b/')) return <OhneFirma />;

  const hat = (seite: string) => sitzung && !!ansicht && seitenFuer(ansicht).includes(seite);
  const regieModus = einstellungen().erfassung === 'regie';

  return (
    <BrowserRouter>
      {/* Ein Rahmen für alle Seiten: Beim Seitenwechsel bleibt die alte Seite stehen, bis die neue da ist */}
      <Suspense fallback={<SeiteLaedt />}>
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
        {regieModus && <Route path="/b/:token" element={<Bestaetigung />} />}
        {hat('zusatzauftrag') && <Route path="/zusatzauftrag" element={<Zusatzauftrag />} />}
        {hat('regie') && <Route path="/regie" element={<RegieListe />} />}
        {hat('regie') && <Route path="/regie/neu" element={<RegieVorschau />} />}
        {hat('regie') && <Route path="/regie/:id" element={<RegieDetail />} />}
        {hat('auswertung') && <Route path="/auswertung" element={<Auswertung />} />}
        {hat('planung') && <Route path="/planung" element={<Planung />} />}
        {/* Das Board ist seit 06.10.2026 die Planung — alte Lesezeichen leiten weiter */}
        {hat('planung') && <Route path="/board" element={<Navigate to="/planung" replace />} />}
        {sitzung && ansicht && <Route path="*" element={<FremdeSeite ansicht={ansicht} />} />}
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
