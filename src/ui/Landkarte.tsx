/**
 * Landkarte mit MapLibre (BSD-3) und den Vektorkarten von swisstopo (frei, kein Schlüssel, «© swisstopo» sichtbar):
 * «Karte» = Basiskarte hell (ruhig, modern — 25.10.2026 von Amir im Vergleich gewählt, statt der grauen Landeskarte),
 * «Luftbild» = Luftbild mit Strassen und Namen. Nur auf der Tageskarte im Büro geladen (Seite wird nachgeladen).
 * Keine Google-Konten, kein Schlüssel, keine Standortabfrage. Braucht WebGL — ohne steht ein Hinweis da.
 */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Den Worker (zerlegt die Vektorkacheln) ausdrücklich mitgeben: MapLibre sucht ihn neben der eigenen Datei, Vite packt die
// Bibliothek aber um — ohne das blieb die Basiskarte leer («Worker failed to load», 25.10.2026), nur das Luftbild kam
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
import type { KartenPunkt } from '../lib/karte';

const STIL = (name: string) => `https://vectortiles.geo.admin.ch/styles/${name}/style.json`;
const KARTE = STIL('ch.swisstopo.lightbasemap.vt');
const LUFTBILD = STIL('ch.swisstopo.imagerybasemap.vt');

/** Bern, falls noch nichts zu zeigen ist */
const START: [number, number] = [7.447, 46.948];

const schutz = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Punkt einer Baustelle: Hülle ohne Grösse genau auf dem Ort (MapLibre verschiebt sie), darin die Fahne wie bisher
 * (`.rp-pin` in index.css, Spitze auf dem Ort).
 */
function pinElement(p: KartenPunkt, an: boolean, wahl: () => void): HTMLElement {
  const h = document.createElement('div');
  h.className = 'rp-icon';
  const teams = p.teams.map((t) => t.team).join(' · ');
  h.innerHTML = `<div class="rp-pin${an ? ' rp-pin-an' : ''}" title="${schutz(p.baustelle.bezeichnung ?? '')}"><span class="rp-pin-team">${schutz(teams)}</span><span class="rp-pin-leute">${p.leute}</span></div>`;
  h.addEventListener('click', (e) => { e.stopPropagation(); wahl(); });
  return h;
}

function werkhofElement(): HTMLElement {
  const h = document.createElement('div');
  h.className = 'rp-icon';
  // Haus-Symbol (wie lucide «house»), damit der Werkhof sofort vom Baustellen-Punkt zu unterscheiden ist
  h.innerHTML = '<div class="rp-werkhof" title="Werkhof"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>';
  return h;
}

export function Landkarte({ punkte, werkhof, auswahl, onAuswahl, luftbild }: {
  punkte: KartenPunkt[];
  werkhof: { lat: number; lon: number; adresse: string | null } | null;
  auswahl: string | null;
  onAuswahl: (baustelleId: string) => void;
  luftbild: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const marken = useRef<maplibregl.Marker[]>([]);
  const wahl = useRef(onAuswahl);
  useEffect(() => { wahl.current = onAuswahl; });
  const [ohneWebgl, setOhneWebgl] = useState(false);

  // Einmal anlegen, beim Verlassen der Seite wieder abbauen
  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: box.current, style: KARTE, center: START, zoom: 12,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
    } catch {
      setOhneWebgl(true); // alter Rechner oder Grafik aus: lieber ein Satz als eine weisse Fläche
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    karte.current = m;
    // Die Karte sitzt in einem Raster, das sich nach dem ersten Zeichnen noch setzt — Grösse nachmessen
    const r = new ResizeObserver(() => m.resize());
    r.observe(box.current);
    return () => { r.disconnect(); m.remove(); karte.current = null; };
  }, []);

  // Karte ↔ Luftbild: nur der Stil wechselt, die Punkte (eigene Elemente) bleiben
  const ersterStil = useRef(true);
  useEffect(() => {
    if (ersterStil.current) { ersterStil.current = false; return; }
    karte.current?.setStyle(luftbild ? LUFTBILD : KARTE);
  }, [luftbild]);

  // Punkte zeichnen; bei neuen Punkten (anderer Tag, andere Suche) den Ausschnitt anpassen
  const schluessel = punkte.map((p) => p.baustelle.id).join(',') + '|' + (werkhof ? `${werkhof.lat},${werkhof.lon}` : '');
  const letzterSchluessel = useRef('');
  useEffect(() => {
    const m = karte.current;
    if (!m) return;
    for (const x of marken.current) x.remove();
    marken.current = [];
    const grenzen = new maplibregl.LngLatBounds();
    let anzahl = 0;
    if (werkhof) {
      marken.current.push(new maplibregl.Marker({ element: werkhofElement() }).setLngLat([werkhof.lon, werkhof.lat]).addTo(m));
      grenzen.extend([werkhof.lon, werkhof.lat]);
      anzahl++;
    }
    for (const p of punkte) {
      const an = p.baustelle.id === auswahl;
      const el = pinElement(p, an, () => wahl.current(p.baustelle.id));
      // Gewählte Baustelle über den anderen
      if (an) el.style.zIndex = '2';
      marken.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.baustelle.lon!, p.baustelle.lat!]).addTo(m));
      grenzen.extend([p.baustelle.lon!, p.baustelle.lat!]);
      anzahl++;
    }
    if (schluessel !== letzterSchluessel.current) {
      letzterSchluessel.current = schluessel;
      if (anzahl === 1) m.jumpTo({ center: grenzen.getCenter(), zoom: 15 });
      else if (anzahl > 1) m.fitBounds(grenzen, { padding: 70, maxZoom: 15, duration: 0 });
    }
  }, [punkte, werkhof, auswahl, schluessel]);

  // Gewählte Baustelle in die Mitte holen
  useEffect(() => {
    const m = karte.current;
    const p = punkte.find((x) => x.baustelle.id === auswahl);
    if (!m || !p) return;
    m.flyTo({ center: [p.baustelle.lon!, p.baustelle.lat!], zoom: Math.max(m.getZoom(), 15), duration: 600 });
  }, [auswahl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ohneWebgl) {
    return <p className="p-6 text-sm text-ink3">Die Karte braucht WebGL — auf diesem Gerät ausgeschaltet. Die Liste links zeigt alle Einsätze.</p>;
  }
  return <div ref={box} className="h-full w-full" role="region" aria-label="Karte der Baustellen" />;
}
