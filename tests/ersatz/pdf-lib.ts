/**
 * Ersatz für `npm:pdf-lib` in Tests: zeichnet nichts, merkt sich aber jeden Text, der aufs PDF käme (mit Position).
 * So lässt sich der ECHTE PDF-Baustein der App (`pdfBauen` in supabase/functions/_shared/rapport_pdf.ts) prüfen:
 * welcher Betrag steht in der Summenzeile, welche Menge und welcher Ansatz in jeder Zeile.
 */
export interface Gezeichnet { text: string; x: number; y: number; seite: number }
export const protokoll: Gezeichnet[] = [];

export const StandardFonts = { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold' } as const;
export const rgb = (r: number, g: number, b: number) => ({ r, g, b });
export type PDFFont = { widthOfTextAtSize(s: string, g: number): number; heightAtSize(g: number): number };
export type PDFImage = { width: number; height: number };

const schrift: PDFFont = { widthOfTextAtSize: (s, g) => s.length * g * 0.5, heightAtSize: (g) => g };

class Seite {
  constructor(private nr: number) {}
  drawText(text: string, o: { x: number; y: number }) { protokoll.push({ text, x: o.x, y: o.y, seite: this.nr }); }
  drawLine() {}
  drawRectangle() {}
  drawImage() {}
  getSize() { return { width: 595.28, height: 841.89 }; }
}

export class PDFDocument {
  private seiten: Seite[] = [];
  static async create() { protokoll.length = 0; return new PDFDocument(); }
  setTitle() {}
  setAuthor() {}
  addPage() { const s = new Seite(this.seiten.length + 1); this.seiten.push(s); return s; }
  getPages() { return this.seiten; }
  async embedFont() { return schrift; }
  async embedJpg() { return { width: 100, height: 100 }; }
  async embedPng() { return { width: 100, height: 100 }; }
  async save() { return new Uint8Array([37, 80, 68, 70]); }
}

/** Alle Texte einer Zeile (gleiche Höhe) von links nach rechts — so liest man eine Tabellenzeile. */
export function zeileMit(anfang: string): string[] {
  const z = protokoll.find((p) => p.text === anfang);
  if (!z) return [];
  return protokoll.filter((p) => p.seite === z.seite && Math.abs(p.y - z.y) < 0.5).sort((a, b) => a.x - b.x).map((p) => p.text);
}
