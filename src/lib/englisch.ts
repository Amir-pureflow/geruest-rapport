/**
 * Englische Oberfläche — nur für die Demo-Firma (14.10.2026, Amir: Launch-Video auf Englisch, «App zuerst übersetzen»).
 *
 * Kein Umbau aller Seiten: Ein Übersetzer ersetzt sichtbare deutsche Texte im DOM durch Englisch (Wörterbuch
 * `englisch_woerter.ts` + Muster für Texte mit Zahlen), sobald die Demo-Firma unter Verwaltung → Einstellungen «English»
 * gewählt hat. Echte Firmen sehen nie etwas davon: übersetzt wird nur, wenn `istDemoFirma()` gilt — auch wenn der
 * Schalter auf einem geteilten Gerät noch gesetzt ist. Eingaben (input, textarea) und deren Werte bleiben unberührt,
 * ebenso aria-label (nicht sichtbar; Aufnahme-Skripte und Tests suchen Knöpfe daran).
 */
import { istDemoFirma } from './demo';
import { MUSTER, WOERTER } from './englisch_woerter';

const SCHLUESSEL = 'oberflaeche-sprache';

export function englischGewaehlt(): boolean {
  try { return localStorage.getItem(SCHLUESSEL) === 'en'; } catch { return false; }
}

/** Schalter in den Einstellungen der Demo-Firma. Lädt neu — halb übersetzte Seiten wären verwirrend. */
export function englischSetzen(an: boolean) {
  try { if (an) localStorage.setItem(SCHLUESSEL, 'en'); else localStorage.removeItem(SCHLUESSEL); } catch { /* privat */ }
  setTimeout(() => location.reload(), 300);
}

const aktiv = () => englischGewaehlt() && istDemoFirma();

/** Deutschen Text übersetzen; null = nichts gefunden (bleibt, wie er ist). Leerraum vorn und hinten bleibt erhalten. */
export function uebersetzen(text: string): string | null {
  const kern = text.replace(/­/g, '').replace(/\s+/g, ' ').trim();
  if (!kern) return null;
  let neu = WOERTER.get(kern) ?? null;
  if (neu === null) {
    for (const [muster, ersatz] of MUSTER) {
      if (muster.test(kern)) { neu = kern.replace(muster, ersatz as never); break; }
    }
  }
  if (neu === null || neu === kern) return null;
  const vorn = /^\s/.test(text) ? ' ' : '', hinten = /\s$/.test(text) ? ' ' : '';
  return vorn + neu + hinten;
}

const NICHT = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

function textKnoten(n: Text) {
  const p = n.parentElement;
  if (!p || NICHT.has(p.tagName) || p.closest('[data-kein-englisch]')) return;
  // Der Markenname bleibt: «Rapport» + rotes «o» stehen in zwei Knoten
  if ((p.textContent ?? '').replace(/\s/g, '') === 'Rapporto' || (p.parentElement?.textContent ?? '').replace(/\s/g, '') === 'Rapporto') return;
  const neu = uebersetzen(n.nodeValue ?? '');
  if (neu !== null) n.nodeValue = neu;
}

function element(el: Element) {
  if (NICHT.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  for (const a of ['placeholder', 'title']) {
    const v = el.getAttribute(a);
    if (v) { const neu = uebersetzen(v); if (neu !== null) el.setAttribute(a, neu.trim()); }
  }
  // Textfelder nur, wenn der ganze Inhalt im Wörterbuch steht (z. B. die übersetzte Sprachnotiz der Demo) — nur die Anzeige
  if ((el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')) && el.value) {
    const neu = WOERTER.get(el.value.trim());
    if (neu) el.value = neu;
  }
}

function durchgehen(wurzel: Node) {
  if (wurzel.nodeType === Node.TEXT_NODE) { textKnoten(wurzel as Text); return; }
  if (!(wurzel instanceof Element)) return;
  element(wurzel);
  const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = w.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) textKnoten(n as Text);
    else element(n as Element);
  }
}

let beobachter: MutationObserver | null = null;

/** Nach dem Start und nach dem Laden der Firma aufrufen: übersetzt alles Sichtbare und alles, was danach kommt. */
export function englischAnwenden() {
  if (!aktiv()) return;
  document.documentElement.lang = 'en';
  durchgehen(document.body);
  if (beobachter) return;
  beobachter = new MutationObserver((liste) => {
    if (!aktiv()) return;
    for (const m of liste) {
      if (m.type === 'characterData') textKnoten(m.target as Text);
      else if (m.type === 'attributes') element(m.target as Element);
      else m.addedNodes.forEach(durchgehen);
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
}

// Für die Video-Aufnahmen (werkzeuge/app_aufnehmen.mjs, OBERFLAECHE=en): erst auf Deutsch klicken, dann umschalten.
// Wirkt nur, wenn die Demo-Firma angemeldet und der Schalter gesetzt ist (siehe aktiv()).
if (typeof window !== 'undefined') (window as unknown as { __rapportoEnglisch?: () => void }).__rapportoEnglisch = englischAnwenden;
