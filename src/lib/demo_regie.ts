/**
 * Demodaten für den Regie-Modus — Zusatzaufträge, Regierapporte, Positionen, Zustellnachweise.
 *
 * Steht bewusst neben `demo.ts` und nicht darin: Firmen ohne Regie (`MODUS_ERFASSUNG = wochenblatt`)
 * laden diese Zeilen nie, und der Wochenblatt-Demobetrieb bleibt unverändert (Entscheid 02.10.2026).
 *
 * Angehängt wird an die Meldungen, die schon Überstunden haben — genau dort entsteht im echten Ablauf
 * der Regieverdacht: Team meldet Überstunden mit Sprachnotiz, der Bauführer rechnet daraus einen
 * Regierapport vor. Dazu kommen offene Zusatzaufträge für heute und die nächsten Tage sowie einer,
 * der nie Regie wurde (Kunde hat abgesagt).
 *
 * Gleicher Seed = gleiche Daten. Kunden-Mails enden in der Demo auf «.example» — aus einer Demo darf
 * nie eine Mail an eine echte fremde Adresse gehen; die Rapporte hier werden auch nie verschickt,
 * nur als bereits verschickt dargestellt.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addTage, iso, montag } from './datum';
import { tarifNachCode, positionBetrag, materialmiete, ETAPPE_MIN_RAPPEN, RUECKFALL_ANSATZ_RAPPEN } from './tarif';
import type { DemoBetrieb, Protokoll } from './demo';

export interface ZusatzauftragRow {
  id: string; client_uuid: string; baustelle_id: string; besteller_name: string; besteller_rolle: string;
  bestellt_am: string; kanal: string; taetigkeit: string; geplant_fuer: string; notiz: string | null;
  status: 'offen' | 'erledigt_ohne_regie';
  erledigt_grund?: 'abgesagt' | 'pauschale' | 'kulanz' | 'doppelt' | null; erledigt_am?: string | null; erledigt_von?: string | null;
  /** Mehrkostenanzeige (0011): wann und an wen die Bauleitung informiert wurde */
  angezeigt_am?: string | null; angezeigt_an?: string | null;
}
export interface RegierapportRow {
  id: string; zusatzauftrag_id: string | null; tagesmeldung_id: string | null; baustelle_id: string; nummer: string;
  status: string; betrag_rappen: number; frist_bis: string | null; erstellt_am: string; versendet_am: string | null;
  bestaetigt_am: string | null; empfaenger_email: string;
}
export interface RegiePositionRow {
  id: string; regierapport_id: string; tarif_code: string; bezeichnung: string;
  menge_hundertstel: number; ansatz_rappen: number; betrag_rappen: number;
}
export interface ZustellungRow { id: string; regierapport_id: string; an: string; ereignis: string; zeitpunkt: string }

export interface DemoRegie {
  zusatzauftraege: ZusatzauftragRow[];
  regierapporte: RegierapportRow[];
  positionen: RegiePositionRow[];
  zustellungen: ZustellungRow[];
}

/** Derselbe Zufall wie in demo.ts (mulberry32) — eigener Seed, damit die Grunddaten unberührt bleiben. */
class Zufall {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  uuid(): string {
    const h = () => Math.floor(this.next() * 16).toString(16);
    const s = (n: number) => Array.from({ length: n }, h).join('');
    return `${s(8)}-${s(4)}-4${s(3)}-${['8', '9', 'a', 'b'][this.int(0, 3)]}${s(3)}-${s(12)}`;
  }
}

function ts(d: Date, h: number, m: number): string {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
}

const TAETIGKEITEN = ['versetzen', 'ergaenzen', 'teilabbau', 'reparieren'] as const;
const NOTIZEN = ['Maurer blockiert', 'Fenstermontage braucht Platz', 'Sturmschaden Ostseite', 'Dachdecker braucht Zugang'] as const;

/**
 * Regie-Demodaten aus einem fertigen Demobetrieb ableiten.
 *
 * `heute` steuert, wie alt die Rapporte sind — davon hängt ihr Stand ab: frisch = Entwurf oder
 * versendet, nach vier Tagen auch Rückfragen, nach zehn Tagen bestätigt oder Frist abgelaufen.
 * So ist auf der Regierapporte-Seite jede Spalte besetzt.
 */
export function erzeugeDemoRegie(d: DemoBetrieb, opts: { heute: Date; userId: string; seed?: number }): DemoRegie {
  const z = new Zufall(opts.seed ?? 20261002);
  const jetzt = new Date(opts.heute);
  const heute = new Date(opts.heute);
  heute.setHours(12, 0, 0, 0);

  const zusatzauftraege: ZusatzauftragRow[] = [];
  const regierapporte: RegierapportRow[] = [];
  const positionen: RegiePositionRow[] = [];
  const zustellungen: ZustellungRow[] = [];

  const kundeVon = (baustelleId: string) => {
    const b = d.baustellen.find((x) => x.id === baustelleId);
    return d.kunden.find((k) => k.id === b?.kunde_id);
  };
  const ansatzVon = (funktion: string) => {
    try { return tarifNachCode(funktion).ansatz_rappen; } catch { return RUECKFALL_ANSATZ_RAPPEN; }
  };

  // Die Meldungen mit Überstunden sind die Regieverdachtsfälle — älteste zuerst, damit die Nummern stimmen
  const mitUeber = d.meldungen
    .filter((m) => m.normalfall && d.eintraege.some((e) => e.tagesmeldung_id === m.id && e.ueber_min > 0))
    .sort((a, b) => a.datum.localeCompare(b.datum));

  // Stand je Fall (06.10.2026, fürs Video): ältere Wochen sind erledigt — fast alles bestätigt, genau
  // eine Rückfrage und genau eine abgelaufene Frist. In der Vorwoche sind die ersten drei Fälle schon
  // Rapport (gestern verschickt bzw. Entwurf), die übrigen warten auf den Entscheid des Bauführers.
  // Diese Woche: noch kein Rapport — nur der Zusatzauftrag.
  const wochenStart = montag(heute);
  const vorwoche = iso(addTage(wochenStart, -7));
  const diese = iso(wochenStart);
  const aeltere = mitUeber.filter((m) => m.datum < vorwoche);
  const standAelter = new Map<string, string>();
  aeltere.forEach((m, i) => standAelter.set(m.id, i === aeltere.length - 1 ? 'rueckfrage' : i === aeltere.length - 3 ? 'frist_abgelaufen' : 'bestaetigt'));
  const vorwochenFaelle = mitUeber.filter((m) => m.datum >= vorwoche && m.datum < diese);
  const standVorwoche = new Map<string, string>();
  vorwochenFaelle.slice(0, 3).forEach((m, i) => standVorwoche.set(m.id, ['versendet', 'entwurf', 'versendet'][i]));

  let nummer = 31;
  for (const m of mitUeber) {
    const k = kundeVon(m.baustelle_id);
    if (!k) continue;
    const tag = new Date(m.datum + 'T12:00:00');
    const alterTage = Math.round((heute.getTime() - tag.getTime()) / 86400000);
    const geplanterStand = standAelter.get(m.id) ?? standVorwoche.get(m.id) ?? null;

    // Der Kunde hat am Vortag angerufen — das ist der Zusatzauftrag zur Überstunde
    const za: ZusatzauftragRow = {
      id: z.uuid(), client_uuid: z.uuid(), baustelle_id: m.baustelle_id,
      besteller_name: k.ansprechperson, besteller_rolle: 'Bauleitung',
      bestellt_am: ts(addTage(tag, -1), z.int(8, 16), z.int(0, 59)),
      kanal: z.chance(0.7) ? 'telefon' : 'mail',
      taetigkeit: z.pick(TAETIGKEITEN), geplant_fuer: m.datum, notiz: null,
      // Der Stand («gemeldet», «im Regierapport») wird abgeleitet, nie gespeichert (Regel aus CLAUDE.md)
      status: 'offen',
      // Bauleitung am selben Abend informiert — so läuft es, wenn der Bauführer es gleich erledigt
      angezeigt_am: ts(addTage(tag, -1), 17, 10), angezeigt_an: k.email,
    };
    zusatzauftraege.push(za);
    if (alterTage < 1 || !geplanterStand) continue; // noch kein Rapport: frisch oder wartet auf den Entscheid

    // Positionen: die Überstunden je Funktion, dazu Lieferwagen, Etappenzuschlag, Materialmiete
    const rid = z.uuid();
    const pos: RegiePositionRow[] = [];
    const proFunktion = new Map<string, number>();
    for (const e of d.eintraege.filter((x) => x.tagesmeldung_id === m.id && x.ueber_min > 0)) {
      const f = d.mitarbeiter.find((p) => p.id === e.mitarbeiter_id)?.funktion ?? 'monteur';
      proFunktion.set(f, (proFunktion.get(f) ?? 0) + e.ueber_min);
    }
    for (const [f, min] of proFunktion) {
      let bezeichnung = `Monteur ${(min / 60).toFixed(1)} h`;
      try { bezeichnung = `${tarifNachCode(f).bezeichnung} ${(min / 60).toFixed(1)} h`; } catch { /* unbekannte Funktion */ }
      const p = { code: f, bezeichnung, mengeHundertstel: Math.round((min / 60) * 100), ansatzRappen: ansatzVon(f) };
      pos.push({ id: z.uuid(), regierapport_id: rid, tarif_code: f, bezeichnung, menge_hundertstel: p.mengeHundertstel, ansatz_rappen: p.ansatzRappen, betrag_rappen: positionBetrag(p) });
    }
    if (pos.length === 0) continue;
    if (z.chance(0.7)) {
      const lw = tarifNachCode('lieferwagen_35');
      pos.push({ id: z.uuid(), regierapport_id: rid, tarif_code: 'lieferwagen_35', bezeichnung: 'Lieferwagen 1.0 h', menge_hundertstel: 100, ansatz_rappen: lw.ansatz_rappen, betrag_rappen: lw.ansatz_rappen });
    }
    if (z.chance(0.6)) pos.push({ id: z.uuid(), regierapport_id: rid, tarif_code: 'etappe', bezeichnung: 'Etappenzuschlag', menge_hundertstel: 100, ansatz_rappen: ETAPPE_MIN_RAPPEN, betrag_rappen: ETAPPE_MIN_RAPPEN });
    const basis = pos.reduce((sum, p) => sum + p.betrag_rappen, 0);
    const miete = materialmiete(basis);
    pos.push({ id: z.uuid(), regierapport_id: rid, tarif_code: 'materialmiete', bezeichnung: 'Materialmiete 9 %', menge_hundertstel: 100, ansatz_rappen: miete, betrag_rappen: miete });
    positionen.push(...pos);

    const status = geplanterStand;
    // Vorwoche: gestern vorbereitet und verschickt — die Frist läuft noch, und «Verschickt» im Monat ist nicht leer
    const ausVorwoche = standVorwoche.has(m.id);
    const erstellt = ausVorwoche ? addTage(heute, -1) : addTage(tag, 1);
    const versendet = ausVorwoche ? addTage(heute, -1) : addTage(tag, z.int(1, 2));
    const frist = addTage(versendet, 3);
    const bestaetigt = status === 'bestaetigt' ? addTage(versendet, z.int(0, 2)) : null;

    regierapporte.push({
      id: rid, zusatzauftrag_id: za.id, tagesmeldung_id: m.id, baustelle_id: m.baustelle_id,
      nummer: `RR-2026-${String(nummer++).padStart(4, '0')}`,
      status, betrag_rappen: basis + miete, frist_bis: status === 'entwurf' ? null : iso(frist),
      erstellt_am: ts(erstellt, 9, z.int(0, 59)),
      versendet_am: status === 'entwurf' ? null : ts(versendet, 10, z.int(0, 59)),
      bestaetigt_am: bestaetigt ? ts(bestaetigt, 14, z.int(0, 59)) : null,
      empfaenger_email: k.email,
    });

    if (status !== 'entwurf') {
      const an = k.email;
      zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'gesendet', zeitpunkt: ts(versendet, 10, z.int(0, 59)) });
      zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'zugestellt', zeitpunkt: ts(versendet, 10, 59) });
      if (status !== 'frist_abgelaufen' || z.chance(0.5)) {
        zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'geoeffnet', zeitpunkt: ts(addTage(versendet, z.int(0, 1)), z.int(11, 18), z.int(0, 59)) });
      }
      if (status === 'bestaetigt' && bestaetigt) {
        zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'link_geklickt', zeitpunkt: ts(bestaetigt, 14, z.int(0, 30)) });
        zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'bestaetigt', zeitpunkt: ts(bestaetigt, 14, z.int(31, 59)) });
      }
      if (status === 'rueckfrage') zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'rueckfrage', zeitpunkt: ts(addTage(versendet, 1), 9, z.int(0, 59)) });
      if (status === 'frist_abgelaufen') zustellungen.push({ id: z.uuid(), regierapport_id: rid, an, ereignis: 'erinnert', zeitpunkt: ts(frist, 8, 0) });
    }
  }

  // Offene Zusatzaufträge: heute und die nächsten Tage — damit der Trichter die Stufe «bestellt» zeigt
  const aktive = d.baustellen.filter((b) => b.status === 'aktiv');
  const fertige = d.baustellen.filter((b) => b.status === 'fertig_gemeldet');
  if (aktive.length > 0) {
    [0, 0, 1, 2, 4, 6].forEach((inTagen, i) => {
      // Einer an einer fertig gemeldeten Baustelle — das ist der Fall, über den die Bauleitung nochmals bestellt
      const bs = i === 5 && fertige.length > 0 ? fertige[0] : z.pick(aktive);
      const k = kundeVon(bs.id);
      if (!k) return;
      // Nie in der Zukunft bestellt, auch wenn die Demo morgens geladen wird
      const bestellt = new Date(Math.min(new Date(ts(addTage(heute, -z.int(0, 2)), z.int(8, 17), z.int(0, 59))).getTime(), jetzt.getTime() - 3600000));
      zusatzauftraege.push({
        id: z.uuid(), client_uuid: z.uuid(), baustelle_id: bs.id, besteller_name: k.ansprechperson, besteller_rolle: 'Bauleitung',
        bestellt_am: bestellt.toISOString(),
        kanal: z.pick(['telefon', 'telefon', 'mail', 'vor_ort']),
        taetigkeit: z.pick(TAETIGKEITEN), geplant_fuer: iso(addTage(heute, inTagen)),
        notiz: z.chance(0.5) ? z.pick(NOTIZEN) : null,
        status: 'offen',
        // Zwei frische Bestellungen sind der Bauleitung noch nicht angezeigt — der Hinweis zeigt, wie es geht
        ...(i === 1 || i === 4 ? {} : { angezeigt_am: new Date(bestellt.getTime() + 20 * 60000).toISOString(), angezeigt_an: k.email }),
      });
    });

    // Ein Auftrag, der bestellt war, aber nie Regie wurde (Kunde hat abgesagt) — mit Grund, wer, wann
    const bs = z.pick(aktive);
    const k = kundeVon(bs.id);
    if (k) {
      zusatzauftraege.push({
        id: z.uuid(), client_uuid: z.uuid(), baustelle_id: bs.id, besteller_name: k.ansprechperson, besteller_rolle: 'Bauleitung',
        bestellt_am: ts(addTage(heute, -6), 9, 15), kanal: 'telefon', taetigkeit: 'versetzen', geplant_fuer: iso(addTage(heute, -4)),
        notiz: 'Fenstermontage verschoben', status: 'erledigt_ohne_regie',
        erledigt_grund: 'abgesagt', erledigt_am: ts(addTage(heute, -5), 16, 40), erledigt_von: opts.userId,
      });
    }
  }

  return { zusatzauftraege, regierapporte, positionen, zustellungen };
}

/** Die vier Regie-Tabellen füllen. Wird nur im Regie-Modus aufgerufen (siehe `demoLaden`). */
export async function demoRegieLaden(
  client: SupabaseClient,
  d: DemoBetrieb,
  userId: string,
  log: Protokoll,
): Promise<{ auftraege: number; rapporte: number }> {
  const r = erzeugeDemoRegie(d, { heute: new Date(), userId });
  const einfuegen = async (tabelle: string, rows: object[]) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from(tabelle).insert(rows.slice(i, i + 200) as Record<string, unknown>[]);
      if (error) throw new Error(`${tabelle}: ${error.message}`);
    }
    log(`${tabelle}: ${rows.length}`);
  };
  await einfuegen('zusatzauftrag', r.zusatzauftraege);
  await einfuegen('regierapport', r.regierapporte);
  await einfuegen('regie_position', r.positionen);
  await einfuegen('zustellung_log', r.zustellungen);
  return { auftraege: r.zusatzauftraege.length, rapporte: r.regierapporte.length };
}
