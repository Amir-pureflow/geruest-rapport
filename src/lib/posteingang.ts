/**
 * Posteingang (Migration 0051, 24.10.2026 — Caturix-Analyse Schritt 4): eine Glocke für das, was jemand wissen muss,
 * ohne danach zu suchen. Geschrieben wird nur von der Datenbank (Auslöser); die App liest, zeigt und setzt «gelesen».
 *
 *   Teamgerät / Chefmonteur: Plan für heute oder den nächsten Arbeitstag geändert, Leute dazu oder weg, jemand fehlt,
 *     Stunden vom Büro korrigiert.
 *   Monteur mit eigenem Zugang: in einem anderen Team eingeteilt, eigene Stunden korrigiert.
 *   Büro: Rückfrage des Kunden, Regierapport bestätigt, Frist abgelaufen, Meldung mit Abweichung.
 *
 * Die Bündel tragen den Stand vorher und nachher (`inhalt.posten`); den Satz dazu baut `eintragText()` hier — so
 * bleibt die Sprache in der App und die Datenbank speichert nur Daten. Ohne Netz zeigt die Glocke den letzten Stand
 * (Vorrat). Fehlt die Tabelle (0051 nicht eingespielt), gibt es keine Glocke.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { vorratLesen, vorratSchreiben } from './vorrat';
import { addTage, ausIso, iso, kurz, montag, stunden } from './datum';
import { artText } from './abwesenheit';
import { uhrzeit } from './zeiten';
import { festeAnsicht, seitenFuer, type Ansicht } from './ansicht';
import { useAuffrischen } from './auffrischen';

export type PostArt = 'plan' | 'korrektur' | 'rueckfrage' | 'bestaetigt' | 'frist' | 'abweichung';

/** Ein Posten eines Bündels: Stand vor der ersten Änderung und jetzt (null = gab es nicht / gibt es nicht mehr). */
export interface Posten {
  titel?: string | null;
  vorher: unknown;
  nachher: unknown;
  zeit?: string;
}

export interface Eintrag {
  id: string;
  an: 'buero' | 'team' | 'person';
  team_id: string | null;
  mitarbeiter_id: string | null;
  art: PostArt;
  tag: string | null;
  bezug_id: string | null;
  inhalt: Record<string, unknown>;
  erstellt_am: string;
  geaendert_am: string;
  erledigt_am: string | null;
  /** von diesem Zugang gelesen */
  gelesen: boolean;
}

export interface EintragText {
  titel: string;
  zeilen: string[];
  /** wohin ein Tipp führt */
  ziel: string;
}

// ── Texte ────────────────────────────────────────────────────────────────────────────────────

const TAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const TAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** «heute», «morgen», sonst «Montag 26.10.» */
export function tagWort(tag: string, heuteIso: string): string {
  if (tag === heuteIso) return 'heute';
  if (tag === iso(addTage(ausIso(heuteIso), 1))) return 'morgen';
  const d = ausIso(tag);
  return `${TAGE_LANG[d.getDay()]} ${kurz(d)}`;
}

const tagKurz = (tag: string) => { const d = ausIso(tag); return `${TAGE_KURZ[d.getDay()]} ${kurz(d)}`; };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null);
const text = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const zahl = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function postenVon(e: Eintrag): [string, Posten][] {
  const p = obj(e.inhalt.posten);
  if (!p) return [];
  return Object.entries(p)
    .map(([k, v]) => [k, (obj(v) ?? { vorher: null, nachher: null }) as unknown as Posten] as [string, Posten])
    .sort((a, b) => (a[1].zeit ?? '').localeCompare(b[1].zeit ?? ''));
}

const TREFFPUNKT: Record<string, string> = { werkhof: 'Werkhof', baustelle: 'auf der Baustelle' };
const treffpunkt = (x: unknown) => TREFFPUNKT[String(x)] ?? 'auf der Baustelle';

/** Was sich an einem Einsatz geändert hat (Baustelle gleich, Beginn/Treffpunkt/Hinweis anders). */
function einsatzAenderungen(vor: Record<string, unknown>, nach: Record<string, unknown>): string[] {
  const z: string[] = [];
  const bv = zahl(vor.beginn), bn = zahl(nach.beginn);
  if (bv !== bn) z.push(bn === null ? 'Beginn wieder wie immer' : `Beginn ${uhrzeit(bn)}` + (bv === null ? '' : ` statt ${uhrzeit(bv)}`));
  if ((vor.treffpunkt ?? null) !== (nach.treffpunkt ?? null)) z.push(`Treffpunkt ${treffpunkt(nach.treffpunkt)}` + (vor.treffpunkt ? ` statt ${treffpunkt(vor.treffpunkt)}` : ''));
  const hv = text(vor.hinweis), hn = text(nach.hinweis);
  if (hv !== hn) z.push(hn ? `Hinweis: «${hn}»` : 'Hinweis entfernt');
  return z;
}

/** Zusatz zu einer neuen Baustelle: ab wann und wo man sich trifft, wenn gesetzt. */
function einsatzDetails(n: Record<string, unknown>): string {
  const t: string[] = [];
  const b = zahl(n.beginn);
  if (b !== null) t.push(`ab ${uhrzeit(b)}`);
  if (n.treffpunkt === 'werkhof') t.push('Treffpunkt Werkhof');
  return t.length ? ` (${t.join(', ')})` : '';
}

function personZeile(name: string, vor: Record<string, unknown> | null, nach: Record<string, unknown> | null): string | null {
  const sv = vor?.s, sn = nach?.s;
  if (sn === 'abwesend') return `${name} fehlt (${artText(String(nach?.art ?? '')).toLowerCase()})`;
  if (sn === 'weg') return `${name} ist bei ${text(nach?.nach) ?? 'einem anderen Team'}`;
  if (sn === 'da' && sv === 'abwesend') return `${name} ist doch da`;
  if (sn === 'da' && sv === 'weg') return `${name} ist wieder bei euch`;
  if (sn === 'da') return `${name} kommt dazu`;
  if (sn === 'nicht') return `${name} ist nicht mehr eingeteilt`;
  return null;
}

function planZeilen(e: Eintrag): string[] {
  const posten = postenVon(e);
  const baustellen = posten.filter(([k]) => k.startsWith('b:'));
  const z: string[] = [];
  const weg = baustellen.filter(([, p]) => obj(p.vorher) && !obj(p.nachher));
  const neu = baustellen.filter(([, p]) => !obj(p.vorher) && obj(p.nachher));
  const name = (p: Posten) => text(obj(p.nachher)?.baustelle) ?? text(obj(p.vorher)?.baustelle) ?? text(p.titel) ?? 'Baustelle';
  if (weg.length === 1 && neu.length === 1) {
    z.push(`${name(neu[0][1])} statt ${name(weg[0][1])}${einsatzDetails(obj(neu[0][1].nachher)!)}`);
  } else {
    for (const [, p] of neu) z.push(`Neu: ${name(p)}${einsatzDetails(obj(p.nachher)!)}`);
    for (const [, p] of weg) z.push(`Fällt weg: ${name(p)}`);
  }
  const geaendert = baustellen.filter(([, p]) => obj(p.vorher) && obj(p.nachher));
  for (const [, p] of geaendert) {
    const aenderungen = einsatzAenderungen(obj(p.vorher)!, obj(p.nachher)!);
    // Mehrere Baustellen im Bündel: sagen, welche gemeint ist
    const vor = baustellen.length > 1 ? `${name(p)}: ` : '';
    for (const a of aenderungen) z.push(vor + a);
  }
  for (const [k, p] of posten) {
    if (!k.startsWith('m:')) continue;
    const s = personZeile(text(p.titel) ?? 'Jemand', obj(p.vorher), obj(p.nachher));
    if (s) z.push(s);
  }
  return z;
}

const FELD: Record<string, string> = { normal_min: 'Normal', ueber_min: 'Überstunden', zeiten: 'Zeiten' };

function korrekturZeilen(e: Eintrag): string[] {
  const z: string[] = [];
  for (const [feld, p] of postenVon(e)) {
    const alt = text(p.vorher), neu = text(p.nachher);
    if (feld === 'normal_min' || feld === 'ueber_min') {
      const h = (s: string | null) => (s !== null && /^-?\d+$/.test(s) ? `${stunden(Number(s))} h` : s ?? '—');
      z.push(`${FELD[feld]} ${h(alt)} → ${h(neu)}`);
    } else {
      z.push(`${FELD[feld] ?? feld} ${alt ?? '—'} → ${neu ?? '—'}`);
    }
  }
  const grund = text(e.inhalt.grund);
  if (grund) z.push(`Grund: ${grund}`);
  return z;
}

const ABWEICHUNG: Record<string, string> = { zusaetzlich: 'Zusatzarbeit', warten: 'Warten müssen', kaputt: 'Etwas kaputt', laenger: 'Länger gearbeitet' };
const GEWOLLT: Record<string, string> = { kunde: 'vom Kunden gewollt', chef: 'vom Chefmonteur entschieden', niemand: 'niemand hat es verlangt' };

/** Titel, Zeilen und Ziel eines Eintrags — die ganze Sprache des Posteingangs an einer Stelle (getestet). */
export function eintragText(e: Eintrag, heuteIso: string): EintragText {
  const i = e.inhalt;
  const nummer = text(i.nummer) ?? 'Regierapport';
  const baustelle = text(i.baustelle);
  const regie = e.bezug_id ? `/regie/${e.bezug_id}` : '/regie';
  switch (e.art) {
    case 'plan': {
      const tag = e.tag ? tagWort(e.tag, heuteIso) : '';
      if (e.an === 'person') {
        const p = postenVon(e).find(([k]) => k === 'team')?.[1];
        const vor = obj(p?.vorher), nach = obj(p?.nachher);
        const zeile = nach
          ? `Du bist bei ${text(nach.team) ?? 'einem anderen Team'}${text(nach.baustelle) ? ` · ${text(nach.baustelle)}` : ''}` + (vor && text(vor.team) !== text(nach.team) ? ` (statt ${text(vor.team)})` : '')
          : 'Du bist in keinem Team eingeteilt';
        return { titel: `Einteilung für ${tag} geändert`, zeilen: [zeile], ziel: '/' };
      }
      return { titel: `Plan für ${tag} geändert`, zeilen: planZeilen(e), ziel: '/' };
    }
    case 'korrektur': {
      const wann = e.tag ? tagKurz(e.tag) : '';
      const titel = e.an === 'person' ? `Deine Stunden vom ${wann} korrigiert` : `Stunden korrigiert: ${text(i.name) ?? 'Jemand'}, ${wann}`;
      return { titel, zeilen: korrekturZeilen(e), ziel: '/' };
    }
    case 'rueckfrage': {
      const z = [baustelle, text(i.kommentar) ? `«${text(i.kommentar)}»` : null, text(i.von) ? `von ${text(i.von)}` : null];
      return { titel: `Rückfrage zu ${nummer}`, zeilen: z.filter((x): x is string => !!x), ziel: regie };
    }
    case 'bestaetigt': {
      const z = [baustelle, text(i.von) ? `von ${text(i.von)}` : null];
      return { titel: `${nummer} bestätigt`, zeilen: z.filter((x): x is string => !!x), ziel: regie };
    }
    case 'frist': {
      const frist = text(i.frist_bis);
      const z = [baustelle, frist ? `Frist bis ${tagKurz(frist)} — noch nicht bestätigt` : 'Noch nicht bestätigt'];
      return { titel: `Frist abgelaufen: ${nummer}`, zeilen: z.filter((x): x is string => !!x), ziel: regie };
    }
    case 'abweichung': {
      const typ = ABWEICHUNG[String(i.typ)] ?? 'Abweichung';
      const tag = e.tag;
      const z = [
        [baustelle, tag ? tagKurz(tag) : null].filter(Boolean).join(' · ') || null,
        GEWOLLT[String(i.wer)] ? GEWOLLT[String(i.wer)][0].toUpperCase() + GEWOLLT[String(i.wer)].slice(1) : null,
        text(i.text) ? `«${text(i.text)}»` : null,
      ];
      const q = new URLSearchParams();
      if (tag) { q.set('woche', iso(montag(ausIso(tag)))); q.set('tag', tag); }
      if (text(i.team_id)) q.set('team', String(i.team_id));
      if (e.bezug_id) q.set('meldung', e.bezug_id);
      return { titel: `${text(i.team) ?? 'Ein Team'} meldet: ${typ}`, zeilen: z.filter((x): x is string => !!x), ziel: `/cockpit?${q}` };
    }
  }
}

/** Zählt für die Glocke: ungelesen und nicht schon erledigt (eine beantwortete Rückfrage muss niemand mehr sehen). */
export function istNeu(e: Eintrag): boolean {
  return !e.gelesen && !e.erledigt_am;
}

/** «vor 5 Min.», «14:20», «gestern 16:05», «Mi 21.10.» */
export function wannText(zeit: string, jetzt: Date): string {
  const t = new Date(zeit);
  const min = Math.round((jetzt.getTime() - t.getTime()) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const uhr = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (iso(t) === iso(jetzt)) return uhr;
  if (iso(t) === iso(addTage(jetzt, -1))) return `gestern ${uhr}`;
  return tagKurz(iso(t));
}

// ── Wer liest was ────────────────────────────────────────────────────────────────────────────

const TEAM_KEY = 'teamgeraet-team-id';
const MONTEUR_KEY = 'monteur-id';

export type Empfaenger = { art: 'buero' } | { art: 'baustelle'; team: string | null; person: string | null };

/**
 * Für welche Einträge diese Ansicht zuständig ist. Das Büro liest die Büro-Einträge (das Sekretariat nur, wenn es
 * Wochenübersicht oder Regie sieht — sonst führten die Einträge ins Leere); das Teamgerät die seines Teams und die der
 * angemeldeten Person; der Monteur die eigenen. Kein Posteingang für die Kunden-Ansicht.
 */
export function empfaengerFuer(ansicht: Ansicht | null, lies: (k: string) => string | null = (k) => localStorage.getItem(k)): Empfaenger | null {
  if (!ansicht || ansicht === 'kunde') return null;
  if (ansicht === 'bauf') return { art: 'buero' };
  if (ansicht === 'sekretariat') return seitenFuer('sekretariat').some((s) => s === 'cockpit' || s === 'regie') ? { art: 'buero' } : null;
  let team: string | null = null, person: string | null = null;
  try {
    team = ansicht === 'chef' ? lies(TEAM_KEY) : null;
    // Teamgerät mit Firmen-Zugang: keine Person — sonst stünden die Einträge eines Monteurs, der hier einmal gewählt
    // wurde, auf dem Gerät des Teams
    person = ansicht === 'monteur' || festeAnsicht() ? lies(MONTEUR_KEY) : null;
  } catch { /* privater Modus */ }
  return { art: 'baustelle', team, person };
}

const schluessel = (e: Empfaenger | null) => (!e ? '' : e.art === 'buero' ? 'buero' : `t:${e.team ?? '-'}|p:${e.person ?? '-'}`);

// ── Laden und Zustand (eine Quelle für Glocke und Seite) ─────────────────────────────────────

interface Stand {
  schluessel: string;
  eintraege: Eintrag[];
  geladen: boolean;
  /** Tabelle fehlt (0051 nicht eingespielt) — dann keine Glocke */
  fehlt: boolean;
  fehler: string | null;
}

let stand: Stand = { schluessel: '', eintraege: [], geladen: false, fehlt: false, fehler: null };
const hoerer = new Set<() => void>();
const setzen = (s: Stand) => { stand = s; hoerer.forEach((h) => h()); };

const SPALTEN = 'id,an,team_id,mitarbeiter_id,art,tag,bezug_id,inhalt,erstellt_am,geaendert_am,erledigt_am,gelesen:posteingang_gelesen(gelesen_am)';
/** Was älter ist, braucht niemand mehr in der Glocke (die Datenbank räumt nach 90 Tagen auf) */
const TAGE_ZURUECK = 30;

type Zeile = Omit<Eintrag, 'gelesen'> & { gelesen?: { gelesen_am: string }[] | null };

const tabelleFehlt = (err: { code?: string; message?: string }) =>
  err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(err.message ?? '');

let laeuft: Promise<void> | null = null;
let laeuftFuer = '';

/** Lädt die Einträge für die Ansicht. Still: ohne «Lädt …», Fehler bleiben im Zustand. */
export function posteingangLaden(ansicht: Ansicht | null): Promise<void> {
  const emp = empfaengerFuer(ansicht);
  const key = schluessel(emp);
  if (key !== stand.schluessel) {
    // andere Ansicht oder anderes Team: erst den Vorrat zeigen, nicht die Einträge der vorigen
    const v = key ? vorratLesen<Eintrag[]>(`posteingang:${key}`) : null;
    setzen({ schluessel: key, eintraege: v ?? [], geladen: !!v, fehlt: false, fehler: null });
  }
  if (!emp || !supabase || (emp.art === 'baustelle' && !emp.team && !emp.person)) {
    if (stand.schluessel === key && !stand.geladen) setzen({ ...stand, geladen: true });
    return Promise.resolve();
  }
  if (laeuft) return laeuftFuer === key ? laeuft : laeuft.then(() => posteingangLaden(ansicht));
  const client = supabase;
  laeuftFuer = key;
  laeuft = (async () => {
    try {
      const seit = addTage(new Date(), -TAGE_ZURUECK).toISOString();
      let q = client.from('posteingang').select(SPALTEN).gte('geaendert_am', seit).order('geaendert_am', { ascending: false }).limit(100);
      if (emp.art === 'buero') q = q.eq('an', 'buero');
      else {
        const teile: string[] = [];
        if (emp.team) teile.push(`and(an.eq.team,team_id.eq.${emp.team})`);
        if (emp.person) teile.push(`and(an.eq.person,mitarbeiter_id.eq.${emp.person})`);
        q = q.or(teile.join(','));
      }
      const { data, error } = await q;
      if (schluessel(empfaengerFuer(ansicht)) !== key) return; // inzwischen gewechselt
      if (error) {
        if (tabelleFehlt(error)) setzen({ ...stand, eintraege: [], geladen: true, fehlt: true, fehler: null });
        else setzen({ ...stand, geladen: true, fehler: error.message });
        return;
      }
      const eintraege = ((data ?? []) as unknown as Zeile[]).map(({ gelesen, ...z }) => ({ ...z, gelesen: (gelesen?.length ?? 0) > 0 }));
      // Eben als gelesen markiert, die Antwort war schneller als das Speichern: gelesen bleibt gelesen
      const schonGelesen = new Set(stand.eintraege.filter((x) => x.gelesen).map((x) => x.id));
      for (const x of eintraege) if (schonGelesen.has(x.id)) x.gelesen = true;
      vorratSchreiben(`posteingang:${key}`, eintraege);
      setzen({ schluessel: key, eintraege, geladen: true, fehlt: false, fehler: null });
    } catch (err) {
      setzen({ ...stand, geladen: true, fehler: err instanceof Error ? err.message : String(err) });
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

/** Als gelesen markieren — sofort in der Anzeige, gespeichert im Hintergrund (ohne Netz beim nächsten Mal nochmals). */
export async function alsGelesen(ids: string[]): Promise<void> {
  const offen = ids.filter((id) => stand.eintraege.some((e) => e.id === id && !e.gelesen));
  if (offen.length === 0) return;
  const eintraege = stand.eintraege.map((e) => (offen.includes(e.id) ? { ...e, gelesen: true } : e));
  setzen({ ...stand, eintraege });
  vorratSchreiben(`posteingang:${stand.schluessel}`, eintraege);
  if (!supabase) return;
  await supabase.from('posteingang_gelesen').upsert(offen.map((id) => ({ eintrag_id: id })), { onConflict: 'eintrag_id,konto', ignoreDuplicates: true });
}

function abonnieren(h: () => void) { hoerer.add(h); return () => { hoerer.delete(h); }; }

/**
 * Zustand des Posteingangs für die Ansicht — lädt beim ersten Gebrauch, bei Rückkehr auf die Seite und jede Minute
 * (die Glocke soll eine Umplanung zeigen, bevor das Team losfährt). Glocke und Seite teilen sich einen Zustand.
 */
export function usePosteingang(ansicht: Ansicht | null): Stand & { neu: number } {
  const s = useSyncExternalStore(abonnieren, () => stand);
  // Auch beim Wechsel des Teams neu laden (Teamgerät: Team erst nach dem Start gewählt — sonst blieb die Glocke leer)
  const key = schluessel(empfaengerFuer(ansicht));
  useEffect(() => { void posteingangLaden(ansicht); }, [ansicht, key]);
  useAuffrischen(() => posteingangLaden(ansicht), 60 * 1000);
  const aktuell = s.schluessel === key;
  const eintraege = aktuell ? s.eintraege : [];
  return { ...s, eintraege, neu: eintraege.filter(istNeu).length };
}
