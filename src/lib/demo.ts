/**
 * Demo-Betrieb — ein vollständiger, deterministischer Gerüstbaubetrieb:
 * 75 Mitarbeitende (45 fest + 30 temporär), 5 Bauführer, 20 Teams mit
 * Chefmonteur, 30 Kunden/Bauleitungen, alle 217 Konten zugeordnet,
 * Jahresplan, fünf Wochen Tagesmeldungen mit Überstunden und Sprachnotizen.
 * Gleicher Seed = gleiche Daten.
 *
 * Seit 20.09. ohne Zusatzaufträge und Regierapporte (SORBA macht die Regie) —
 * die frühere Fassung liegt in archiv/regie-und-board/.
 *
 * Kunden-Mails enden bewusst auf «.example» (reservierte Domain): Aus einer
 * Demo darf nie eine Mail an eine echte fremde Adresse gehen.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addTage, iso, montag, NORMALTAG_MIN } from './datum';

// ── Zufall, reproduzierbar ────────────────────────────────────────────────────

class Zufall {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  uuid(): string {
    // v4-förmig, aber aus dem Seed — damit die Demo reproduzierbar bleibt
    const h = () => Math.floor(this.next() * 16).toString(16);
    const s = (n: number) => Array.from({ length: n }, h).join('');
    return `${s(8)}-${s(4)}-4${s(3)}-${['8', '9', 'a', 'b'][this.int(0, 3)]}${s(3)}-${s(12)}`;
  }
}

// ── Namen ─────────────────────────────────────────────────────────────────────

const VN_DE = ['Marco', 'Reto', 'Stefan', 'Daniel', 'Michael', 'Thomas', 'Patrick', 'Adrian', 'Christian', 'Lukas', 'Simon', 'Fabian', 'Pascal', 'Dominik', 'Sandro', 'Roman', 'Beat', 'Urs', 'Kevin', 'Nicolas', 'Matthias', 'Jonas'];
const NN_DE = ['Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Steiner', 'Fischer', 'Gerber', 'Brunner', 'Baumann', 'Zimmermann', 'Moser', 'Widmer', 'Wyss', 'Graf', 'Roth', 'Lüthi', 'Bieri', 'Aebi', 'Hofer', 'Jost', 'Zbinden'];
const VN_ALB = ['Besnik', 'Valon', 'Drilon', 'Fatmir', 'Ilir', 'Blerim', 'Shpend', 'Agron', 'Kushtrim', 'Liridon', 'Burim', 'Ardian', 'Gëzim', 'Mentor', 'Florent', 'Visar', 'Enis', 'Dritan'];
const NN_ALB = ['Krasniqi', 'Sylaj', 'Berisha', 'Gashi', 'Hoxha', 'Shala', 'Bytyqi', 'Rexhepi', 'Morina', 'Kelmendi', 'Zeqiri', 'Ademi', 'Maliqi', 'Osmani', 'Bajrami'];
const VN_PL = ['Marek', 'Tomasz', 'Piotr', 'Krzysztof', 'Paweł', 'Łukasz', 'Grzegorz', 'Andrzej', 'Mateusz', 'Jakub', 'Rafał'];
const NN_PL = ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Dąbrowski', 'Mazur'];
const VN_AR = ['Ahmad', 'Omar', 'Youssef', 'Karim', 'Sami', 'Hassan', 'Bilal', 'Tarek', 'Rami', 'Nabil'];
const NN_AR = ['Haddad', 'Khalil', 'Nasser', 'Saleh', 'Mansour', 'Aziz', 'Farah', 'Hamdan', 'Karam'];
const VN_EN = ['Daniel', 'Samuel', 'Emmanuel', 'Joseph', 'Kofi'];
const NN_EN = ['Okafor', 'Mensah', 'Adeyemi', 'Boateng', 'Asante'];

const TEMPORAERBUEROS = ['Adecco', 'Manpower', 'Randstad', 'Interiman', 'Coople'];
const FAHRZEUGE = ['VW Crafter', 'Mercedes Sprinter', 'Iveco Daily', 'Ford Transit', 'Renault Master'];

const KUNDEN: [string, string][] = [
  ['Aebi Bau AG', 'M. Huber'], ['Gerber & Partner Architekten', 'S. Gerber'], ['Baugeschäft Wyss AG', 'R. Wyss'],
  ['GU Bernabau AG', 'T. Ammann'], ['Steiner Immobilien AG', 'C. Steiner'], ['Wohnbaugenossenschaft Brünnen', 'K. Lehmann'],
  ['Stadt Bern, Hochbau', 'B. Schär'], ['Kanton Bern, AGG', 'P. Zaugg'], ['Bieri Holzbau AG', 'A. Bieri'],
  ['Moser Baumeister AG', 'D. Moser'], ['Habitat Generalunternehmung', 'L. Rüfenacht'], ['Architekturbüro Lüthi', 'N. Lüthi'],
  ['Baumann Fassaden AG', 'E. Baumann'], ['Zimmermann Bedachungen', 'F. Zimmermann'], ['Immo Bern West AG', 'G. Roth'],
  ['Spitalverbund Bern', 'H. Brunner'], ['Burgergemeinde Bern', 'J. von Graffenried'], ['Widmer Sanierungen', 'M. Widmer'],
  ['Graf Malerei AG', 'O. Graf'], ['Keller & Söhne Bau', 'U. Keller'], ['BLS Immobilien', 'V. Hofer'],
  ['Genossenschaft Wabern', 'W. Jost'], ['Schmid Renovationen', 'Y. Schmid'], ['Fischer Dach + Wand', 'Z. Fischer'],
  ['Meier Totalunternehmer AG', 'A. Meier'], ['Schneider Architektur', 'B. Schneider'], ['Zbinden Bau GmbH', 'C. Zbinden'],
  ['Hochschule Bern, Bauten', 'D. Frey'], ['Post Immobilien', 'E. Lanz'], ['SBB Immobilien Region Mitte', 'F. Kunz'],
];

/** Sprachnotizen, wie die Teams sie am Abend hinterlassen — mit Überstunden (warum) oder als Bemerkung zum Tag. */
const NOTIZ_TEXTE = {
  ueber: [
    'Gerüst versetzt, weil der Maurer nicht durchgekommen ist. Bauleitung hat es so verlangt.',
    'Zusätzliche Konsole beim Eingang montiert, Bauleiter war vor Ort und wollte das.',
    'Treppenturm um ein Feld verlängert für den Dachdecker, darum länger geblieben.',
    'Schutznetz am Strassenrand ergänzt, Polizei hat das gefordert.',
    'Zwei Beläge waren beschädigt, vermutlich vom Dachdecker. Ersetzt, hat eine Stunde gebraucht.',
    'Ankerpunkt war lose, nachgezogen und drei Rohre getauscht.',
  ],
  tag: [
    'Eine Stunde gewartet, weil der Kran vom Baumeister das Feld blockiert hat.',
    'Material kam zu spät, wir konnten erst um zehn anfangen.',
    'Bauleitung war vor Ort, alles in Ordnung. Morgen brauchen wir mehr Beläge.',
    'Regen ab drei, wir haben früher aufgehört.',
  ],
} as const;

// ── Zeilen (1:1 die Tabellen) ─────────────────────────────────────────────────

export interface MitarbeiterRow { id: string; name: string; typ: 'intern' | 'extern' | 'temporaer'; funktion: string; sprache: 'de' | 'ar' | 'pl' | 'en'; temporaerbuero: string | null; aktiv: boolean; oev_standard: boolean; km_standard: number; eintritt: string }
export interface TeamRow { id: string; bezeichnung: string; fahrzeug: string; chefmonteur_id: string; aktiv: boolean }
export interface TeamMitgliedRow { team_id: string; mitarbeiter_id: string; von: string }
export interface KundeRow { id: string; name: string; praeferenz: 'einzel' | 'sammel'; ansprechperson: string; email: string; telefon: string }
export interface BaustelleUpdate { id: string; konto_nr: string; bezeichnung: string | null; kunde_id: string; status: 'aktiv' | 'fertig_gemeldet' | 'abgeschlossen'; fertigstellung_am: string | null }
export interface JahresplanRow { id: string; baustelle_id: string; team_id: string; von: string; bis: string }
export interface TagesmeldungRow { id: string; client_uuid: string; team_id: string; datum: string; baustelle_id: string; normalfall: boolean; abweichung_typ: string | null; wer_hats_gewollt: string | null; transkript: string | null; audio_sekunden: number | null; erfasst_von: string; erfasst_am: string; status: 'offen' | 'freigegeben' }
export interface ZeiteintragRow { id: string; tagesmeldung_id: string; mitarbeiter_id: string; normal_min: number; ueber_min: number; oev: boolean; km: number; baustelle_id: string; konto_nr: string; status: 'offen' | 'freigegeben' }
export interface FreigabeLogRow { id: string; zeiteintrag_id: string; wer: string; wann: string; feld: string; alt: string; neu: string }

export interface DemoBetrieb {
  mitarbeiter: MitarbeiterRow[];
  teams: TeamRow[];
  teamMitglieder: TeamMitgliedRow[];
  kunden: KundeRow[];
  baustellen: BaustelleUpdate[];
  jahresplan: JahresplanRow[];
  meldungen: TagesmeldungRow[];
  eintraege: ZeiteintragRow[];
  freigaben: FreigabeLogRow[];
}

export interface BaustelleQuelle { id: string; konto_nr: string; bezeichnung: string | null }

function ts(d: Date, h: number, m: number): string {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c] ?? c).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Generator ────────────────────────────────────────────────────────────────

export function erzeugeDemoBetrieb(opts: { baustellen: BaustelleQuelle[]; heute: Date; userId: string; seed?: number }): DemoBetrieb {
  const z = new Zufall(opts.seed ?? 20260903);
  const heute = new Date(opts.heute);
  heute.setHours(12, 0, 0, 0);
  const heuteIso = iso(heute);
  const wochenStart = montag(heute);

  // Mitarbeitende ---------------------------------------------------------
  const vergeben = new Set<string>();
  function name(vn: readonly string[], nn: readonly string[]): string {
    for (let i = 0; i < 50; i++) {
      const n = `${z.pick(vn)} ${z.pick(nn)}`;
      if (!vergeben.has(n)) {
        vergeben.add(n);
        return n;
      }
    }
    const n = `${z.pick(vn)} ${z.pick(nn)} ${vergeben.size}`;
    vergeben.add(n);
    return n;
  }
  const mitarbeiter: MitarbeiterRow[] = [];
  const person = (p: Omit<MitarbeiterRow, 'id' | 'aktiv' | 'eintritt'> & { jahre?: number }): MitarbeiterRow => {
    const row: MitarbeiterRow = {
      id: z.uuid(), aktiv: true,
      eintritt: iso(addTage(heute, -z.int(60, (p.jahre ?? 6) * 365))),
      name: p.name, typ: p.typ, funktion: p.funktion, sprache: p.sprache,
      temporaerbuero: p.temporaerbuero, oev_standard: p.oev_standard, km_standard: p.km_standard,
    };
    mitarbeiter.push(row);
    return row;
  };

  const bauf: MitarbeiterRow[] = [];
  for (let i = 0; i < 5; i++) bauf.push(person({ name: name(VN_DE, NN_DE), typ: 'intern', funktion: 'bauf', sprache: 'de', temporaerbuero: null, oev_standard: false, km_standard: z.int(15, 40), jahre: 15 }));

  const chefs: MitarbeiterRow[] = [];
  for (let i = 0; i < 20; i++) {
    const alb = z.chance(0.55);
    chefs.push(person({ name: alb ? name(VN_ALB, NN_ALB) : name(VN_DE, NN_DE), typ: 'intern', funktion: 'gruppe', sprache: 'de', temporaerbuero: null, oev_standard: false, km_standard: z.int(10, 45), jahre: 12 }));
  }

  const interne: MitarbeiterRow[] = [];
  for (let i = 0; i < 20; i++) {
    const r = z.next();
    const [vn, nn, sp]: [readonly string[], readonly string[], MitarbeiterRow['sprache']] =
      r < 0.5 ? [VN_ALB, NN_ALB, 'de'] : r < 0.75 ? [VN_DE, NN_DE, 'de'] : [VN_PL, NN_PL, 'pl'];
    const oev = z.chance(0.3);
    interne.push(person({ name: name(vn, nn), typ: 'intern', funktion: z.chance(0.7) ? 'monteur' : 'mitarbeiter', sprache: sp, temporaerbuero: null, oev_standard: oev, km_standard: oev ? 0 : z.chance(0.25) ? z.int(8, 30) : 0, jahre: 8 }));
  }

  const temps: MitarbeiterRow[] = [];
  for (let i = 0; i < 30; i++) {
    const r = z.next();
    const [vn, nn, sp]: [readonly string[], readonly string[], MitarbeiterRow['sprache']] =
      r < 0.3 ? [VN_AR, NN_AR, 'ar'] : r < 0.6 ? [VN_PL, NN_PL, 'pl'] : r < 0.72 ? [VN_EN, NN_EN, 'en'] : r < 0.88 ? [VN_ALB, NN_ALB, 'de'] : [VN_DE, NN_DE, 'de'];
    const oev = z.chance(0.5);
    temps.push(person({ name: name(vn, nn), typ: 'temporaer', funktion: z.chance(0.4) ? 'monteur' : 'mitarbeiter', sprache: sp, temporaerbuero: z.pick(TEMPORAERBUEROS), oev_standard: oev, km_standard: 0, jahre: 1 }));
  }

  // Teams -------------------------------------------------------------------
  const teams: TeamRow[] = [];
  const teamMitglieder: TeamMitgliedRow[] = [];
  const mitgliederVon = new Map<string, MitarbeiterRow[]>();
  let tempIdx = 0;
  for (let i = 0; i < 20; i++) {
    const team: TeamRow = {
      id: z.uuid(), bezeichnung: `Team ${i + 1}`,
      fahrzeug: `${z.pick(FAHRZEUGE)} · BE ${z.int(10, 99)} ${z.int(100, 999)}`,
      chefmonteur_id: chefs[i].id, aktiv: true,
    };
    teams.push(team);
    const leute = [chefs[i], interne[i]];
    const anzTemp = i < 10 ? 2 : 1; // 10×2 + 10×1 = 30
    for (let k = 0; k < anzTemp && tempIdx < temps.length; k++) leute.push(temps[tempIdx++]);
    mitgliederVon.set(team.id, leute);
    for (const m of leute) teamMitglieder.push({ team_id: team.id, mitarbeiter_id: m.id, von: m.typ === 'temporaer' ? iso(addTage(heute, -z.int(20, 120))) : iso(addTage(heute, -z.int(200, 900))) });
  }

  // Kunden (Stammdaten: wem gehört die Baustelle) ------------------------------
  const kunden: KundeRow[] = KUNDEN.map(([firma, ap]) => ({
    id: z.uuid(), name: firma, praeferenz: z.chance(0.3) ? 'sammel' : 'einzel',
    ansprechperson: ap,
    email: `${slug(ap.split('. ')[1] ?? ap)}@${slug(firma).slice(0, 18)}.example`,
    telefon: `031 ${z.int(300, 999)} ${z.int(10, 99)} ${z.int(10, 99)}`,
  }));

  // Baustellen zuordnen -----------------------------------------------------
  const baustellen: BaustelleUpdate[] = opts.baustellen.map((b) => {
    const r = z.next();
    const status: BaustelleUpdate['status'] = r < 0.6 ? 'aktiv' : r < 0.82 ? 'fertig_gemeldet' : 'abgeschlossen';
    return {
      id: b.id, konto_nr: b.konto_nr, bezeichnung: b.bezeichnung,
      kunde_id: z.pick(kunden).id, status,
      fertigstellung_am: status === 'aktiv' ? null : iso(addTage(heute, status === 'fertig_gemeldet' ? -z.int(3, 45) : -z.int(60, 300))),
    };
  });
  const aktive = baustellen.filter((b) => b.status === 'aktiv');
  const grosse = aktive.slice(0, 16); // Grossbaustellen: mehrere Teams gleichzeitig möglich

  // Jahresplan --------------------------------------------------------------
  const jahresplan: JahresplanRow[] = [];
  const aktuelleBaustelle = new Map<string, BaustelleUpdate>();
  const fruehereBaustelle = new Map<string, BaustelleUpdate>();
  const pool = aktive.slice(16);
  for (const [i, team] of teams.entries()) {
    const frueher = pool[(i * 2) % pool.length];
    const jetzt = grosse[i % grosse.length];
    const spaeter = pool[(i * 2 + 1) % pool.length];
    fruehereBaustelle.set(team.id, frueher);
    aktuelleBaustelle.set(team.id, jetzt);
    jahresplan.push(
      { id: z.uuid(), baustelle_id: frueher.id, team_id: team.id, von: iso(addTage(wochenStart, -42)), bis: iso(addTage(wochenStart, -15)) },
      { id: z.uuid(), baustelle_id: jetzt.id, team_id: team.id, von: iso(addTage(wochenStart, -14)), bis: iso(addTage(wochenStart, 13)) },
      { id: z.uuid(), baustelle_id: spaeter.id, team_id: team.id, von: iso(addTage(wochenStart, 14)), bis: iso(addTage(wochenStart, 14 + z.int(20, 50))) },
    );
  }

  // Tagesmeldungen ----------------------------------------------------------
  // Wie das Wochenblatt: Normal (bis 8.4 h) + Überstunden je Person. An manchen Tagen eine Sprachnotiz —
  // mit Überstunden ist sie das Warum, sonst eine Bemerkung zum Tag (Bauführer 20.09.).
  const meldungen: TagesmeldungRow[] = [];
  const eintraege: ZeiteintragRow[] = [];
  const freigaben: FreigabeLogRow[] = [];

  for (const team of teams) {
    const leute = mitgliederVon.get(team.id)!;
    for (let w = -4; w <= 0; w++) {
      const wStart = addTage(wochenStart, w * 7);
      const vergangen = w < 0;
      const bs = w <= -2 ? fruehereBaustelle.get(team.id)! : aktuelleBaustelle.get(team.id)!;
      const notizTag = z.chance(0.35) ? z.int(0, 4) : -1;
      for (let t = 0; t < 6; t++) {
        if (t === 5 && !z.chance(0.08)) continue; // Samstag selten
        const tag = addTage(wStart, t);
        const tagIso = iso(tag);
        if (tagIso > heuteIso) continue;
        if (tagIso === heuteIso && !z.chance(0.35)) continue; // heute: nur ein Teil hat schon gemeldet
        const status: 'offen' | 'freigegeben' = vergangen ? 'freigegeben' : 'offen';

        const meldung: TagesmeldungRow = {
          id: z.uuid(), client_uuid: z.uuid(), team_id: team.id, datum: tagIso, baustelle_id: bs.id,
          normalfall: true, abweichung_typ: null, wer_hats_gewollt: null, transkript: null, audio_sekunden: null,
          erfasst_von: opts.userId, erfasst_am: ts(tag, 16, z.int(30, 59)), status,
        };
        meldungen.push(meldung);
        // Freitag oft kürzer, sonst der normale Tag
        const basis = t === 4 && z.chance(0.3) ? 420 : NORMALTAG_MIN;
        const tagesEintraege: ZeiteintragRow[] = [];
        for (const m of leute) {
          const istChef = m.id === team.chefmonteur_id;
          const anwesend = istChef ? z.chance(0.97) : m.typ === 'temporaer' ? z.chance(0.88) : z.chance(0.93);
          if (!anwesend) continue;
          const e: ZeiteintragRow = {
            id: z.uuid(), tagesmeldung_id: meldung.id, mitarbeiter_id: m.id,
            normal_min: basis, ueber_min: 0,
            oev: false, km: m.km_standard,
            baustelle_id: bs.id, konto_nr: bs.konto_nr, status,
          };
          eintraege.push(e);
          tagesEintraege.push(e);
        }

        if (t === notizTag && tagesEintraege.length > 0) {
          const mitUeber = z.chance(0.7);
          meldung.transkript = z.pick(mitUeber ? NOTIZ_TEXTE.ueber : NOTIZ_TEXTE.tag);
          meldung.audio_sekunden = z.int(8, 25);
          // Überstunden für die ersten zwei Anwesenden (Chefmonteur + einer), in halben Stunden
          if (mitUeber) for (const e of tagesEintraege.slice(0, 2)) e.ueber_min = z.int(2, 5) * 30;
        }
        if (vergangen) for (const e of tagesEintraege) freigaben.push({ id: z.uuid(), zeiteintrag_id: e.id, wer: opts.userId, wann: ts(addTage(wStart, 7), 8, z.int(5, 55)), feld: 'status', alt: 'offen', neu: 'freigegeben' });
      }
    }
  }

  return { mitarbeiter, teams, teamMitglieder, kunden, baustellen, jahresplan, meldungen, eintraege, freigaben };
}

// ── Laden / Zurücksetzen ─────────────────────────────────────────────────────

export type Protokoll = (zeile: string) => void;

async function inChunks(client: SupabaseClient, tabelle: string, rows: object[], log: Protokoll, groesse = 200): Promise<void> {
  for (let i = 0; i < rows.length; i += groesse) {
    const { error } = await client.from(tabelle).insert(rows.slice(i, i + groesse) as Record<string, unknown>[]);
    if (error) throw new Error(`${tabelle}: ${error.message}`);
  }
  log(`${tabelle}: ${rows.length}`);
}

/** Löscht alle Bewegungs- und Stammdaten (nicht die Baustellen) — in FK-Reihenfolge.
 *  Die Regie-Tabellen (zustellung_log, regie_position, regierapport, zusatzauftrag) bleiben in der Datenbank
 *  und werden hier mitgeleert, damit alte Demo-Daten nicht im Weg stehen. */
export async function demoZuruecksetzen(client: SupabaseClient, log: Protokoll): Promise<void> {
  const alles = async (tabelle: string, spalte = 'id') => {
    const { error } = await client.from(tabelle).delete().not(spalte, 'is', null);
    if (error) throw new Error(`${tabelle} löschen: ${error.message}`);
  };
  for (const t of ['freigabe_log', 'zeiteintrag', 'zustellung_log', 'regie_position', 'regierapport', 'tagesmeldung', 'zusatzauftrag', 'planaenderung', 'jahresplan']) await alles(t);
  await alles('team_mitglied', 'team_id');
  await alles('team');
  await alles('mitarbeiter');
  await alles('kunde');
  const { error } = await client.from('baustelle').update({ kunde_id: null, status: 'aktiv', fertigstellung_am: null }).not('id', 'is', null);
  if (error) throw new Error('baustelle zurücksetzen: ' + error.message);
  log('Alles geleert — die 217 Konten bleiben.');
}

export interface DemoZusammenfassung { mitarbeiter: number; teams: number; kunden: number; meldungen: number; eintraege: number }

export async function demoLaden(client: SupabaseClient, userId: string, log: Protokoll): Promise<DemoZusammenfassung> {
  const { data: bs, error } = await client.from('baustelle').select('id,konto_nr,bezeichnung').order('konto_nr');
  if (error || !bs || bs.length === 0) throw new Error('Keine Baustellen gefunden — zuerst die 217er-Liste importieren.');
  log(`${bs.length} Baustellen gefunden`);

  await demoZuruecksetzen(client, log);
  const d = erzeugeDemoBetrieb({ baustellen: bs, heute: new Date(), userId });

  await inChunks(client, 'kunde', d.kunden, log);
  await inChunks(client, 'mitarbeiter', d.mitarbeiter, log);
  await inChunks(client, 'team', d.teams, log);
  await inChunks(client, 'team_mitglied', d.teamMitglieder, log);
  {
    const { error: e } = await client.from('baustelle').upsert(d.baustellen, { onConflict: 'id' });
    if (e) throw new Error('baustelle zuordnen: ' + e.message);
    log(`baustelle: ${d.baustellen.length} zugeordnet`);
  }
  await inChunks(client, 'jahresplan', d.jahresplan, log);
  await inChunks(client, 'tagesmeldung', d.meldungen, log);
  await inChunks(client, 'zeiteintrag', d.eintraege, log);
  await inChunks(client, 'freigabe_log', d.freigaben, log);

  return { mitarbeiter: d.mitarbeiter.length, teams: d.teams.length, kunden: d.kunden.length, meldungen: d.meldungen.length, eintraege: d.eintraege.length };
}
