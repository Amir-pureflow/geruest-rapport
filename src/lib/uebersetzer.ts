/**
 * Übersetzer für die sichtbare Oberfläche — ersetzt deutsche Texte im DOM über ein Wörterbuch (feste Texte) und Muster
 * (Texte mit Zahlen, Namen, Daten). Gebaut nach dem Vorbild von englisch.ts, aber umkehrbar: jeder ersetzte Text merkt
 * sich sein Original, «aus» stellt alles wieder her, ohne die Seite neu zu laden (eine halb ausgefüllte Tagesmeldung
 * darf beim Sprachwechsel nicht verloren gehen).
 *
 * Nie übersetzt: Eingaben (input, textarea), aria-label (Tests und Vorlesen suchen Knöpfe daran) und alles in einem
 * Element mit `data-bleibt-deutsch` — Baustelle, Adresse, Treffpunkt, Hinweis des Büros (Erin 19.11.2026: «die Adresse
 * bleibt einfach so, und der Treffpunkt auch»).
 */

export type Muster = [RegExp, string | ((...m: string[]) => string)];

export type Woerterbuch = { woerter: Map<string, string>; muster: Muster[] };

/** Deutschen Text übersetzen; null = nichts gefunden (bleibt, wie er ist). Leerraum vorn und hinten bleibt erhalten. */
export function textUebersetzen(text: string, wb: Woerterbuch): string | null {
  const kern = text.replace(/­/g, '').replace(/\s+/g, ' ').trim();
  if (!kern) return null;
  let neu = wb.woerter.get(kern) ?? null;
  if (neu === null) {
    for (const [muster, ersatz] of wb.muster) {
      if (muster.test(kern)) { neu = kern.replace(muster, ersatz as never); break; }
    }
  }
  if (neu === null || neu === kern) return null;
  const vorn = /^\s/.test(text) ? ' ' : '', hinten = /\s$/.test(text) ? ' ' : '';
  return vorn + neu + hinten;
}

const NICHT = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
const ATTRIBUTE = ['placeholder', 'title'] as const;

export function uebersetzerBauen(wb: Woerterbuch, sprache: string) {
  /** Original je Textknoten — für «aus» und damit ein schon übersetzter Text nicht nochmals durchläuft. */
  const original = new WeakMap<Text, string>();
  const zuletzt = new WeakMap<Text, string>();
  const attrOriginal = new WeakMap<Element, Record<string, string>>();
  /** Alle angefassten Knoten, damit «aus» sie wiederfindet (WeakMap ist nicht aufzählbar). */
  const angefasst = new Set<WeakRef<Text>>();
  const angefassteElemente = new Set<WeakRef<Element>>();
  let an = false;
  let beobachter: MutationObserver | null = null;

  function textKnoten(n: Text) {
    const p = n.parentElement;
    if (!p || NICHT.has(p.tagName) || p.closest('[data-bleibt-deutsch]')) return;
    const jetzt = n.nodeValue ?? '';
    // Unsere eigene Änderung kommt als Mutation zurück — nicht nochmals anfassen
    if (zuletzt.get(n) === jetzt) return;
    const neu = textUebersetzen(jetzt, wb);
    if (neu === null) { original.delete(n); zuletzt.delete(n); return; }
    original.set(n, jetzt);
    zuletzt.set(n, neu);
    angefasst.add(new WeakRef(n));
    n.nodeValue = neu;
  }

  function element(el: Element) {
    if (el.closest('[data-bleibt-deutsch]')) return;
    for (const a of ATTRIBUTE) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const neu = textUebersetzen(v, wb);
      if (neu === null) continue;
      const alt = attrOriginal.get(el) ?? {};
      alt[a] = v;
      attrOriginal.set(el, alt);
      angefassteElemente.add(new WeakRef(el));
      el.setAttribute(a, neu.trim());
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

  function einschalten() {
    if (typeof document === 'undefined') return;
    an = true;
    document.documentElement.lang = sprache;
    durchgehen(document.body);
    if (beobachter) return;
    beobachter = new MutationObserver((liste) => {
      if (!an) return;
      for (const m of liste) {
        if (m.type === 'characterData') textKnoten(m.target as Text);
        else if (m.type === 'attributes') element(m.target as Element);
        else m.addedNodes.forEach(durchgehen);
      }
    });
    beobachter.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTE] });
  }

  /** Alles zurück auf Deutsch — ohne Neuladen. */
  function ausschalten() {
    if (typeof document === 'undefined') return;
    an = false;
    beobachter?.disconnect();
    beobachter = null;
    for (const ref of angefasst) {
      const n = ref.deref();
      if (n && original.has(n) && n.nodeValue === zuletzt.get(n)) n.nodeValue = original.get(n)!;
    }
    for (const ref of angefassteElemente) {
      const el = ref.deref();
      const alt = el && attrOriginal.get(el);
      if (el && alt) for (const [a, v] of Object.entries(alt)) el.setAttribute(a, v);
    }
    angefasst.clear();
    angefassteElemente.clear();
    document.documentElement.lang = 'de';
  }

  return { einschalten, ausschalten, aktiv: () => an, uebersetzen: (t: string) => textUebersetzen(t, wb) };
}
