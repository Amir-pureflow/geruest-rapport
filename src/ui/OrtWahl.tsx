/**
 * Ort der Baustelle auf der Karte (25.10.2026, Schritt 7): Die Adresssuche trifft die Adresse — bei einem grossen Areal,
 * einem Neubau ohne Hausnummer oder einer Zufahrt auf der Rückseite aber nicht das Tor. Hier zieht das Büro den Punkt
 * dorthin, wo das Team hinmuss, oder tippt auf die Karte (auch ganz ohne Adresse). Erst «Punkt speichern» speichert —
 * als «von Hand gesetzt»; «Navigieren» und die Tageskarte nehmen dann genau diesen Punkt.
 * Nur in der Verwaltung (nachgeladen). Braucht WebGL — ohne steht ein Hinweis da.
 */
import { useEffect, useRef, useState } from 'react';
import { maplibregl, START, STIL_KARTE, STIL_LUFTBILD } from './kartenstil';

type Ort = { lat: number; lon: number };

/** Klassische Nadel: Spitze genau auf dem Ort (anchor bottom) */
function nadel(): HTMLElement {
  const h = document.createElement('div');
  h.className = 'rp-nadel';
  h.title = 'Ziehen, um den Punkt zu verschieben';
  h.innerHTML = '<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true"><path d="M12 31c0 0 10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="#fff"/></svg>';
  return h;
}

export function OrtWahl({ lat, lon, naehe, vonHand, onSpeichern }: {
  lat: number | null;
  lon: number | null;
  /** Gebiet der Firma — dort beginnt die Karte, wenn die Baustelle noch keinen Punkt hat */
  naehe: Ort | null;
  vonHand: boolean;
  onSpeichern: (ort: Ort) => Promise<string | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const marke = useRef<maplibregl.Marker | null>(null);
  const [neu, setNeu] = useState<Ort | null>(null);
  const neuRef = useRef<Ort | null>(null);
  useEffect(() => { neuRef.current = neu; }, [neu]);
  const [luftbild, setLuftbild] = useState(false);
  const [bereit, setBereit] = useState(false);
  const [ohneWebgl, setOhneWebgl] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null);
  const gespeichert: Ort | null = lat != null && lon != null ? { lat, lon } : null;

  /** Nadel an diesen Ort (anlegen, falls es noch keine gibt) */
  function nadelAn(m: maplibregl.Map, o: Ort) {
    if (!marke.current) {
      marke.current = new maplibregl.Marker({ element: nadel(), anchor: 'bottom', draggable: true }).setLngLat([o.lon, o.lat]).addTo(m);
      marke.current.on('dragend', () => {
        const ll = marke.current!.getLngLat();
        setMeldung(null);
        setNeu({ lat: ll.lat, lon: ll.lng });
      });
    } else {
      marke.current.setLngLat([o.lon, o.lat]);
    }
  }

  // Einmal anlegen
  useEffect(() => {
    if (!box.current) return;
    const start = gespeichert ?? naehe;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: box.current, style: STIL_KARTE, center: start ? [start.lon, start.lat] : START, zoom: gespeichert ? 17 : 12,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
    } catch {
      setOhneWebgl(true);
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    karte.current = m;
    if (gespeichert) nadelAn(m, gespeichert);
    // Tippen auf die Karte setzt den Punkt dorthin (auch ohne Adresse)
    m.on('click', (e) => {
      setMeldung(null);
      const o = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      nadelAn(m, o);
      setNeu(o);
    });
    m.once('idle', () => setBereit(true));
    const frist = setTimeout(() => setBereit(true), 6000);
    const r = new ResizeObserver(() => m.resize());
    r.observe(box.current);
    return () => { clearTimeout(frist); r.disconnect(); marke.current = null; m.remove(); karte.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Neue Adresse gewählt (oder entfernt): Nadel nachziehen — ausser es wird gerade verschoben
  useEffect(() => {
    const m = karte.current;
    if (!m || neuRef.current) return;
    if (gespeichert) {
      nadelAn(m, gespeichert);
      m.jumpTo({ center: [gespeichert.lon, gespeichert.lat], zoom: Math.max(m.getZoom(), 17) });
    } else if (marke.current) {
      marke.current.remove();
      marke.current = null;
    }
  }, [lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const ersterStil = useRef(true);
  useEffect(() => {
    if (ersterStil.current) { ersterStil.current = false; return; }
    karte.current?.setStyle(luftbild ? STIL_LUFTBILD : STIL_KARTE);
  }, [luftbild]);

  async function speichern() {
    if (!neu) return;
    setLaeuft(true);
    const f = await onSpeichern(neu);
    setLaeuft(false);
    if (f) { setMeldung({ text: 'Nicht gespeichert: ' + f, ok: false }); return; }
    setNeu(null);
    setMeldung({ text: 'Punkt gespeichert ✓ — «Navigieren» führt jetzt genau hierhin.', ok: true });
  }

  function abbrechen() {
    setNeu(null);
    setMeldung(null);
    const m = karte.current;
    if (!m) return;
    if (gespeichert) nadelAn(m, gespeichert);
    else if (marke.current) { marke.current.remove(); marke.current = null; }
  }

  if (ohneWebgl) return <p className="rounded-[12px] border border-line bg-white px-3 py-2.5 text-xs text-ink3">Die Karte braucht WebGL — auf diesem Gerät ausgeschaltet.</p>;

  return (
    <div className="space-y-2">
      <div className="relative h-64 overflow-hidden rounded-[12px] border border-line bg-[#fcfcfc] sm:h-72">
        {!bereit && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink3" aria-live="polite">Karte lädt …</p>}
        <div ref={box} className={'h-full w-full cursor-crosshair transition-opacity duration-300 ' + (bereit ? 'opacity-100' : 'opacity-0')} role="region" aria-label="Ort der Baustelle auf der Karte" />
        {!gespeichert && !neu && bereit && (
          <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-ink2 shadow-[0_2px_8px_-2px_rgb(17_17_19/0.25)]">Auf die Karte tippen, um den Punkt zu setzen</p>
        )}
        <div className="absolute right-2.5 top-2.5 flex rounded-full border border-ink/10 bg-white p-0.5 shadow-[0_2px_8px_-2px_rgb(17_17_19/0.25)]" role="group" aria-label="Kartenart">
          {([false, true] as const).map((lb) => (
            <button key={String(lb)} type="button" aria-pressed={luftbild === lb} onClick={() => setLuftbild(lb)}
              className={'rounded-full px-2.5 py-1 text-[11px] font-semibold transition ' + (luftbild === lb ? 'bg-ink text-white' : 'text-ink2 hover:text-ink')}>
              {lb ? 'Luftbild' : 'Karte'}
            </button>
          ))}
        </div>
      </div>
      {neu ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-amber-soft px-3 py-2" role="status">
          <span className="text-sm text-amber-deep">{gespeichert ? 'Punkt verschoben' : 'Punkt gesetzt'} — speichern?</span>
          <span className="flex shrink-0 gap-1.5">
            <button type="button" disabled={laeuft} onClick={() => void speichern()} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{laeuft ? 'Speichert …' : 'Punkt speichern'}</button>
            <button type="button" onClick={abbrechen} className="btn-ghost px-3 py-1.5 text-xs">Abbrechen</button>
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-ink3">
          {gespeichert
            ? `${vonHand ? 'Punkt von Hand gesetzt. ' : ''}Liegt die Zufahrt woanders: Punkt ziehen oder auf die Karte tippen.`
            : 'Ohne Adresse geht es auch: Punkt direkt auf die Karte setzen.'}
        </p>
      )}
      {meldung && <p className={'text-xs ' + (meldung.ok ? 'text-good-deep' : 'font-semibold text-accent-deep')} role="status">{meldung.text}</p>}
    </div>
  );
}
