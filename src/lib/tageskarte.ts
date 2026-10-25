/**
 * Karte «Heute» und «Morgen» des Chefmonteurs (24.10.2026, Caturix-Analyse Lücke 2): wohin, ab wann, wo treffen,
 * was beachten, wer dabei ist — und «Navigieren» und «Teilen» für den Team-Chat. Der letzte Stand bleibt im Gerät
 * (Regel #4: draussen ohne Netz steht trotzdem da, was zuletzt galt, mit Uhrzeit).
 *
 * Hier nur die Rechnerei (getestet): wer an dem Tag im Team ist, und der Text zum Teilen.
 */
import { besetzung, type Versetzung } from './planung';
import { adresseText, navigationsLink, type Lage } from './adresse';
import { artText } from './abwesenheit';
import { uhrzeit } from './zeiten';
import { ausIso, kurz, WOCHENTAGE, addTage, iso } from './datum';

export interface KartenBaustelle extends Lage { id: string; konto_nr: string; bezeichnung: string | null }
export interface KartenEinsatz {
  baustelle: KartenBaustelle;
  beginn_min: number | null;
  treffpunkt: 'baustelle' | 'werkhof' | null;
  hinweis: string | null;
  soll_leute: number | null;
}
/** `fehlt`: vom Team als «fehlt» gemeldet (0053), das Büro hat es noch nicht erledigt — `fehlmeldung` zum Zurücknehmen */
export interface KartenPerson { id: string; name: string; art: 'da' | 'dazu' | 'abwesend' | 'fehlt' | 'weg'; info?: string; fehlmeldung?: string }
export interface TagesKarte { datum: string; einsaetze: KartenEinsatz[]; leute: KartenPerson[] }

/**
 * Wer ist an `datum` im Team? Feste Leute (Reihenfolge wie übergeben, Chefmonteur zuerst), dazu Eingeteilte aus anderen
 * Teams; Abwesende und Versetzte stehen dabei, damit niemand gesucht wird. Rechnet wie die Planung (`besetzung`).
 */
export function leuteAm(o: {
  teamId: string;
  fest: { id: string; name: string }[];
  versetzt: Versetzung[];
  /** Person → Art der Abwesenheit an diesem Tag */
  abwesend: Map<string, string>;
  /** Person → offene Fehlmeldung an diesem Tag (0053) */
  fehlt?: Map<string, string>;
  namen: Map<string, string>;
  teamNamen: Map<string, string>;
  datum: string;
}): KartenPerson[] {
  const b = besetzung(new Map([[o.teamId, o.fest.map((p) => p.id)]]), o.versetzt, o.datum).get(o.teamId) ?? { ids: [], dazu: [], weg: [] };
  const name = (id: string) => o.namen.get(id) ?? o.fest.find((p) => p.id === id)?.name ?? 'Person';
  const da: KartenPerson[] = [], dazu: KartenPerson[] = [], fehlt: KartenPerson[] = [], abw: KartenPerson[] = [];
  for (const id of b.ids) {
    const art = o.abwesend.get(id);
    const meldung = o.fehlt?.get(id);
    if (art) abw.push({ id, name: name(id), art: 'abwesend', info: artText(art) });
    else if (meldung) fehlt.push({ id, name: name(id), art: 'fehlt', info: 'fehlt', fehlmeldung: meldung });
    else if (b.dazu.includes(id)) dazu.push({ id, name: name(id), art: 'dazu' });
    else da.push({ id, name: name(id), art: 'da' });
  }
  const weg = b.weg.map((w): KartenPerson => ({ id: w.id, name: name(w.id), art: 'weg', info: o.teamNamen.get(w.nach) ?? 'anderes Team' }));
  return [...da, ...dazu, ...fehlt, ...abw, ...weg];
}

/** «Heute», «Morgen» oder der Wochentag («Montag»), wenn der nächste Arbeitstag nicht morgen ist. */
export function tagTitel(datum: string, heuteIso: string): string {
  if (datum === heuteIso) return 'Heute';
  if (datum === iso(addTage(ausIso(heuteIso), 1))) return 'Morgen';
  return ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][ausIso(datum).getDay()];
}

const tagKurz = (datum: string) => { const d = ausIso(datum); return `${WOCHENTAGE[(d.getDay() + 6) % 7]} ${kurz(d)}`; };
const vorname = (n: string) => n.split(' ')[0];

/**
 * Fertiger Text für den Team-Chat (WhatsApp o. ä.) — das, was bisher abends am Telefon durchgegeben wurde.
 * Ohne Emojis und Formatierung, damit er überall gleich aussieht. Die Route als Google-Link (öffnet überall).
 */
export function teilenText(o: { team: string; karte: TagesKarte; heuteIso: string; beginnFirma: number }): string {
  const z: string[] = [`${o.team} · ${tagTitel(o.karte.datum, o.heuteIso)}, ${tagKurz(o.karte.datum)}`];
  if (o.karte.einsaetze.length === 0) z.push('Noch keine Baustelle geplant.');
  for (const e of o.karte.einsaetze) {
    z.push('');
    z.push(`${e.baustelle.bezeichnung || 'Baustelle'} (${e.baustelle.konto_nr})`);
    const adr = adresseText(e.baustelle);
    if (adr) z.push(adr);
    z.push([`Beginn ${uhrzeit(e.beginn_min ?? o.beginnFirma)}`, e.treffpunkt === 'werkhof' ? 'Treffpunkt Werkhof' : e.treffpunkt === 'baustelle' ? 'Treffpunkt auf der Baustelle' : null].filter(Boolean).join(' · '));
    if (e.hinweis) z.push(`Hinweis: ${e.hinweis}`);
    z.push(`Route: ${navigationsLink(e.baustelle, false)}`);
  }
  const da = o.karte.leute.filter((p) => p.art === 'da' || p.art === 'dazu').map((p) => vorname(p.name));
  const fehlen = o.karte.leute.filter((p) => p.art === 'abwesend' || p.art === 'fehlt' || p.art === 'weg').map((p) => `${vorname(p.name)} (${p.art === 'weg' ? p.info : (p.info ?? 'abwesend').toLowerCase()})`);
  z.push('');
  if (da.length) z.push(`Leute: ${da.join(', ')}`);
  if (fehlen.length) z.push(`Nicht dabei: ${fehlen.join(', ')}`);
  return z.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
