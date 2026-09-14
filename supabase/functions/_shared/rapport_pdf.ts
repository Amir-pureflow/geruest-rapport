// Regierapport als PDF — im Aufbau des SORBA-Ausdrucks von Gerüst GmbH (Vorlage 11.09.2026):
// Briefkopf, Rechnungsadresse, Objekt, «Regierapport Nr.», Arbeit/Beschrieb, Tabelle nach Tarifklasse,
// Summe, Unterschriftszeile, Fristsatz. Beträge in Rappen (int) → Franken nur bei der Ausgabe.
//
// Wird von `regierapport-senden` (Anhang der Kundenmail) und `regierapport-pdf` (Ansicht in der App) genutzt.
// Beim Deploy über den MCP liegt die Datei neben index.ts als `./rapport_pdf.ts` (Import wird beim Deploy umgeschrieben).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Tarifcodes → Kundenbezeichnung, Einheit, Gruppe (Quelle: fixtures/tarife_sguv_2026.json). */
const TARIF: Record<string, { text: string; me: string; gruppe: 'personal' | 'fahrzeuge' | 'zuschlag' }> = {
  bauf: { text: 'Bauführer/in', me: 'h', gruppe: 'personal' },
  objekt: { text: 'Objektleiter/in', me: 'h', gruppe: 'personal' },
  gruppe: { text: 'Gruppenleiter/in', me: 'h', gruppe: 'personal' },
  monteur: { text: 'Gerüstmonteur/in', me: 'h', gruppe: 'personal' },
  mitarbeiter: { text: 'Gerüstbaumitarbeiter/in', me: 'h', gruppe: 'personal' },
  lern3: { text: 'Lernende 3. Lehrjahr', me: 'h', gruppe: 'personal' },
  lern2: { text: 'Lernende 2. Lehrjahr', me: 'h', gruppe: 'personal' },
  lern1: { text: 'Lernende 1. Lehrjahr', me: 'h', gruppe: 'personal' },
  lieferwagen_35: { text: 'Lieferwagen bis 3,5 t', me: 'h', gruppe: 'fahrzeuge' },
  transporter_8: { text: 'Mannschaftstransporter bis 8 Pers.', me: 'h', gruppe: 'fahrzeuge' },
  lkw_16: { text: 'Lastwagen bis 16 t', me: 'h', gruppe: 'fahrzeuge' },
  lkw_16_kran: { text: 'Lastwagen bis 16 t mit Kran', me: 'h', gruppe: 'fahrzeuge' },
  lkw_32: { text: 'Lastwagen bis 32 t', me: 'h', gruppe: 'fahrzeuge' },
  lkw_32_kran: { text: 'Lastwagen bis 32 t mit Kran', me: 'h', gruppe: 'fahrzeuge' },
  zug_4wd_6: { text: 'Zugfahrzeug 4WD bis 6 t', me: 'h', gruppe: 'fahrzeuge' },
  anhaenger_12: { text: 'Anhänger 2-achsig bis 12 t', me: 'h', gruppe: 'fahrzeuge' },
  etappe: { text: 'Etappenzuschlag', me: 'pa', gruppe: 'zuschlag' },
  materialmiete: { text: 'Materialmiete (9 % pro Monat)', me: 'pa', gruppe: 'zuschlag' },
};

const ORDNUNG = ['bauf', 'objekt', 'gruppe', 'monteur', 'mitarbeiter', 'lern3', 'lern2', 'lern1'];

export function chf(rappen: number): string {
  const v = Math.round(rappen);
  const ganz = Math.floor(Math.abs(v) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const rp = (Math.abs(v) % 100).toString().padStart(2, '0');
  return `${v < 0 ? '-' : ''}${ganz}.${rp}`;
}
function menge(hundertstel: number): string {
  return (hundertstel / 100).toFixed(3);
}
function datumCh(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface Position { tarif_code: string; bezeichnung: string; menge_hundertstel: number; ansatz_rappen: number; betrag_rappen: number }

export interface RapportDaten {
  nummer: string | null;
  betrag_rappen: number | null;
  beschrieb: string | null;
  erstellt_am: string;
  frist_tage: number;
  link: string | null;
  arbeitsdatum: string | null;
  kunde: { name: string; adresse: string | null; ansprechperson: string | null } | null;
  baustelle: { bezeichnung: string | null; konto_nr: string; strasse: string | null; plz: string | null; ort: string | null } | null;
  sachbearbeiter: string | null;
  positionen: Position[];
  firma: Record<string, string>;
}

/** Positionen nach Tarifklasse zusammenfassen — der Kunde sieht Klassen, nicht Namen. */
function gruppieren(positionen: Position[]) {
  const m = new Map<string, { code: string; menge: number; ansatz: number; summe: number }>();
  for (const p of positionen) {
    const e = m.get(p.tarif_code) ?? { code: p.tarif_code, menge: 0, ansatz: p.ansatz_rappen, summe: 0 };
    e.menge += p.menge_hundertstel;
    e.summe += p.betrag_rappen;
    if (!e.ansatz) e.ansatz = p.ansatz_rappen;
    m.set(p.tarif_code, e);
  }
  const alle = [...m.values()];
  const rang = (c: string) => { const i = ORDNUNG.indexOf(c); return i < 0 ? 99 : i; };
  const personal = alle.filter((z) => TARIF[z.code]?.gruppe === 'personal').sort((a, b) => rang(a.code) - rang(b.code));
  const rest = alle.filter((z) => TARIF[z.code]?.gruppe !== 'personal');
  return { personal, rest };
}

/** Zeilenumbruch auf Breite. */
function umbrechen(text: string, font: PDFFont, groesse: number, breite: number): string[] {
  const zeilen: string[] = [];
  for (const absatz of text.split(/\r?\n/)) {
    const woerter = absatz.split(/\s+/).filter(Boolean);
    let zeile = '';
    for (const w of woerter) {
      const probe = zeile ? `${zeile} ${w}` : w;
      if (font.widthOfTextAtSize(probe, groesse) <= breite) zeile = probe;
      else { if (zeile) zeilen.push(zeile); zeile = w; }
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

/** Zeichen, die Helvetica (WinAnsi) nicht kennt, ersetzen — sonst wirft pdf-lib. */
function sicher(s: string): string {
  return s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/•/g, '•').replace(/[^\x00-\xFF]/g, '?');
}

export async function pdfBauen(d: RapportDaten): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Regierapport ${d.nummer ?? ''}`.trim());
  doc.setAuthor(d.firma.FIRMA_NAME ?? 'Gerüst Rapport');
  const seite = doc.addPage([595.28, 841.89]);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const grau = rgb(0.55, 0.58, 0.6);
  const tinte = rgb(0.09, 0.14, 0.16);
  const rot = rgb(0.85, 0.16, 0.09);
  const L = 50, R = 545;
  let y = 800;

  const t = (text: string, x: number, yy: number, o: { f?: PDFFont; g?: number; farbe?: ReturnType<typeof rgb>; rechts?: boolean } = {}) => {
    const f = o.f ?? normal, g = o.g ?? 10;
    const s = sicher(text);
    const xx = o.rechts ? x - f.widthOfTextAtSize(s, g) : x;
    seite.drawText(s, { x: xx, y: yy, size: g, font: f, color: o.farbe ?? tinte });
  };

  // ── Briefkopf ──────────────────────────────────────────────────────────────
  const firma = d.firma.FIRMA_NAME ?? 'Gerüst Rapport';
  t(`${firma}${d.firma.FIRMA_SLOGAN ? ' ' + d.firma.FIRMA_SLOGAN : ''}`, L, y, { f: fett, g: 9, farbe: grau });
  y -= 12;
  for (const zeile of [
    d.firma.FIRMA_ADRESSE,
    [d.firma.FIRMA_TEL ? `Tel. ${d.firma.FIRMA_TEL}` : '', d.firma.FIRMA_FAX ? `Fax ${d.firma.FIRMA_FAX}` : ''].filter(Boolean).join(' • '),
    [d.firma.FIRMA_MAIL, d.firma.FIRMA_WEB].filter(Boolean).join(' • '),
    d.firma.FIRMA_BANK,
  ].filter((z): z is string => !!z)) {
    t(zeile, L, y, { g: 8, farbe: grau });
    y -= 11;
  }
  if (d.firma.FIRMA_MWST) { t(d.firma.FIRMA_MWST, L + 12, y - 2, { g: 7.5, farbe: tinte }); }
  // Logo-Kasten rechts: Firmenname gross in Rot, Slogan darunter
  seite.drawRectangle({ x: 375, y: 758, width: 170, height: 42, borderColor: rot, borderWidth: 1 });
  t(firma, 385, 778, { f: fett, g: 16, farbe: tinte });
  if (d.firma.FIRMA_SLOGAN) t(d.firma.FIRMA_SLOGAN, 385, 764, { g: 9, farbe: grau });
  y = 720;

  // ── Adressen ───────────────────────────────────────────────────────────────
  t('Rechnungsadresse:', L, y, { g: 10 });
  const adr = [d.kunde?.name, ...(d.kunde?.adresse ?? '').split(/\r?\n/)].filter((z): z is string => !!z && z.trim().length > 0);
  for (const z of (adr.length ? adr : ['—'])) { t(z, L + 130, y, { g: 10 }); y -= 13; }
  y -= 16;
  t('Objekt:', L, y, { f: fett, g: 10 });
  const obj = [d.baustelle?.bezeichnung, d.baustelle?.strasse, [d.baustelle?.plz, d.baustelle?.ort].filter(Boolean).join(' ')].filter((z): z is string => !!z && z.trim().length > 0);
  for (const z of (obj.length ? obj : ['—'])) { t(z, L + 130, y, { f: fett, g: 10 }); y -= 13; }
  y -= 4;
  t('Objekt Nr:', L, y, { g: 10 }); t(d.baustelle?.konto_nr ?? '', L + 130, y, { g: 10 }); y -= 16;
  t('Sachbearbeiter:', L, y, { g: 10 }); t(d.sachbearbeiter ?? firma, L + 130, y, { g: 10 });
  const ort = (d.firma.FIRMA_ADRESSE ?? '').split('•').pop()?.trim().replace(/^\d{4}\s*/, '') || 'Bern';
  t(`${ort}, ${datumCh(d.erstellt_am)}`, R, y, { g: 10, rechts: true });
  y -= 34;

  // ── Titel + Arbeit ─────────────────────────────────────────────────────────
  t(`Regierapport ${d.nummer ?? ''}`.trim(), L, y, { f: fett, g: 12 });
  y -= 24;
  t('Arbeit:', L, y, { f: fett, g: 10 }); y -= 13;
  if (d.arbeitsdatum) { t(`Arbeiten ausgeführt am ${datumCh(d.arbeitsdatum)}`, L, y, { g: 10 }); y -= 13; }
  if (d.beschrieb) {
    y -= 4;
    for (const z of umbrechen(d.beschrieb, normal, 10, R - L)) { t(z, L, y, { g: 10 }); y -= 13; }
  }
  y -= 12;

  // ── Tabelle ────────────────────────────────────────────────────────────────
  const cText = L, cMe = 330, cMenge = 400, cPreis = 470, cSumme = R;
  t('Text', cText, y, { f: fett, g: 10 }); t('Me', cMe, y, { f: fett, g: 10 });
  t('Menge', cMenge, y, { f: fett, g: 10, rechts: true }); t('Preis', cPreis, y, { f: fett, g: 10, rechts: true }); t('Summe', cSumme, y, { f: fett, g: 10, rechts: true });
  y -= 18;
  t('Regie Tarif 2026/27', cText, y, { f: fett, g: 10 }); y -= 18;
  const { personal, rest } = gruppieren(d.positionen);
  const zeile = (z: { code: string; menge: number; ansatz: number; summe: number }) => {
    const info = TARIF[z.code] ?? { text: z.code, me: 'h' };
    t(info.text, cText, y, { g: 10 }); t(info.me, cMe, y, { g: 10 });
    t(menge(z.menge), cMenge, y, { g: 10, rechts: true }); t(chf(z.ansatz), cPreis, y, { g: 10, rechts: true }); t(chf(z.summe), cSumme, y, { g: 10, rechts: true });
    y -= 13;
  };
  if (personal.length) { t('Stundensätze', cText, y, { f: fett, g: 10 }); y -= 14; personal.forEach(zeile); y -= 6; }
  if (rest.length) { t('Kleinmaschinen + Fahrzeuge / Zuschläge', cText, y, { f: fett, g: 10 }); y -= 14; rest.forEach(zeile); y -= 6; }
  y -= 8;
  const total = d.betrag_rappen ?? d.positionen.reduce((s, p) => s + p.betrag_rappen, 0);
  t('Summe:', cText, y, { f: fett, g: 10 });
  t(chf(total), cSumme, y, { f: fett, g: 10, rechts: true });
  seite.drawLine({ start: { x: cSumme - 80, y: y - 3 }, end: { x: cSumme, y: y - 3 }, thickness: 0.8, color: tinte });
  seite.drawLine({ start: { x: cSumme - 80, y: y - 5 }, end: { x: cSumme, y: y - 5 }, thickness: 0.8, color: tinte });
  y -= 50;

  // ── Unterschrift + Frist ───────────────────────────────────────────────────
  t('Unterschrift Auftraggeber: ' + '.'.repeat(70), L, y, { g: 10 }); y -= 22;
  t(`Wir bitten Sie, den Regierapport innert ${d.frist_tage} ${d.frist_tage === 1 ? 'Tag' : 'Tagen'} unterschrieben zu retournieren.`, L, y, { g: 10 }); y -= 14;
  if (d.link) { t(`Oder online bestätigen, ohne Anmeldung: ${d.link}`, L, y, { g: 9, farbe: grau }); y -= 14; }

  t('Erstellt mit Gerüst Rapport', L, 40, { g: 7.5, farbe: grau });
  return await doc.save();
}

/** Daten laden, PDF bauen, im Bucket «anhaenge» unter rapporte/<id>.pdf ablegen, pdf_pfad setzen. */
export async function rapportPdfErzeugen(supa: SupabaseClient, regierapportId: string, opts: { basisUrl?: string; sachbearbeiter?: string | null } = {}) {
  const { data: rRoh, error } = await supa
    .from('regierapport')
    .select('id, nummer, betrag_rappen, beschrieb, erstellt_am, link_token, baustelle:baustelle_id(bezeichnung, konto_nr, strasse, plz, ort, kunde:kunde_id(name, adresse, ansprechperson, frist_tage)), tagesmeldung:tagesmeldung_id(datum)')
    .eq('id', regierapportId)
    .single();
  if (error || !rRoh) throw new Error('Regierapport nicht gefunden');
  const r = rRoh as unknown as {
    id: string; nummer: string | null; betrag_rappen: number | null; beschrieb: string | null; erstellt_am: string; link_token: string;
    baustelle: { bezeichnung: string | null; konto_nr: string; strasse: string | null; plz: string | null; ort: string | null; kunde: { name: string; adresse: string | null; ansprechperson: string | null; frist_tage: number | null } | null } | null;
    tagesmeldung: { datum: string } | null;
  };
  const [{ data: pos }, { data: conf }] = await Promise.all([
    supa.from('regie_position').select('tarif_code, bezeichnung, menge_hundertstel, ansatz_rappen, betrag_rappen').eq('regierapport_id', r.id),
    supa.from('konfiguration').select('schluessel,wert'),
  ]);
  const firma: Record<string, string> = Object.fromEntries((conf ?? []).map((k: { schluessel: string; wert: string }) => [k.schluessel, k.wert]));
  const basis = (opts.basisUrl ?? firma.APP_URL ?? '').replace(/\/$/, '');
  const bytes = await pdfBauen({
    nummer: r.nummer,
    betrag_rappen: r.betrag_rappen,
    beschrieb: r.beschrieb,
    erstellt_am: r.erstellt_am,
    frist_tage: Math.min(60, Math.max(1, Number(r.baustelle?.kunde?.frist_tage ?? 3) || 3)),
    link: basis ? `${basis}/b/${r.link_token}` : null,
    arbeitsdatum: r.tagesmeldung?.datum ?? null,
    kunde: r.baustelle?.kunde ? { name: r.baustelle.kunde.name, adresse: r.baustelle.kunde.adresse, ansprechperson: r.baustelle.kunde.ansprechperson } : null,
    baustelle: r.baustelle ? { bezeichnung: r.baustelle.bezeichnung, konto_nr: r.baustelle.konto_nr, strasse: r.baustelle.strasse, plz: r.baustelle.plz, ort: r.baustelle.ort } : null,
    sachbearbeiter: opts.sachbearbeiter ?? null,
    positionen: (pos ?? []) as Position[],
    firma,
  });
  const pfad = `rapporte/${r.id}.pdf`;
  const { error: up } = await supa.storage.from('anhaenge').upload(pfad, bytes, { contentType: 'application/pdf', upsert: true });
  if (up) throw new Error('PDF konnte nicht gespeichert werden: ' + up.message);
  await supa.from('regierapport').update({ pdf_pfad: pfad }).eq('id', r.id);
  const dateiname = `${(r.nummer ?? 'Regierapport').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  return { bytes, pfad, dateiname };
}
