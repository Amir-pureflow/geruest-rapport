/**
 * Fotos vom Teamgerät: vor dem Ablegen verkleinern, damit der Upload auf der Baustelle
 * (schlechtes Netz) klein bleibt. 1600 px lange Kante, JPEG — für den Beleg reicht das.
 */
const MAX_KANTE = 1600;
const QUALITAET = 0.82;

export async function fotoVerkleinern(datei: Blob): Promise<Blob> {
  const bild = await ladeBild(datei);
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
  const w = Math.round(bild.width * faktor);
  const h = Math.round(bild.height * faktor);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return datei;
  ctx.drawImage(bild, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? datei), 'image/jpeg', QUALITAET);
  });
}

function ladeBild(datei: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
