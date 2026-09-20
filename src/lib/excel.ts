// Excel-Ausgabe fürs Sekretariat und die Temporärbüros (Amir, 20.09.2026: «schöner vom Design und Layout her»).
//
// ExcelJS statt SheetJS: die freie SheetJS-Ausgabe kann keine Schrift, Farbe, Rahmen oder Spaltenbreite
// schreiben — genau das, was eine Datei «attraktiv» macht, wenn sie beim Büro auf dem Schirm ist.
// Die Bibliothek ist gross (~1 MB) und wird darum erst beim Klick nachgeladen (dynamischer Import), nicht
// beim Start der App auf dem iPad des Chefmonteurs.
//
// Jedes Blatt hat denselben Aufbau: Titel, Untertitel (Zeitraum, Filter, Stand), dunkle Kopfzeile, Zebrastreifen,
// Summenzeile mit echten Excel-Formeln (das Büro sieht, dass die Summe stimmt, und kann sie nachrechnen),
// fixierte Kopfzeile, Autofilter, Querformat auf eine Seitenbreite, Kopfzeile auf jeder Druckseite.
// Stunden sind dezimal und EXAKT (min/60, Anzeige 0.00) — nicht wie in der App auf eine Stelle gerundet,
// 15 Minuten sind 0.25 und nicht 0.3. Leere Zellen bleiben leer (kein 0.00-Teppich).
import type * as Excel from 'exceljs';
import { ausIso } from './datum';
import { blattName, type BueroBlatt } from './lohn';

type Worksheet = Excel.Worksheet;
type Workbook = Excel.Workbook;

/** Farben der App (src/index.css), ARGB. */
const F = {
  tinte: 'FF17242A',
  tinte2: 'FF46565D',
  grau: 'FF6C7B81',
  linie: 'FFDFE5E4',
  zebra: 'FFF5F7F7',
  summe: 'FFE9EEEE',
  akzent: 'FFD82816',
  akzentSoft: 'FFFBEAE7',
  weiss: 'FFFFFFFF',
};
const SCHRIFT = 'Arial';
const STUNDEN = '0.00';
const KOPF = 4; // Zeile der Spaltenüberschriften; 1 Titel, 2 Untertitel, 3 Luft

export interface Spalte {
  titel: string;
  breite: number;
  /** text (links), h (Stunden, rechts, 0.00), zahl (rechts, ganz), datum (dd.mm.yyyy) */
  art?: 'text' | 'h' | 'zahl' | 'datum';
  /** Spalte hervorheben (Totalspalte) */
  fett?: boolean;
  /** Kopf senkrecht (Personen im Raster — sonst wird das Blatt meterbreit) */
  senkrecht?: boolean;
}

export interface Untertitel {
  zeitraum: string;
  /** z. B. «alle Teams», «nur Freigegebenes» */
  filter: string[];
}

export interface LohnExportZeile {
  name: string;
  typ: string;
  buero: string | null;
  /** Minuten je Spalte (Mo–So bzw. je KW) */
  werte: number[];
  total_min: number;
  ueber_min: number;
  oevTage: number;
  km: number;
}
export interface UeberExportZeile { name: string; typ: string; zeitraum_min: number; jahr_min: number }
export interface RasterExport {
  personen: { id: string; name: string }[];
  vorgaenge: { konto: string; bezeichnung: string; regie: boolean; min: Map<string, number> }[];
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function h(min: number): number {
  return Math.round((min / 60) * 10000) / 10000;
}
/** Spaltenbuchstabe: 1 → A, 27 → AA */
function buchstabe(n: number): string {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function anstellung(typ: string): string {
  return typ === 'temporaer' ? 'temporär' : typ;
}
function stand(): string {
  return `Stand ${new Date().toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

async function lade(): Promise<typeof Excel> {
  const m = await import('exceljs');
  return ((m as { default?: typeof Excel }).default ?? m) as typeof Excel;
}

const rand = (farbe = F.linie): Partial<Excel.Borders> => ({
  top: { style: 'thin', color: { argb: farbe } },
  bottom: { style: 'thin', color: { argb: farbe } },
  left: { style: 'thin', color: { argb: farbe } },
  right: { style: 'thin', color: { argb: farbe } },
});
const fuellung = (argb: string): Excel.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** Titel + Untertitel über die ganze Breite, dann die Kopfzeile mit Spaltenbreiten, fixiert. */
function kopf(ws: Worksheet, titel: string, unter: Untertitel, spalten: Spalte[], fixierteSpalten: number): void {
  const n = spalten.length;
  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = titel;
  t.font = { name: SCHRIFT, size: 16, bold: true, color: { argb: F.tinte } };
  t.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, n);
  const u = ws.getCell(2, 1);
  u.value = [unter.zeitraum, ...unter.filter, stand()].filter(Boolean).join('   ·   ');
  u.font = { name: SCHRIFT, size: 10, color: { argb: F.grau } };
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 8;

  const r = ws.getRow(KOPF);
  let senkrecht = false;
  spalten.forEach((s, i) => {
    const c = r.getCell(i + 1);
    c.value = s.titel;
    c.font = { name: SCHRIFT, size: 10, bold: true, color: { argb: F.weiss } };
    c.fill = fuellung(F.tinte);
    c.alignment = s.senkrecht
      ? { vertical: 'bottom', horizontal: 'center', textRotation: 90 }
      : { vertical: 'middle', horizontal: s.art && s.art !== 'text' && s.art !== 'datum' ? 'right' : 'left', wrapText: true };
    c.border = rand(F.tinte);
    ws.getColumn(i + 1).width = s.breite;
    if (s.senkrecht) senkrecht = true;
  });
  r.height = senkrecht ? 96 : 24;
  ws.views = [{ state: 'frozen', xSplit: fixierteSpalten, ySplit: KOPF }];
}

/** Eine Datenzeile. Leere Stunden bleiben leer. */
function zeile(ws: Worksheet, nr: number, werte: (string | number | Date | null | undefined)[], spalten: Spalte[], o: { zebra?: boolean; fett?: boolean; fill?: string; farbe?: string } = {}): void {
  const r = ws.getRow(nr);
  spalten.forEach((s, i) => {
    const c = r.getCell(i + 1);
    const v = werte[i];
    const leer = v == null || v === '' || ((s.art === 'h' || s.art === 'zahl') && v === 0);
    c.value = leer ? null : (v as Excel.CellValue);
    c.font = { name: SCHRIFT, size: 10, bold: !!o.fett || !!s.fett, color: { argb: o.farbe ?? F.tinte } };
    c.border = rand();
    if (o.fill) c.fill = fuellung(o.fill);
    else if (o.zebra) c.fill = fuellung(F.zebra);
    if (s.art === 'h') { c.numFmt = STUNDEN; c.alignment = { horizontal: 'right' }; }
    else if (s.art === 'zahl') { c.numFmt = '0'; c.alignment = { horizontal: 'right' }; }
    else if (s.art === 'datum') { c.numFmt = 'dd.mm.yyyy'; c.alignment = { horizontal: 'left' }; }
    else c.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  r.height = 17;
}

/** Summenzeile mit SUM-Formeln über die Datenzeilen von..bis (cached Ergebnis, damit Vorschauen ohne Neuberechnung stimmen). */
function summe(ws: Worksheet, nr: number, beschriftung: string, von: number, bis: number, spalten: Spalte[], ergebnisse: (number | null)[], fill = F.summe): void {
  const r = ws.getRow(nr);
  spalten.forEach((s, i) => {
    const c = r.getCell(i + 1);
    const summierbar = (s.art === 'h' || s.art === 'zahl') && ergebnisse[i] != null;
    if (i === 0) c.value = beschriftung;
    else if (summierbar && bis >= von) c.value = { formula: `SUM(${buchstabe(i + 1)}${von}:${buchstabe(i + 1)}${bis})`, result: ergebnisse[i] ?? 0 };
    else if (summierbar) c.value = ergebnisse[i];
    else c.value = null;
    c.font = { name: SCHRIFT, size: 10, bold: true, color: { argb: F.tinte } };
    c.fill = fuellung(fill);
    c.border = { ...rand(), top: { style: 'medium', color: { argb: F.tinte2 } } };
    if (s.art === 'h') { c.numFmt = STUNDEN; c.alignment = { horizontal: 'right' }; }
    else if (s.art === 'zahl') { c.numFmt = '0'; c.alignment = { horizontal: 'right' }; }
  });
  r.height = 19;
}

function fuss(ws: Worksheet, nr: number, text: string): void {
  const c = ws.getCell(nr, 1);
  c.value = text;
  c.font = { name: SCHRIFT, size: 8, italic: true, color: { argb: F.grau } };
}

/** Querformat, eine Seite breit, Kopfzeile auf jeder Seite, Fusszeile mit Seitenzahl. */
function druck(ws: Worksheet, titel: string): void {
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${KOPF}:${KOPF}`,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: `&L&8${titel}&C&8Rapporto&R&8Seite &P von &N` };
}

function neuesBlatt(wb: Workbook, name: string, vergeben: Set<string>, tab: string): Worksheet {
  const ws = wb.addWorksheet(blattName(name, vergeben), { properties: { tabColor: { argb: tab } } });
  return ws;
}

// ── Blätter ────────────────────────────────────────────────────────────────

function blattLohn(wb: Workbook, vergeben: Set<string>, unter: Untertitel, spaltenTitel: string[], monat: boolean, zeilen: LohnExportZeile[]): void {
  const ws = neuesBlatt(wb, 'Lohn', vergeben, F.tinte);
  const spalten: Spalte[] = [
    { titel: 'Name', breite: 26 },
    { titel: 'Anstellung', breite: 11 },
    { titel: 'Temporärbüro', breite: 18 },
    ...spaltenTitel.map((t) => ({ titel: t, breite: monat ? 9 : 8, art: 'h' as const })),
    { titel: monat ? 'Monat h' : 'Total h', breite: 10, art: 'h', fett: true },
    { titel: 'davon Über h', breite: 12, art: 'h' },
    { titel: 'öV-Tage', breite: 9, art: 'zahl' },
    { titel: 'km', breite: 8, art: 'zahl' },
  ];
  kopf(ws, `Lohnstunden`, unter, spalten, 1);
  const von = KOPF + 1;
  zeilen.forEach((l, i) => {
    zeile(ws, von + i, [l.name, anstellung(l.typ), l.buero ?? '', ...l.werte.map(h), h(l.total_min), h(l.ueber_min), l.oevTage, l.km], spalten, { zebra: i % 2 === 1 });
  });
  const bis = von + zeilen.length - 1;
  const spaltenSummen = spaltenTitel.map((_, k) => h(zeilen.reduce((s, l) => s + (l.werte[k] ?? 0), 0)));
  summe(ws, bis + 1, `Total (${zeilen.length} Personen)`, von, bis, spalten, [
    null, null, null, ...spaltenSummen,
    h(zeilen.reduce((s, l) => s + l.total_min, 0)),
    h(zeilen.reduce((s, l) => s + l.ueber_min, 0)),
    zeilen.reduce((s, l) => s + l.oevTage, 0),
    zeilen.reduce((s, l) => s + l.km, 0),
  ]);
  if (zeilen.length > 0) ws.autoFilter = { from: { row: KOPF, column: 1 }, to: { row: bis, column: spalten.length } };
  fuss(ws, bis + 3, 'Stunden dezimal: 0.25 = 15 Minuten. Normal- und Überstunden zusammen; Überstunden separat in «davon Über h» und auf dem Blatt «Überstunden».');
  druck(ws, `Lohnstunden ${unter.zeitraum}`);
}

function blattUeberstunden(wb: Workbook, vergeben: Set<string>, unter: Untertitel, monat: boolean, jahr: string, zeilen: UeberExportZeile[]): void {
  const ws = neuesBlatt(wb, 'Überstunden', vergeben, F.akzent);
  const spalten: Spalte[] = [
    { titel: 'Name', breite: 26 },
    { titel: 'Anstellung', breite: 11 },
    { titel: `Über h ${monat ? 'Monat' : 'Woche'}`, breite: 14, art: 'h' },
    { titel: `Über h seit 1.1.${jahr}`, breite: 18, art: 'h', fett: true },
  ];
  kopf(ws, 'Überstunden', unter, spalten, 1);
  const von = KOPF + 1;
  zeilen.forEach((u, i) => zeile(ws, von + i, [u.name, anstellung(u.typ), h(u.zeitraum_min), h(u.jahr_min)], spalten, { zebra: i % 2 === 1 }));
  const bis = von + zeilen.length - 1;
  summe(ws, bis + 1, 'Total', von, bis, spalten, [null, null, h(zeilen.reduce((s, u) => s + u.zeitraum_min, 0)), h(zeilen.reduce((s, u) => s + u.jahr_min, 0))]);
  if (zeilen.length > 0) ws.autoFilter = { from: { row: KOPF, column: 1 }, to: { row: bis, column: spalten.length } };
  fuss(ws, bis + 3, 'Seit Jahresbeginn: alle Überstunden der Person, unabhängig vom gewählten Team.');
  druck(ws, `Überstunden ${unter.zeitraum}`);
}

/**
 * Ein Blatt je Temporärbüro: Person × Tag × Konto, nach Person gruppiert mit Zwischensumme — so prüft das Büro
 * seine Rechnung Zeile für Zeile. Darunter die Summe je Person als Übersicht und das Total fürs Büro.
 */
function blattBuero(wb: Workbook, vergeben: Set<string>, unter: Untertitel, b: BueroBlatt): void {
  const ws = neuesBlatt(wb, b.buero, vergeben, F.grau);
  const spalten: Spalte[] = [
    { titel: 'Name', breite: 26 },
    { titel: 'Tag', breite: 5 },
    { titel: 'Datum', breite: 12, art: 'datum' },
    { titel: 'Konto-Nr.', breite: 12 },
    { titel: 'Normal h', breite: 10, art: 'h' },
    { titel: 'Über h', breite: 10, art: 'h' },
    { titel: 'Total h', breite: 10, art: 'h', fett: true },
  ];
  kopf(ws, `${b.buero} — Einsatzstunden`, unter, spalten, 1);

  let nr = KOPF + 1;
  let von = nr;
  let vorige = '';
  let zebra = false;
  const abschliessen = (name: string, bis: number) => {
    const p = b.personen.find((x) => x.name === name);
    summe(ws, bis + 1, `Summe ${name}`, von, bis, spalten, [null, null, null, null, h(p?.normal_min ?? 0), h(p?.ueber_min ?? 0), h(p?.total_min ?? 0)]);
  };
  for (const z of b.zeilen) {
    if (vorige && z.name !== vorige) { abschliessen(vorige, nr - 1); nr += 1; von = nr; zebra = false; }
    const d = ausIso(z.datum);
    zeile(ws, nr, [z.name, WOCHENTAG[d.getDay()], new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12), z.konto_nr, h(z.normal_min), h(z.ueber_min), h(z.normal_min + z.ueber_min)], spalten, { zebra });
    zebra = !zebra;
    vorige = z.name;
    nr += 1;
  }
  if (vorige) { abschliessen(vorige, nr - 1); nr += 1; }

  // Übersicht: Summe je Person, Total Büro
  nr += 1;
  const ueberschrift = ws.getCell(nr, 1);
  ueberschrift.value = 'Summe je Person';
  ueberschrift.font = { name: SCHRIFT, size: 11, bold: true, color: { argb: F.tinte } };
  nr += 1;
  const uebersicht: Spalte[] = [spalten[0], { titel: '', breite: 5 }, { titel: '', breite: 12 }, { titel: '', breite: 12 }, spalten[4], spalten[5], spalten[6]];
  const k = ws.getRow(nr);
  uebersicht.forEach((s, i) => {
    const c = k.getCell(i + 1);
    c.value = s.titel || null;
    c.font = { name: SCHRIFT, size: 10, bold: true, color: { argb: F.weiss } };
    c.fill = fuellung(F.tinte2);
    c.alignment = { horizontal: s.art === 'h' ? 'right' : 'left', vertical: 'middle' };
    c.border = rand(F.tinte2);
  });
  nr += 1;
  const pVon = nr;
  b.personen.forEach((p, i) => { zeile(ws, nr, [p.name, '', '', '', h(p.normal_min), h(p.ueber_min), h(p.total_min)], uebersicht, { zebra: i % 2 === 1 }); nr += 1; });
  summe(ws, nr, `Total ${b.buero}`, pVon, nr - 1, uebersicht, [null, null, null, null, h(b.personen.reduce((s, p) => s + p.normal_min, 0)), h(b.personen.reduce((s, p) => s + p.ueber_min, 0)), h(b.total_min)], F.akzentSoft);
  nr += 2;
  fuss(ws, nr, 'Stunden dezimal: 0.25 = 15 Minuten. Konto-Nr. = Baustelle laut SORBA. Nur freigegebene Einträge, sofern nicht anders vermerkt.');
  druck(ws, `${b.buero} ${unter.zeitraum}`);
}

/** SORBA-Raster: Zeile = Konto (Zusatzarbeit alter Meldungen getrennt), Spalte = Person, Personen senkrecht. */
function blattRaster(wb: Workbook, vergeben: Set<string>, unter: Untertitel, r: RasterExport): void {
  const ws = neuesBlatt(wb, 'SORBA-Raster', vergeben, F.tinte2);
  const spalten: Spalte[] = [
    { titel: 'Konto', breite: 10 },
    { titel: 'Baustelle', breite: 32 },
    { titel: 'Art', breite: 12 },
    ...r.personen.map((p) => ({ titel: p.name, breite: 6.5, art: 'h' as const, senkrecht: true })),
    { titel: 'Total h', breite: 10, art: 'h', fett: true },
  ];
  kopf(ws, 'SORBA-Raster', unter, spalten, 3);
  const von = KOPF + 1;
  r.vorgaenge.forEach((v, i) => {
    const werte = r.personen.map((p) => h(v.min.get(p.id) ?? 0));
    const total = h([...v.min.values()].reduce((s, m) => s + m, 0));
    zeile(ws, von + i, [v.konto, v.bezeichnung, v.regie ? 'Zusatzarbeit' : '', ...werte, total], spalten, v.regie ? { fill: F.akzentSoft, farbe: F.akzent } : { zebra: i % 2 === 1 });
    // Zeilentotal als Formel, damit es beim Tippen nachvollziehbar bleibt
    if (r.personen.length > 0) {
      const c = ws.getCell(von + i, spalten.length);
      c.value = { formula: `SUM(D${von + i}:${buchstabe(3 + r.personen.length)}${von + i})`, result: total };
    }
  });
  const bis = von + r.vorgaenge.length - 1;
  const proPerson = r.personen.map((p) => h(r.vorgaenge.reduce((s, v) => s + (v.min.get(p.id) ?? 0), 0)));
  summe(ws, bis + 1, 'Total', von, bis, spalten, [null, null, null, ...proPerson, h(r.vorgaenge.reduce((s, v) => s + [...v.min.values()].reduce((a, m) => a + m, 0), 0))]);
  if (r.vorgaenge.length > 0) ws.autoFilter = { from: { row: KOPF, column: 1 }, to: { row: bis, column: 3 } };
  fuss(ws, bis + 3, 'Zeile = Konto (Baustelle), Spalte = Person, Wert = Stunden (normal + über). Rot: Zusatzarbeit aus älteren Meldungen, in SORBA separat erfassen.');
  druck(ws, `SORBA-Raster ${unter.zeitraum}`);
}

// ── Öffentliche Funktionen ─────────────────────────────────────────────────

async function herunterladen(wb: Workbook, dateiname: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function neuesBuch(E: typeof Excel): Workbook {
  const wb = new E.Workbook();
  wb.creator = 'Rapporto';
  wb.created = new Date();
  return wb;
}

export interface RapportExport {
  unter: Untertitel;
  monat: boolean;
  jahr: string;
  /** null = Bauführer, nur Raster */
  lohn: { spalten: string[]; zeilen: LohnExportZeile[]; ueber: UeberExportZeile[]; bueros: BueroBlatt[] } | null;
  raster: RasterExport;
  dateiname: string;
}

/** Das Gesamt-Excel: Lohn, Überstunden, je Büro ein Blatt, SORBA-Raster — bzw. nur das Raster für den Bauführer. */
export async function rapportExcel(d: RapportExport): Promise<void> {
  const E = await lade();
  const wb = neuesBuch(E);
  const vergeben = new Set<string>();
  if (d.lohn) {
    blattLohn(wb, vergeben, d.unter, d.lohn.spalten, d.monat, d.lohn.zeilen);
    blattUeberstunden(wb, vergeben, d.unter, d.monat, d.jahr, d.lohn.ueber);
    for (const b of d.lohn.bueros) blattBuero(wb, vergeben, d.unter, b);
  }
  blattRaster(wb, vergeben, d.unter, d.raster);
  await herunterladen(wb, d.dateiname);
}

/** Nur ein Temporärbüro, nur dessen Leute — die Datei, die das Sekretariat dem Büro schickt. */
export async function bueroExcel(b: BueroBlatt, unter: Untertitel, dateiname: string): Promise<void> {
  const E = await lade();
  const wb = neuesBuch(E);
  blattBuero(wb, new Set(), unter, b);
  await herunterladen(wb, dateiname);
}
