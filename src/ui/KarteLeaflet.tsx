/**
 * Landkarte mit Leaflet (BSD-2) und den Kacheln von swisstopo (Landeskarte, Luftbild — frei unter Fair Use, «© swisstopo»
 * sichtbar). Nur auf der Tageskarte im Büro geladen (Seite wird nachgeladen). Keine Google-Konten, kein Schlüssel,
 * keine Standortabfrage.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { KartenPunkt } from '../lib/karte';

const ZUORDNUNG = '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a>';
// detectRetina: auf hochauflösenden Bildschirmen die nächstfeineren Kacheln — sonst wird die Landeskarte hochgerechnet,
// unscharf und mit riesiger Schrift (24.10.2026 im Bild gesehen)
const kachel = (ebene: string, maxNativeZoom: number, opacity = 1) =>
  L.tileLayer(`https://wmts.geo.admin.ch/1.0.0/${ebene}/default/current/3857/{z}/{x}/{y}.jpeg`, { maxZoom: 19, maxNativeZoom, detectRetina: true, opacity, attribution: ZUORDNUNG });

/** Bern, falls noch nichts zu zeigen ist */
const START: L.LatLngExpression = [46.948, 7.447];

const schutz = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function pinIcon(p: KartenPunkt, an: boolean): L.DivIcon {
  const teams = p.teams.map((t) => t.team).join(' · ');
  return L.divIcon({
    className: 'rp-icon',
    iconSize: [0, 0],
    html: `<div class="rp-pin${an ? ' rp-pin-an' : ''}" title="${schutz(p.baustelle.bezeichnung ?? '')}"><span class="rp-pin-team">${schutz(teams)}</span><span class="rp-pin-leute">${p.leute}</span></div>`,
  });
}

const WERKHOF_ICON = L.divIcon({
  className: 'rp-icon',
  iconSize: [0, 0],
  // Haus-Symbol (wie lucide «house»), damit der Werkhof sofort vom Baustellen-Punkt zu unterscheiden ist
  html: '<div class="rp-werkhof" title="Werkhof"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>',
});

export function KarteLeaflet({ punkte, werkhof, auswahl, onAuswahl, luftbild }: {
  punkte: KartenPunkt[];
  werkhof: { lat: number; lon: number; adresse: string | null } | null;
  auswahl: string | null;
  onAuswahl: (baustelleId: string) => void;
  luftbild: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const karte = useRef<L.Map | null>(null);
  const ebenen = useRef<{ karte: L.TileLayer; luft: L.TileLayer } | null>(null);
  const marken = useRef<L.LayerGroup | null>(null);
  const wahl = useRef(onAuswahl);
  useEffect(() => { wahl.current = onAuswahl; });

  // Einmal anlegen, beim Verlassen der Seite wieder abbauen
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { center: START, zoom: 12, zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    // Graue Landeskarte, aufgehellt (45 % auf hellem Grund): ruhiger Hintergrund, die Punkte der Einsätze stechen heraus —
    // die farbige hat rote Strassen, die volle graue ist schwarz und unruhig (beides 24.10.2026 im Bild verglichen)
    const e = { karte: kachel('ch.swisstopo.pixelkarte-grau', 18, 0.45), luft: kachel('ch.swisstopo.swissimage', 19) };
    e.karte.addTo(m);
    ebenen.current = e;
    marken.current = L.layerGroup().addTo(m);
    karte.current = m;
    // Die Karte sitzt in einem Raster, das sich nach dem ersten Zeichnen noch setzt — Grösse nachmessen
    const r = new ResizeObserver(() => m.invalidateSize());
    r.observe(box.current);
    return () => { r.disconnect(); m.remove(); karte.current = null; };
  }, []);

  useEffect(() => {
    const m = karte.current, e = ebenen.current;
    if (!m || !e) return;
    const weg = luftbild ? e.karte : e.luft, dazu = luftbild ? e.luft : e.karte;
    if (m.hasLayer(weg)) m.removeLayer(weg);
    if (!m.hasLayer(dazu)) dazu.addTo(m);
  }, [luftbild]);

  // Punkte zeichnen; bei neuen Punkten (anderer Tag, andere Suche) den Ausschnitt anpassen
  const schluessel = punkte.map((p) => p.baustelle.id).join(',') + '|' + (werkhof ? `${werkhof.lat},${werkhof.lon}` : '');
  const letzterSchluessel = useRef('');
  useEffect(() => {
    const m = karte.current, g = marken.current;
    if (!m || !g) return;
    g.clearLayers();
    const grenzen: L.LatLngExpression[] = [];
    if (werkhof) {
      L.marker([werkhof.lat, werkhof.lon], { icon: WERKHOF_ICON, keyboard: false, title: 'Werkhof' }).addTo(g);
      grenzen.push([werkhof.lat, werkhof.lon]);
    }
    for (const p of punkte) {
      const an = p.baustelle.id === auswahl;
      const ll: L.LatLngExpression = [p.baustelle.lat!, p.baustelle.lon!];
      L.marker(ll, { icon: pinIcon(p, an), zIndexOffset: an ? 1000 : 0, title: p.baustelle.bezeichnung ?? '' })
        .on('click', () => wahl.current(p.baustelle.id))
        .addTo(g);
      grenzen.push(ll);
    }
    if (schluessel !== letzterSchluessel.current) {
      letzterSchluessel.current = schluessel;
      if (grenzen.length === 1) m.setView(grenzen[0], 15);
      else if (grenzen.length > 1) m.fitBounds(L.latLngBounds(grenzen), { padding: [60, 60], maxZoom: 15 });
    }
  }, [punkte, werkhof, auswahl, schluessel]);

  // Gewählte Baustelle in die Mitte holen
  useEffect(() => {
    const m = karte.current;
    const p = punkte.find((x) => x.baustelle.id === auswahl);
    if (!m || !p) return;
    m.flyTo([p.baustelle.lat!, p.baustelle.lon!], Math.max(m.getZoom(), 15), { duration: 0.6 });
  }, [auswahl]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="h-full w-full" role="region" aria-label="Karte der Baustellen" />;
}
