/**
 * Gemeinsam für alle Karten (Tageskarte, Ort der Baustelle): MapLibre mit den Vektorkarten von swisstopo — «Karte» =
 * Basiskarte hell, «Luftbild» = Luftbild mit Strassen und Namen (25.10.2026 von Amir im Vergleich gewählt). Frei, ohne
 * Schlüssel, «© swisstopo» sichtbar. Nur aus nachgeladenen Seiten importieren — die Bibliothek ist gross.
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Den Worker (zerlegt die Vektorkacheln) ausdrücklich mitgeben: MapLibre sucht ihn neben der eigenen Datei, Vite packt die
// Bibliothek aber um — ohne das blieb die Basiskarte leer («Worker failed to load», 25.10.2026), nur das Luftbild kam
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
// Mehrere Worker: MapLibre nimmt in Chrome nur einen, der zerlegt alle Kacheln nacheinander (Basiskarte + Relief, ~2 MB) —
// das war der grösste Teil der Ladezeit (30.10.2026). Halb so viele wie Kerne, höchstens 4.
maplibregl.setWorkerCount(Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))));

export { maplibregl };

const STIL = (name: string) => `https://vectortiles.geo.admin.ch/styles/${name}/style.json`;
export const STIL_KARTE = STIL('ch.swisstopo.lightbasemap.vt');
export const STIL_LUFTBILD = STIL('ch.swisstopo.imagerybasemap.vt');

/** Bern, falls noch nichts zu zeigen ist */
export const START: [number, number] = [7.447, 46.948];

let gewaermt = false;
/**
 * Büro, noch auf der Übersicht: Worker schon starten und den Kartenstil holen (die Verbindung zu swisstopo steht dann),
 * damit die Tageskarte beim Öffnen sofort zeichnet (30.10.2026, Amir: «warum braucht die Karte so lang»)
 */
export function vorwaermen() {
  if (gewaermt) return;
  gewaermt = true;
  maplibregl.prewarm();
  void fetch(STIL_KARTE).catch(() => undefined);
}
