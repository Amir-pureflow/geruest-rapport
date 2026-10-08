import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { FotoGalerie } from '../ui/FotoGalerie';
import { supabase } from '../lib/supabase';
import { addTage, iso, kurz as ch, kw, montag, stunden } from '../lib/datum';
import { aufteilen as aufteilenTag } from '../lib/zeiten';
import { gelbePersonen, normaltagMin } from '../lib/einstellungen';
import { zeitenText } from '../lib/zeiten';
import { useAnsicht } from '../lib/ansicht';
import { einstellungen } from '../lib/einstellungen';
import { minutenBetrag, formatChf, tarifNachCode, RUECKFALL_ANSATZ_RAPPEN } from '../lib/tarif';

/**
 * Phase 3 — Wochenübersicht des Bauführers.
 *
 * Aufbau (17.09.): ein Raster — jedes Team eine Zeile, sieben Zellen Mo–So mit Teamstunden, Farbe = Stand
 * (weiss offen, grün freigegeben, gelb Überstunden, rot über 10 h). Zelle antippen öffnet den Tag:
 * Personen mit Stunden und Zeiten, Korrektur, Überstunden-Karte mit Sprachnotiz, Bemerkung zum Tag, «Tag freigeben».
 * Gelb wird ein Tag erst ab «Gelb markieren ab» der Firma (09.10.2026, Tagestotal einer Person, Gerüst GmbH 9.0 h).
 * Dazu «N Tage freigeben» je Team und ein Knopf oben für alle Tage ohne Hinweis. Kein Montag-Zwang.
 *
 * Firmen-Schalter `MODUS_ERFASSUNG` (02.10.2026) entscheidet, was mit den Überstunden passiert:
 *   wochenblatt — die App zeigt nur, was das Team gemeldet hat. Ob dem Kunden etwas verrechnet wird,
 *                 entscheidet der Bauführer in SORBA (Gerüst GmbH, 20.09.).
 *   regie       — die Hinweiskarte wird zur Entscheidung: Betrag vorgerechnet, «Regierapport vorrechnen ›»
 *                 oder «Keine Regie …» mit Grund. Ein Rapport oder ein Entscheid beantwortet den ganzen
 *                 Tag dieser Baustelle — die Zelle ist dann nicht mehr gelb.
 *
 * Harte Regel #1: Das System sagt NIE «diese Stunden sind falsch».
 * Jede Markierung nennt ihre Quelle («Team meldet 1.5 h Überstunden») — entscheiden tut der Bauführer.
 * Jede Korrektur landet im freigabe_log.
 */

interface LogZeile { feld: string; alt: string | null; neu: string | null; begruendung: string | null; wann: string }

interface Eintrag {
  id: string;
  normal_min: number;
  ueber_min: number;
  /** Zeiten von–bis, wenn das Team welche eingetragen hat (Migration 0016) — der Beleg für die Stunden */
  von_min?: number | null;
  bis_min?: number | null;
  von2_min?: number | null;
  bis2_min?: number | null;
  status: string;
  /** Chronik: wer hat wann was geändert — Regel #7, hier auch lesbar, nicht nur geschrieben */
  freigabe_log?: LogZeile[];
  mitarbeiter: { id: string; name: string; funktion: string; typ: string };
  tagesmeldung: {
    id: string;
    datum: string;
    normalfall: boolean;
    abweichung_typ: string | null;
    wer_hats_gewollt: string | null;
    transkript: string | null;
    transkript_quelle: string | null;
    transkript_sprache: string | null;
    transkript_fehler: string | null;
    audio_pfad: string | null;
    audio_sekunden: number | null;
    team: { id: string; bezeichnung: string } | null;
    baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null;
    foto: { id: string; pfad: string }[];
    /** Nur im Regie-Modus geladen: schon ein Regierapport zu dieser Meldung? Dann dorthin, nie einen zweiten anlegen. */
    regierapport?: { id: string; status: string; nummer: string | null }[];
    /** Nur im Regie-Modus: der Bauführer hat «keine Regie» entschieden — die Stunden bleiben, die Verrechnung entfällt. */
    regie_entscheid?: 'keine_regie' | null;
    regie_grund?: string | null;
  };
}

/** Warum etwas keine Regie ist — feste Gründe, kein Freitext (wie bei den Korrekturen). */
const REGIE_GRUND: Record<string, string> = {
  pauschale: 'in der Offerte / Pauschale drin',
  kulanz: 'Kulanz — wir verrechnen es nicht',
  irrtum: 'Team hat sich vertan — war normale Arbeit',
  doppelt: 'schon in einem anderen Rapport',
};

const RAPPORT_STAND: Record<string, string> = { entwurf: 'Entwurf', versendet: 'beim Kunden', rueckfrage: 'Rückfrage', frist_abgelaufen: 'Frist abgelaufen', bestaetigt: 'bestätigt' };

interface Team { id: string; bezeichnung: string; chefmonteur: { name: string } | null }

type ZellStatus = 'leer' | 'gruen' | 'gelb' | 'rot' | 'frei';
type Filter = 'zutun' | 'alle';

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Abzeichen der Teamzeile: «Team 12» → 12, «Team Vaiti» → TV. */
function teamKuerzel(bezeichnung: string): string {
  const zahl = bezeichnung.match(/\d+/);
  if (zahl) return zahl[0];
  return bezeichnung.split(/\s+/).filter(Boolean).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'T';
}
/** Feste Gründe für Korrekturen — kein Freitext, aber immer ein «warum» (Regel #7). */
const GRUENDE = ['Mit Chefmonteur abgeklärt', 'Pause abgezogen', 'Anreise ist keine Arbeitszeit', 'Tippfehler im Teamgerät'];
const FELD: Record<string, string> = { normal_min: 'Normalzeit', ueber_min: 'Überzeit' };
const ABWEICHUNG_KURZ: Record<string, string> = { zusaetzlich: 'zusätzlich gearbeitet', warten: 'warten müssen', kaputt: 'etwas kaputt', laenger: 'länger gearbeitet' };
/** «länger» (alte Daten) erklärt den langen Tag — kein eigener Hinweis. */
const laengerOhneKunde = (tm: { abweichung_typ: string | null; wer_hats_gewollt: string | null }) => tm.abweichung_typ === 'laenger' && tm.wer_hats_gewollt !== 'kunde';
/** Überstunden sind der Hinweis: der Bauführer liest die Sprachnotiz und gibt frei. Ob etwas verrechnet wird, entscheidet er in SORBA (20.09.). */
const hatUeberstunden = (e: { ueber_min: number; tagesmeldung: { normalfall: boolean } }) => e.tagesmeldung.normalfall && e.ueber_min > 0;
const SPRACHE: Record<string, string> = { de: 'Deutsch', sq: 'Albanisch', pt: 'Portugiesisch', it: 'Italienisch', fr: 'Französisch', ar: 'Arabisch', pl: 'Polnisch', en: 'Englisch' };
/** Normaler Tag + Abweichung sind zwei Meldungen und richtig so. Verdächtig ist nur: der normale Tag mehrfach. */
function doppelteNormalmeldungen(liste: Eintrag[]): number {
  return new Set(liste.filter((e) => e.tagesmeldung.normalfall).map((e) => e.tagesmeldung.id)).size;
}
const ZEHN_STUNDEN_MIN = 600;
/** Rang für «schlechtester Status des Tages» und für die Sortierung der Teams. */
const RANG: Record<ZellStatus, number> = { rot: 4, gelb: 3, gruen: 2, frei: 1, leer: 0 };

function kurzName(name: string): string {
  const teile = name.trim().split(' ');
  return teile.length > 1 ? `${teile[0][0]}. ${teile.slice(1).join(' ')}` : name;
}

/** Wort zum Stand, direkt in der Zelle. Mit Regie heisst «gelb» eine offene Frage an den Bauführer, nicht nur Überstunden. */
const zellWort = (st: ZellStatus, regie: boolean): string =>
  ({ leer: '', gruen: 'offen', frei: 'freigegeben ✓', gelb: regie ? 'Regieverdacht' : 'Überstunden', rot: 'über 10 h' })[st];

/**
 * Tageszelle im Raster: Farbe = Stand. 06.10.2026 wie die Team-Kacheln — Tage mit Meldung sind Kacheln
 * mit kräftiger Zahl und Status-Punkt, leere Tage treten zurück (vorher eine Reihe grauer Kästen, in der
 * der eine offene Tag unterging). «Offen» ist blau wie «gemeldet» beim Vorarbeiter.
 */
const ZELLE: Record<ZellStatus, { kachel: string; rand: string; punkt: string; wort: string }> = {
  leer: { kachel: 'border border-dashed border-ink/[0.10] bg-transparent', rand: '', punkt: '', wort: '' },
  gruen: { kachel: 'bg-white text-ink shadow-[0_1px_2px_rgb(17_17_19/0.05),0_6px_14px_-10px_rgb(17_17_19/0.35)]', rand: 'ring-1 ring-line-strong hover:ring-steel/60', punkt: 'bg-steel', wort: 'text-steel' },
  frei: { kachel: 'bg-gradient-to-br from-white to-[#dcf2e5] text-good-deep', rand: 'ring-1 ring-good/30 hover:ring-good/60', punkt: 'bg-good', wort: 'text-good-deep' },
  gelb: { kachel: 'bg-gradient-to-br from-white to-[#fbe3a6] text-ink', rand: 'ring-1 ring-amber/50 hover:ring-amber', punkt: 'bg-amber', wort: 'text-amber-deep' },
  rot: { kachel: 'bg-gradient-to-br from-white to-[#f9d8d1] text-ink', rand: 'ring-1 ring-accent/45 hover:ring-accent', punkt: 'bg-accent', wort: 'text-accent-deep' },
};

export function Cockpit() {
  // Montag/Dienstag prüft der Bauführer die Vorwoche (Arbnor, 27.08.) — dann dort starten, nicht in der leeren neuen Woche
  // Aufruf mit ?woche=JJJJ-MM-TT&team=<id> (z. B. aus der Tagesübersicht) springt direkt dorthin.
  const params = new URLSearchParams(window.location.search);
  // Firmen-Schalter: mit Regie wird aus dem Hinweis eine Entscheidung
  const regie = einstellungen().erfassung === 'regie';
  // Herkunft «aus einem Regierapport» — der Weg zurück muss sichtbar bleiben
  const herkunftRapport = params.get('rapport');
  const [wochenStart, setWochenStart] = useState<Date>(() => {
    const w = params.get('woche');
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) return montag(new Date(w + 'T12:00:00'));
    const heute = new Date();
    const dieseWoche = montag(heute);
    return heute.getDay() === 1 || heute.getDay() === 2 ? addTage(dieseWoche, -7) : dieseWoche;
  });
  const istAktuelleWoche = iso(wochenStart) === iso(montag(new Date()));
  const istVorwoche = iso(wochenStart) < iso(montag(new Date()));
  // Freigabe im Wochenrhythmus: das Wochenblatt wird am Wochenende abgegeben, der Bauführer prüft Mo/Di.
  // Solange die Woche läuft, gibt es keine Sammelfreigabe — Einzelfälle bleiben im Detail möglich.
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  // Freigeben und korrigieren tut der Bauführer — das Sekretariat schaut nur.
  const darfFreigeben = useAnsicht() === 'bauf';
  const [laedt, setLaedt] = useState(true);
  const [ladeFehler, setLadeFehler] = useState('');
  // Rückmeldung nach Freigeben/Korrigieren — vorher passierte bei einem Klick manchmal wortlos nichts
  const [rueckmeldung, setRueckmeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null);
  // Laufende Korrektur: erst Wert einstellen, dann Grund wählen, dann speichern (Regel #7: warum)
  const [korrektur, setKorrektur] = useState<{ id: string; total: number; alt: number; team?: { meldungId: string; datum: string; teamName: string } } | null>(null);
  const [speichert, setSpeichert] = useState(false);
  // Wochenwahl: Klick auf «KW 36» öffnet eine Liste aller Wochen des Jahres — statt zwanzigmal ‹ zu drücken
  const [wochenwahlOffen, setWochenwahlOffen] = useState(false);
  const wochenwahlRef = useRef<HTMLDivElement | null>(null);
  const gewaehlteWocheRef = useRef<HTMLButtonElement | null>(null);
  const wochenListe = useMemo(() => {
    // Alle Wochen des Jahres: ISO-KW 1 ist die Woche mit dem 4. Januar, die letzte enthält den 28. Dezember
    const jahr = wochenStart.getFullYear();
    const erste = montag(new Date(jahr, 0, 4, 12));
    const ende = montag(new Date(jahr, 11, 28, 12));
    const liste: Date[] = [];
    for (let d = erste; d <= ende; d = addTage(d, 7)) liste.push(d);
    return liste;
  }, [wochenStart]);
  useEffect(() => {
    if (!wochenwahlOffen) return;
    gewaehlteWocheRef.current?.scrollIntoView({ block: 'center' });
    const zu = (ev: MouseEvent) => { if (wochenwahlRef.current && !wochenwahlRef.current.contains(ev.target as Node)) setWochenwahlOffen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setWochenwahlOffen(false); };
    document.addEventListener('mousedown', zu);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('keydown', esc); };
  }, [wochenwahlOffen]);
  // Transkription auf Knopfdruck (Aufnahmen von vor dem Einbau, oder nach einem Fehler)
  const [transkribiert, setTranskribiert] = useState<Set<string>>(new Set());
  async function transkribieren(meldungId: string) {
    if (!supabase) return;
    setTranskribiert((s) => new Set(s).add(meldungId));
    const { data, error } = await supabase.functions.invoke('transkribieren', { body: { tagesmeldung_id: meldungId, erneut: true } });
    const f = (data as { fehler?: string } | null)?.fehler ?? error?.message;
    if (f) melden('Text konnte nicht erstellt werden: ' + f, 'fehler');
    setTranskribiert((s) => { const n = new Set(s); n.delete(meldungId); return n; });
    void laden();
  }
  const [teams, setTeams] = useState<Team[]>([]);
  // Standard «Zu tun»: nur Teams mit Hinweis. Kommt man gezielt zu einem Team oder Tag (Tagesübersicht, Rapport,
  // Freigabe-Karte der Übersicht), alle zeigen.
  const [filter, setFilter] = useState<Filter>(() => (params.get('team') || params.get('tag') ? 'alle' : 'zutun'));
  // ?tag ohne Team (Freigabe-Karte der Übersicht, 08.10.2026): den ganzen Tag markieren — Spalte im Kopf und die
  // Zellen aller Teams. Amir: «sonst macht es keinen Sinn, dass man pro Tag klicken kann und dann die ganze Woche sieht».
  const [markTag, setMarkTag] = useState<string | null>(() => (!params.get('team') && params.get('tag')) || null);
  // Aufgeklappter Tag eines Teams — die Tagesübersicht springt mit ?team&tag direkt hinein
  const [offen, setOffen] = useState<{ team: string; datum: string } | null>(() => {
    const t = params.get('team');
    const d = params.get('tag');
    return t && d ? { team: t, datum: d } : null;
  });
  const [audio, setAudio] = useState<{ meldung: string; url: string } | null>(null);
  // «Keine Regie»: der Bauführer schliesst einen Hinweis ohne Rapport ab — mit Grund. Die Stunden bleiben.
  const [keineRegieFrage, setKeineRegieFrage] = useState<string | null>(null);
  // Herkunft «aus der Tagesübersicht»: markierte Meldung, und das Team ins Bild scrollen
  const markierteMeldung = params.get('meldung');
  const zielRef = useRef<HTMLDivElement | null>(null);
  const gescrollt = useRef(false);
  useEffect(() => {
    if (laedt || gescrollt.current || !zielRef.current) return;
    gescrollt.current = true;
    zielRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [laedt]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung,chefmonteur:chefmonteur_id(name)').eq('aktiv', true).then(({ data }) => {
      if (!data) return;
      const s = (data as unknown as Team[]).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }));
      setTeams(s);
    });
  }, []);

  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  const laden = useCallback(async () => {
    if (!supabase) return;
    setLaedt(true);
    const c = supabase;
    // Transkript-Spalten kommen mit Migration 0009, Zeiten von–bis mit 0016 — fehlen sie noch, ohne sie laden statt gar nicht
    const auswahl = (mitTranskript: boolean, mitZeiten: boolean) =>
      'id,normal_min,ueber_min,status,' + (mitZeiten ? 'von_min,bis_min,von2_min,bis2_min,' : '') +
      'freigabe_log(feld,alt,neu,begruendung,wann),mitarbeiter:mitarbeiter_id(id,name,funktion,typ),tagesmeldung:tagesmeldung_id!inner(id,datum,normalfall,abweichung_typ,wer_hats_gewollt,transkript,' +
      (mitTranskript ? 'transkript_quelle,transkript_sprache,transkript_fehler,' : '') +
      'audio_pfad,audio_sekunden,' + (regie ? 'regie_entscheid,regie_grund,' : '') +
      'team:team_id(id,bezeichnung),baustelle:baustelle_id(id,konto_nr,bezeichnung),foto(id,pfad)' +
      (regie ? ',regierapport(id,status,nummer)' : '') + ')';
    const eintraegeLaden = async () => {
      const lade = (t: boolean, z: boolean) => c.from('zeiteintrag').select(auswahl(t, z)).gte('tagesmeldung.datum', vonIso).lte('tagesmeldung.datum', bisIso);
      let mitTranskript = true;
      let mitZeiten = true;
      for (let versuch = 0; versuch < 3; versuch++) {
        const erg = await lade(mitTranskript, mitZeiten);
        if (erg.error && mitZeiten && /(von2?_min|bis2?_min) does not exist/.test(erg.error.message)) { mitZeiten = false; continue; }
        if (erg.error && mitTranskript && /transkript_\w+ does not exist/.test(erg.error.message)) { mitTranskript = false; continue; }
        return erg;
      }
      return lade(false, false);
    };
    const z = await eintraegeLaden();
    if (z.error) setLadeFehler(z.error.message);
    else { setLadeFehler(''); setEintraege((z.data ?? []) as unknown as Eintrag[]); }
    setLaedt(false);
  }, [vonIso, bisIso, regie]);

  useEffect(() => {
    void laden();
  }, [laden]);

  async function anhoeren(meldungId: string, pfad: string) {
    if (!supabase) return;
    const { data } = await supabase.storage.from('anhaenge').createSignedUrl(pfad, 300);
    if (data?.signedUrl) setAudio({ meldung: meldungId, url: data.signedUrl });
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Matrix: Person → Tag → Einträge (mit Team-Zuordnung)
  const personen = useMemo(() => {
    const m = new Map<
      string,
      { name: string; typ: string; funktion: string; teamId: string; teamName: string; tage: Map<string, Eintrag[]> }
    >();
    for (const e of eintraege) {
      const p =
        m.get(e.mitarbeiter.id) ??
        { name: e.mitarbeiter.name, typ: e.mitarbeiter.typ, funktion: e.mitarbeiter.funktion, teamId: e.tagesmeldung.team?.id ?? '', teamName: e.tagesmeldung.team?.bezeichnung ?? 'ohne Team', tage: new Map() };
      const liste = p.tage.get(e.tagesmeldung.datum) ?? [];
      liste.push(e);
      p.tage.set(e.tagesmeldung.datum, liste);
      m.set(e.mitarbeiter.id, p);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [eintraege]);

  /**
   * Personen-Tage (`id|datum`), deren Überstunden gelb werden — erst ab «Gelb markieren ab» der Firma (09.10.2026,
   * Gerüst GmbH 9.0 h Tagestotal). Darunter sieht der Tag aus wie jeder andere; im Lohn zählen die Überstunden trotzdem.
   */
  const gelb = useMemo(
    () => gelbePersonen(eintraege.map((e) => ({ person: `${e.mitarbeiter.id}|${e.tagesmeldung.datum}`, normal_min: e.normal_min, ueber_min: e.ueber_min }))),
    [eintraege],
  );
  const ueberGelb = (e: Eintrag) => hatUeberstunden(e) && gelb.has(`${e.mitarbeiter.id}|${e.tagesmeldung.datum}`);

  /**
   * Team + Tag + Baustelle, für die schon ein Regierapport oder ein «Keine Regie»-Entscheid existiert —
   * egal an welcher Meldung. Alte Daten haben denselben Tag zweimal (normaler Tag mit Überstunden +
   * Abweichung mit Rapport); der Rapport gilt für beide (Entscheid 15.09.).
   */
  const beantwortet = useMemo(() => {
    const m = new Set<string>();
    if (!regie) return m;
    for (const e of eintraege) {
      const tm = e.tagesmeldung;
      if ((tm.regierapport?.length ?? 0) > 0 || tm.regie_entscheid) m.add(`${tm.team?.id}|${tm.datum}|${tm.baustelle?.id}`);
    }
    return m;
  }, [eintraege, regie]);
  const schluessel = (e: Eintrag) => `${e.tagesmeldung.team?.id}|${e.tagesmeldung.datum}|${e.tagesmeldung.baustelle?.id}`;
  /** Im Regie-Modus ist ein Hinweis erledigt, sobald ein Rapport oder ein Entscheid dazu existiert. */
  const regieBeantwortet = (e: Eintrag) =>
    regie && ((e.tagesmeldung.regierapport?.length ?? 0) > 0 || !!e.tagesmeldung.regie_entscheid || beantwortet.has(schluessel(e)));

  function zellStatus(liste: Eintrag[] | undefined): ZellStatus {
    if (!liste || liste.length === 0) return 'leer';
    // Freigegeben = der Bauführer hat es angeschaut — dann ist der Hinweis erledigt,
    // auch bei Überstunden oder über 10 h. Sonst bliebe das Team ewig unter «Zum Anschauen».
    if (liste.every((e) => e.status === 'freigegeben')) return 'frei';
    const summe = liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
    // Über 10 h ist nur dann ein offener Hinweis, wenn das Team den langen Tag nicht selbst erklärt hat (Überstunden mit Notiz)
    const erklaert = liste.some((e) => e.tagesmeldung.abweichung_typ === 'laenger' || hatUeberstunden(e));
    if (summe > ZEHN_STUNDEN_MIN && !erklaert) return 'rot';
    // Überstunden ab «Gelb markieren ab» (oder eine Abweichung) = Hinweis: der Bauführer liest die Notiz, prüft die
    // Stunden, gibt frei. Im Regie-Modus fällt der Hinweis weg, sobald ein Rapport oder ein «keine Regie» dazu steht.
    const hinweis = liste.some(
      (e) => !regieBeantwortet(e) && (ueberGelb(e) || (e.tagesmeldung.abweichung_typ !== null && !laengerOhneKunde(e.tagesmeldung))),
    );
    if (hinweis) return 'gelb';
    return 'gruen';
  }

  // Hinweise: eine Karte pro Tagesmeldung mit Überstunden (oder Abweichung aus alten Daten) — Notiz, Fotos, Stunden
  const verdachtsfaelle = useMemo(() => {
    const gesehen = new Set<string>();
    const faelle: {
      meldung: Eintrag['tagesmeldung']; eintraege: Eintrag[]; ausloeser: string[]; geprueft: boolean; info: boolean;
      /** nur Regie-Modus */ rapport: { id: string; status: string; nummer: string | null } | null; keineRegie: string | null;
    }[] = [];
    for (const e of eintraege) {
      const tm = e.tagesmeldung;
      if (gesehen.has(tm.id)) continue;
      const ausloeser: string[] = [];
      const meldungEintraege = eintraege.filter((x) => x.tagesmeldung.id === tm.id);
      const ueberMin = meldungEintraege.reduce((s, x) => s + x.ueber_min, 0);
      // Eine Karte erst ab «Gelb markieren ab» — darunter steht die Notiz als «Bemerkung zum Tag» da
      const ueberHinweis = meldungEintraege.some(ueberGelb);
      // «länger» ohne Kunden (alte Meldungen): die Erklärung für den langen Tag — als ruhige Infokarte
      const info = laengerOhneKunde(tm);
      if (tm.abweichung_typ && !info) ausloeser.push(`Team meldet «${ABWEICHUNG_KURZ[tm.abweichung_typ] ?? tm.abweichung_typ}»`);
      if (tm.wer_hats_gewollt === 'kunde') ausloeser.push('Team: der Kunde wollte es');
      if (ueberHinweis) ausloeser.push(`Team meldet ${stunden(ueberMin)} h Überstunden${tm.transkript || tm.audio_pfad ? ' — Sprachnotiz unten' : ''}`);
      if (laengerOhneKunde(tm)) ausloeser.push('Team meldet «länger gearbeitet»', tm.wer_hats_gewollt === 'chef' ? 'unser Chef wollte es' : 'niemand hat es verlangt');
      if (ausloeser.length === 0) continue;
      // Regie-Modus: hat eine andere Meldung desselben Team-Tags auf derselben Baustelle schon einen Rapport,
      // braucht dieser normale Tag keine eigene Karte mehr — sonst stünde die Frage zweimal.
      if (regie && ueberHinweis && (tm.regierapport?.length ?? 0) === 0 && !tm.regie_entscheid
          && beantwortet.has(`${tm.team?.id}|${tm.datum}|${tm.baustelle?.id}`)) continue;
      gesehen.add(tm.id);
      faelle.push({
        meldung: tm,
        eintraege: meldungEintraege,
        ausloeser,
        // alle Stunden dieser Meldung freigegeben → der Bauführer hat es angeschaut
        geprueft: meldungEintraege.length > 0 && meldungEintraege.every((x) => x.status === 'freigegeben'),
        info,
        rapport: tm.regierapport?.[0] ?? null,
        keineRegie: tm.regie_entscheid === 'keine_regie' ? (REGIE_GRUND[tm.regie_grund ?? ''] ?? 'ohne Grund') : null,
      });
    }
    return faelle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eintraege, regie, beantwortet, gelb]);

  const wochenTage = useMemo(() => TAGE.map((_, i) => iso(addTage(wochenStart, i))), [wochenStart]);

  /**
   * Eine Zeile pro Team, sieben Tageszellen (Teamsumme + Stand), dazu was noch offen ist.
   * Teams ohne Meldung stehen auch drin — die fehlen sonst.
   */
  const teamZeilen = useMemo(() => {
    type Tag = { datum: string; min: number; status: ZellStatus; eintraege: Eintrag[]; offen: Eintrag[] };
    type Zeile = {
      team: Team;
      tage: Tag[];
      alle: Eintrag[];
      /** offene Einträge in Tagen ohne Hinweis — das gibt «Woche freigeben» frei */
      gruene: Eintrag[];
      gruenTage: number;
      hinweisTage: number;
      offenTage: number;
      totalMin: number;
      rang: number;
    };
    const zeilen: Zeile[] = teams.map((team) => {
      const leute = personen.filter(([, p]) => p.teamId === team.id);
      const tage: Tag[] = wochenTage.map((datum) => {
        let min = 0;
        let status: ZellStatus = 'leer';
        const eintraegeTag: Eintrag[] = [];
        for (const [, p] of leute) {
          const liste = p.tage.get(datum);
          if (!liste) continue;
          eintraegeTag.push(...liste);
          min += liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
          const st = zellStatus(liste);
          if (RANG[st] > RANG[status]) status = st;
        }
        return { datum, min, status, eintraege: eintraegeTag, offen: eintraegeTag.filter((e) => e.status === 'offen') };
      });
      const alle = tage.flatMap((t) => t.eintraege);
      const gruene = tage.filter((t) => t.status === 'gruen').flatMap((t) => t.offen);
      const gruenTage = tage.filter((t) => t.status === 'gruen').length;
      const hinweisTage = tage.filter((t) => t.status === 'gelb' || t.status === 'rot').length;
      const offenTage = tage.filter((t) => t.offen.length > 0).length;
      const totalMin = alle.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
      const rang = hinweisTage > 0 ? 0 : alle.length === 0 ? 3 : offenTage > 0 ? 1 : 2;
      return { team, tage, alle, gruene, gruenTage, hinweisTage, offenTage, totalMin, rang };
    });
    // Immer Team 1 … 20 der Reihe nach — die Farbe zeigt den Stand, der Filter «Zum Anschauen» blendet den Rest aus
    return zeilen.sort((a, b) => a.team.bezeichnung.localeCompare(b.team.bezeichnung, 'de', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, personen, wochenTage]);

  const zaehler = useMemo(() => ({
    gemeldet: teamZeilen.filter((z) => z.alle.length > 0).length,
    anschauen: teamZeilen.filter((z) => z.rang === 0).length,
    gruenTage: teamZeilen.reduce((s, z) => s + z.gruenTage, 0),
    hinweisTage: teamZeilen.reduce((s, z) => s + z.hinweisTage, 0),
    offenTage: teamZeilen.reduce((s, z) => s + z.offenTage, 0),
  }), [teamZeilen]);

  // «Zum Anschauen» leer → alles zeigen, sonst steht der Bauführer vor einer leeren Seite
  const sichtbar = useMemo(
    () => (filter === 'zutun' && zaehler.anschauen > 0 ? teamZeilen.filter((z) => z.rang === 0) : teamZeilen),
    [teamZeilen, filter, zaehler.anschauen],
  );

  // Der eine Knopf gilt für die ganze Woche, nicht nur für die sichtbaren Teams
  const gruene = useMemo(() => teamZeilen.flatMap((z) => z.gruene), [teamZeilen]);

  /** «Keine Regie»: Entscheid mit Grund festhalten. Die Stunden bleiben im Lohn, nur die Verrechnung entfällt. */
  async function keineRegie(meldungId: string, grund: string) {
    if (!supabase) return;
    const { error } = await supabase
      .from('tagesmeldung')
      .update({ regie_entscheid: 'keine_regie', regie_grund: grund, regie_entschieden_am: new Date().toISOString(), regie_entschieden_von: userId })
      .eq('id', meldungId);
    if (error) { melden('Konnte nicht gespeichert werden: ' + error.message, 'fehler'); return; }
    setKeineRegieFrage(null);
    melden('Als «keine Regie» abgeschlossen ✓ — die Stunden bleiben');
    void laden();
  }
  /** Entscheid zurücknehmen — der Hinweis ist wieder offen. */
  async function dochRegie(meldungId: string) {
    if (!supabase) return;
    const { error } = await supabase
      .from('tagesmeldung')
      .update({ regie_entscheid: null, regie_grund: null, regie_entschieden_am: null, regie_entschieden_von: null })
      .eq('id', meldungId);
    if (error) { melden('Konnte nicht zurückgenommen werden: ' + error.message, 'fehler'); return; }
    melden('Wieder offen — der Hinweis steht erneut da');
    void laden();
  }

  /** Was der Kunde zahlen würde, zum SGUV-Ansatz der Funktion. Nur eine Vorrechnung, nie eine Rechnung. */
  function betragVorgerechnet(liste: Eintrag[]): number {
    return liste.reduce((sum, e) => {
      let ansatz = RUECKFALL_ANSATZ_RAPPEN;
      try {
        ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
      } catch {
        /* unbekannte Funktion → Monteursansatz */
      }
      return sum + minutenBetrag(e.normal_min + e.ueber_min, ansatz);
    }, 0);
  }

  function melden(text: string, art: 'ok' | 'fehler' = 'ok') {
    setRueckmeldung({ text, art });
    window.setTimeout(() => setRueckmeldung((r) => (r?.text === text ? null : r)), art === 'ok' ? 4000 : 8000);
  }
  /** RPC fehlt noch (Migration 0009 nicht eingespielt)? Dann der bisherige zweistufige Weg. */
  function rpcFehlt(err: { code?: string; message: string } | null): boolean {
    return !!err && (err.code === '42883' || err.code === 'PGRST202' || /function .* does not exist|Could not find the function/i.test(err.message));
  }

  async function freigeben(liste: Eintrag[], was = 'Einträge') {
    if (!supabase || !userId || liste.length === 0 || speichert) return;
    setSpeichert(true);
    const ids = liste.filter((e) => e.status === 'offen').map((e) => e.id);
    const { error } = await supabase.rpc('zeit_freigeben', { p_ids: ids, p_wer: userId, p_grund: null });
    if (error && rpcFehlt(error)) {
      const u = await supabase.from('zeiteintrag').update({ status: 'freigegeben' }).in('id', ids);
      const l = u.error ? { error: u.error } : await supabase.from('freigabe_log').insert(
        liste.map((e) => ({ zeiteintrag_id: e.id, wer: userId, feld: 'status', alt: e.status, neu: 'freigegeben' })),
      );
      if (u.error || l.error) melden('Freigabe fehlgeschlagen: ' + (u.error ?? l.error)!.message, 'fehler');
      else melden(`${was} freigegeben ✓`);
    } else if (error) {
      melden('Freigabe fehlgeschlagen: ' + error.message, 'fehler');
    } else {
      melden(`${was} freigegeben ✓`);
    }
    setSpeichert(false);
    void laden();
  }

  /** Korrektur in Gesamtminuten (Normal + Über), am normalen Arbeitstag der Firma aufgeteilt — wie die Erfassung. */
  function aufteilen(total: number): { normal_min: number; ueber_min: number } {
    return aufteilenTag(total, normaltagMin());
  }
  function korrekturStarten(e: Eintrag, deltaMin: number) {
    setKorrektur((k) => {
      const basis = k && k.id === e.id ? k.total : e.normal_min + e.ueber_min;
      return { id: e.id, alt: e.normal_min + e.ueber_min, total: Math.max(0, basis + deltaMin) };
    });
  }
  /** Speichern mit Pflichtgrund — wer, wann, von, auf UND warum (Regel #7). */
  async function korrekturSpeichern(e: Eintrag, grund: string) {
    if (!supabase || !userId || !korrektur || korrektur.id !== e.id || speichert) return;
    if (korrektur.total === korrektur.alt) { setKorrektur(null); return; }
    setSpeichert(true);
    const { error } = await supabase.rpc('zeit_korrigieren', { p_id: e.id, p_total_min: korrektur.total, p_wer: userId, p_grund: grund });
    if (error && rpcFehlt(error)) {
      const neu = aufteilen(korrektur.total);
      const u = await supabase.from('zeiteintrag').update(neu).eq('id', e.id);
      const logs = [
        ...(neu.normal_min !== e.normal_min ? [{ zeiteintrag_id: e.id, wer: userId, feld: 'normal_min', alt: String(e.normal_min), neu: String(neu.normal_min), begruendung: grund }] : []),
        ...(neu.ueber_min !== e.ueber_min ? [{ zeiteintrag_id: e.id, wer: userId, feld: 'ueber_min', alt: String(e.ueber_min), neu: String(neu.ueber_min), begruendung: grund }] : []),
      ];
      const l = u.error || logs.length === 0 ? { error: u.error } : await supabase.from('freigabe_log').insert(logs);
      if (u.error || l.error) melden('Korrektur fehlgeschlagen: ' + (u.error ?? l.error)!.message, 'fehler');
      else melden(`${e.mitarbeiter.name}: ${stunden(korrektur.alt)} → ${stunden(korrektur.total)} h gespeichert ✓`);
    } else if (error) {
      melden('Korrektur fehlgeschlagen: ' + error.message, 'fehler');
    } else {
      melden(`${e.mitarbeiter.name}: ${stunden(korrektur.alt)} → ${stunden(korrektur.total)} h gespeichert ✓`);
    }
    setSpeichert(false);
    setKorrektur(null);
    void laden();
  }
  /** Ganzes Team an einem Tag auf denselben Wert — statt 3 × 4 Aufklappvorgänge. */
  async function teamSetzen(liste: Eintrag[], total: number, grund: string) {
    if (!supabase || !userId || liste.length === 0 || speichert) return;
    setSpeichert(true);
    const meldungen = [...new Set(liste.map((e) => e.tagesmeldung.id))];
    let fehler = '';
    for (const mid of meldungen) {
      const { error } = await supabase.rpc('zeit_team_setzen', { p_tagesmeldung_id: mid, p_total_min: total, p_wer: userId, p_grund: grund });
      if (error && rpcFehlt(error)) {
        for (const e of liste.filter((x) => x.tagesmeldung.id === mid && x.status === 'offen')) {
          const neu = aufteilen(total);
          const u = await supabase.from('zeiteintrag').update(neu).eq('id', e.id);
          if (u.error) { fehler = u.error.message; continue; }
          await supabase.from('freigabe_log').insert({ zeiteintrag_id: e.id, wer: userId, feld: 'normal_min', alt: String(e.normal_min), neu: String(neu.normal_min), begruendung: grund });
        }
      } else if (error) fehler = error.message;
    }
    if (fehler) melden('Nicht alle gespeichert: ' + fehler, 'fehler');
    else melden(`Team auf ${stunden(total)} h gesetzt ✓`);
    setSpeichert(false);
    setKorrektur(null);
    void laden();
  }

  /** Der aufgeklappte Tag: alle Einträge des Teams an diesem Datum, nach Name. */
  const detail = useMemo(
    () => (offen
      ? eintraege.filter((e) => e.tagesmeldung.team?.id === offen.team && e.tagesmeldung.datum === offen.datum)
      : []
    ).slice().sort((a, b) => a.mitarbeiter.name.localeCompare(b.mitarbeiter.name) || Number(b.tagesmeldung.normalfall) - Number(a.tagesmeldung.normalfall)),
    [eintraege, offen],
  );

  function tagUmschalten(team: string, datum: string) {
    setKorrektur(null);
    // Player zurücksetzen — sonst spielt die zuletzt gehörte Notiz beim Zurückwechseln
    // auf ihren Tag ungefragt wieder los (autoPlay gilt nur für den Klick auf ▶)
    setAudio(null);
    setOffen((o) => (o && o.team === team && o.datum === datum ? null : { team, datum }));
  }

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'zutun', label: 'Zum Anschauen', n: zaehler.anschauen },
    { key: 'alle', label: 'Alle Teams', n: teamZeilen.length },
  ];

  const tagName = (d: string) => `${TAGE[(new Date(d + 'T12:00:00').getDay() + 6) % 7]} ${ch(new Date(d + 'T12:00:00'))}`;

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-tight lg:text-[28px]">Wochenübersicht</h1>
            {!laedt && teams.length > 0 && (
              <p className="mt-1 text-sm text-ink3">
                {istVorwoche ? 'Vorwoche' : istAktuelleWoche ? 'Diese Woche' : 'Woche'} · {zaehler.gemeldet} von {teams.length} Teams gemeldet
                {zaehler.anschauen > 0
                  ? <> · <span className="font-medium text-accent-deep">{zaehler.anschauen} zum Anschauen</span></>
                  : eintraege.length > 0 ? <> · nichts zum Anschauen</> : null}
              </p>
            )}
          </div>
          {/* Wochenwahl als ein Element: Pfeil · KW und Zeitraum · Pfeil */}
          <div ref={wochenwahlRef} className="relative shrink-0">
            <div className="inline-flex items-stretch overflow-hidden rounded-xl border border-line-strong bg-surface">
              <button type="button" className="px-3 text-ink2 transition-colors hover:bg-surface-2" onClick={() => setWochenStart(addTage(wochenStart, -7))} aria-label="Vorherige Woche">‹</button>
              <button
                type="button"
                className="border-x border-line px-3.5 py-2 text-sm whitespace-nowrap transition-colors hover:bg-surface-2"
                onClick={() => setWochenwahlOffen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={wochenwahlOffen}
                title="Woche wählen"
              >
                <span className="font-semibold">KW {kw(wochenStart)}</span>
                <span className="text-ink3"> · {ch(wochenStart)} – {ch(addTage(wochenStart, 6))}</span>
                <span className="ml-1.5 text-ink3" aria-hidden="true">▾</span>
              </button>
              <button type="button" className="px-3 text-ink2 transition-colors hover:bg-surface-2" onClick={() => setWochenStart(addTage(wochenStart, 7))} aria-label="Nächste Woche">›</button>
            </div>
            {wochenwahlOffen && (
              <div role="listbox" className="absolute right-0 z-30 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-[0_8px_30px_rgb(26_25_23/0.12)]">
                {wochenListe.map((d) => {
                  const aktiv = iso(d) === iso(wochenStart);
                  const heute = iso(d) === iso(montag(new Date()));
                  const zukunft = d > montag(new Date());
                  return (
                    <button
                      key={iso(d)}
                      ref={aktiv ? gewaehlteWocheRef : undefined}
                      type="button"
                      role="option"
                      aria-selected={aktiv}
                      onClick={() => { setWochenStart(d); setWochenwahlOffen(false); }}
                      className={'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ' + (aktiv ? 'bg-accent-soft text-accent-deep' : zukunft ? 'text-ink3 hover:bg-surface-2' : 'hover:bg-surface-2')}
                    >
                      <span className={aktiv ? 'font-semibold' : 'font-medium'}>KW {kw(d)}</span>
                      <span className="tabular-nums text-ink3">{ch(d)} – {ch(addTage(d, 6))}{heute ? ' · jetzt' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </header>

        {rueckmeldung && (
          <p role="status" className={'rounded-[12px] border px-4 py-2.5 text-sm font-semibold ' + (rueckmeldung.art === 'ok' ? 'border-good/40 bg-good-soft text-good-deep' : 'border-accent/40 bg-accent-soft text-accent-deep')}>
            {rueckmeldung.text}
          </p>
        )}
        {ladeFehler && (
          <p className="flex items-center justify-between gap-3 rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-accent-deep">
            <span>Woche konnte nicht geladen werden: {ladeFehler}</span>
            <button type="button" className="btn-ghost shrink-0" onClick={() => void laden()}>Nochmals</button>
          </p>
        )}
        {regie && herkunftRapport && (
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-steel/40 bg-steel-soft px-4 py-2.5 text-sm">
            <span>Sicht aus dem Regierapport</span>
            <Link to={`/regie/${herkunftRapport}`} className="shrink-0 font-semibold text-steel">‹ zurück zum Rapport</Link>
          </div>
        )}

        {/* Stand der Woche in einer Zeile — und der eine Knopf für alles, was keinen Hinweis hat */}
        {!laedt && eintraege.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[14px] border border-line bg-surface px-4 py-3">
            <p className="text-sm">
              {zaehler.offenTage === 0 ? (
                <span className="font-semibold text-good-deep">✓ Alles freigegeben</span>
              ) : (
                <>
                  <span className="font-semibold">{zaehler.gruenTage} {zaehler.gruenTage === 1 ? 'Tag' : 'Tage'}</span>
                  <span className="text-ink3"> ohne Hinweis offen</span>
                  {zaehler.hinweisTage > 0 && (
                    <> <span className="text-ink3">·</span> <span className="font-semibold text-amber-deep">{zaehler.hinweisTage} mit Hinweis</span> <span className="text-ink3">— gelbe oder rote Zelle antippen</span></>
                  )}
                </>
              )}
            </p>
            {darfFreigeben && gruene.length > 0 && (
              <button type="button" className="cta cta-good w-auto px-5 py-2.5 text-sm disabled:opacity-60" disabled={!userId || speichert} onClick={() => void freigeben(gruene, `${zaehler.gruenTage} Tage`)}>
                {speichert ? 'Speichert …' : `Alle ${zaehler.gruenTage} Tage ohne Hinweis freigeben`}
              </button>
            )}
            {!darfFreigeben && <span className="text-xs text-ink3">Nur ansehen — freigeben tut der Bauführer.</span>}
          </div>
        )}

        {!laedt && zaehler.anschauen > 0 && (
          <div className="flex gap-6 border-b border-line" role="tablist">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={'-mb-px border-b-2 pb-2.5 text-sm transition-colors duration-150 ' + (filter === c.key ? 'border-accent font-medium text-ink' : 'border-transparent text-ink3 hover:text-ink')}
              >
                {c.label} <span className={'ml-1 tabular-nums ' + (filter === c.key ? 'text-accent-deep' : 'text-ink3')}>{c.n}</span>
              </button>
            ))}
          </div>
        )}

        {laedt ? (
          <div className="card text-sm text-ink3">Lädt …</div>
        ) : teams.length === 0 ? (
          <div className="card text-sm text-ink3">Keine Teams angelegt — Verwaltung → Teams.</div>
        ) : istAktuelleWoche && eintraege.length === 0 ? (
          <div className="card text-sm text-ink3">Noch keine Meldungen in dieser Woche — sie kommen abends von den Teams. Vorwoche: ‹</div>
        ) : sichtbar.length === 0 ? (
          <div className="card text-sm text-ink3">Nichts in dieser Auswahl.</div>
        ) : (
          <>
          {markTag && wochenTage.includes(markTag) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-steel">
                <span className="h-2 w-2 rounded-full bg-steel" aria-hidden="true" />{tagName(markTag)} markiert
              </span>
              <span className="text-ink3">Zelle antippen öffnet den Tag des Teams</span>
              <button type="button" className="text-xs font-semibold text-ink3 underline underline-offset-2 hover:text-ink" onClick={() => setMarkTag(null)}>Markierung aufheben</button>
            </p>
          )}
          <section className="card overflow-hidden p-0">
            {/* Kopfzeile Mo–So wie ein Kalender: Wochentag klein, Datum darunter, heute als rote Pille (08.10.2026);
                ein markierter Tag (Sprung aus der Freigabe-Karte) als blaue Pille */}
            <div className="grid grid-cols-7 gap-1.5 border-b border-line px-4 pb-3 pt-4">
              {wochenTage.map((datum, i) => {
                const heute = datum === iso(new Date());
                const wochenende = i >= 5;
                const markiert = datum === markTag;
                return (
                  <span key={datum} className="flex flex-col items-center gap-1">
                    <span className={'text-[10px] font-semibold uppercase tracking-[0.1em] ' + (markiert ? 'text-steel' : heute ? 'text-accent' : wochenende ? 'text-ink3/60' : 'text-ink3')}>{TAGE[i]}</span>
                    <span className={'rounded-full px-2.5 py-0.5 font-display text-[13px] font-semibold tabular-nums leading-tight ' + (markiert ? (heute ? 'bg-accent text-white ring-2 ring-steel ring-offset-2' : 'bg-steel text-white shadow-[0_4px_10px_-4px_rgb(43_108_176/0.6)]') : heute ? 'bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]' : wochenende ? 'text-ink3/70' : 'text-ink')}>{ch(addTage(wochenStart, i))}</span>
                  </span>
                );
              })}
            </div>

            {sichtbar.map((z) => {
              const auf = offen?.team === z.team.id;
              return (
                <div key={z.team.id} ref={auf ? zielRef : undefined} className={'scroll-mt-20 border-b border-line transition-colors last:border-b-0 ' + (auf ? 'bg-steel-soft/20' : 'hover:bg-surface-2/40')}>
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        {/* Weisse, leicht erhabene Kachel (09.10.2026, Amir: grau wirkte altmodisch) — farblos, weil Blau/Grün/Bernstein schon den Stand der Tage zeigen */}
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-b from-white to-[#f4f2ee] font-display text-[13px] font-bold tabular-nums text-ink shadow-[0_1px_2px_rgb(17_17_19/0.08),0_6px_12px_-8px_rgb(17_17_19/0.35),inset_0_1px_0_#fff] ring-1 ring-ink/[0.07]" aria-hidden="true">{teamKuerzel(z.team.bezeichnung)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-display text-[14px] font-semibold leading-tight">{z.team.bezeichnung}</span>
                          {/* Wochentotal beim Namen, nicht rechts — rechtsbündig wurde es als Sonntagswert gelesen (04.10.2026) */}
                          <span className="block truncate text-xs text-ink3">
                            {z.team.chefmonteur ? kurzName(z.team.chefmonteur.name) : 'ohne Vorarbeiter'}
                            {z.totalMin > 0 && <span className="font-mono tabular-nums"> · {stunden(z.totalMin)} h</span>}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs">
                        {z.alle.length === 0 ? (
                          <span className="text-ink3">keine Meldung</span>
                        ) : darfFreigeben && z.gruene.length > 0 ? (
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-good px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_10px_-4px_rgb(31_157_85/0.6)] transition hover:bg-good-deep disabled:opacity-60" disabled={!userId || speichert} onClick={() => void freigeben(z.gruene, `${z.team.bezeichnung}: ${z.gruenTage} Tage`)}>
                            <Check size={13} strokeWidth={3} aria-hidden="true" />
                            {z.gruenTage} {z.gruenTage === 1 ? 'Tag' : 'Tage'} freigeben
                          </button>
                        ) : z.offenTage === 0 ? (
                          <span className="font-semibold text-good-deep">✓ freigegeben</span>
                        ) : (
                          <span className="font-semibold text-amber-deep">{z.hinweisTage} {z.hinweisTage === 1 ? 'Tag' : 'Tage'} anschauen</span>
                        )}
                      </span>
                    </div>
                    {/* Sieben Zellen: Teamsumme des Tages, Farbe = Stand. Antippen öffnet den Tag. */}
                    <div className="mt-2.5 grid grid-cols-7 gap-1.5">
                      {z.tage.map((t) => {
                        const aktiv = auf && offen?.datum === t.datum;
                        const markiert = t.datum === markTag;
                        return (
                          <button
                            key={t.datum}
                            type="button"
                            disabled={t.status === 'leer'}
                            onClick={() => tagUmschalten(z.team.id, t.datum)}
                            aria-label={`${tagName(t.datum)}: ${t.status === 'leer' ? 'keine Meldung' : stunden(t.min) + ' h'}`}
                            className={'flex min-h-[48px] flex-col items-center justify-center rounded-[12px] px-1 py-1.5 text-center leading-tight transition ' + ZELLE[t.status].kachel + ' ' + (aktiv ? 'ring-2 ring-accent' : markiert ? 'ring-2 ring-steel/70' : ZELLE[t.status].rand)}
                          >
                            {t.status === 'leer' ? null : (
                              <>
                                <span className="font-mono text-[13px] font-semibold tabular-nums">{stunden(t.min)}</span>
                                {/* Das Wort zum Stand steht in der Zelle; am Handy (schmale Zellen) nur die Kurzform */}
                                <span className={'mt-0.5 hidden items-center gap-1 font-sans text-[10px] font-semibold sm:flex ' + ZELLE[t.status].wort}>
                                  <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + ZELLE[t.status].punkt} aria-hidden="true" />
                                  {zellWort(t.status, regie)}
                                </span>
                                <span className={'mt-0.5 block font-sans text-[9px] font-semibold sm:hidden ' + ZELLE[t.status].wort}>{t.status === 'frei' ? '✓' : t.status === 'gelb' ? (regie ? 'Regie?' : 'Über') : t.status === 'rot' ? '>10 h' : 'offen'}</span>
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {auf && detail.length > 0 && (() => {
                    const tag = z.tage.find((t) => t.datum === offen!.datum)!;
                    const faelle = verdachtsfaelle.filter((f) => f.meldung.team?.id === z.team.id && f.meldung.datum === offen!.datum);
                    const baustellen = [...new Map(detail.filter((e) => e.tagesmeldung.baustelle).map((e) => [e.tagesmeldung.baustelle!.konto_nr, e.tagesmeldung.baustelle!])).values()];
                    const mehrereBaustellen = baustellen.length > 1;
                    const personenN = new Set(detail.map((e) => e.mitarbeiter.id)).size;
                    return (
                      <div className="space-y-3 border-t border-line bg-surface px-3 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm">
                            <span className="font-semibold">{tagName(tag.datum)}</span>
                            {baustellen.map((b) => <span key={b.konto_nr} className="ml-2 text-ink2"><span className="knr">{b.konto_nr}</span> {b.bezeichnung ?? ''}</span>)}
                          </p>
                          <p className="font-mono text-xs tabular-nums text-ink3">{stunden(tag.min)} h · {personenN} Pers.</p>
                        </div>

                        {/* Ein Block pro Person, der Name einmal (08.10.2026 — vorher stand jede Person doppelt da, wenn sie
                            neben dem normalen Tag Zusatzarbeit hatte; Amir: «verwirrend mit den doppelten Namen»).
                            Darunter je Eintrag eine Zeile: erst der normale Tag, dann Zusatzarbeit — jede mit eigener Korrektur. */}
                        <div className="divide-y divide-line rounded-[12px] border border-line">
                          {[...detail.reduce((m, e) => m.set(e.mitarbeiter.id, [...(m.get(e.mitarbeiter.id) ?? []), e]), new Map<string, typeof detail>()).values()].map((eintraege) => {
                            const reihe = [...eintraege].sort((a, b) => Number(b.tagesmeldung.normalfall) - Number(a.tagesmeldung.normalfall));
                            const person = reihe[0].mitarbeiter;
                            return (
                              <div key={person.id} className="space-y-1.5 px-3 py-2">
                                {reihe.map((e, i) => (
                                  <div key={e.id} className="flex items-center justify-between gap-2">
                                    <span className="min-w-0 text-sm">
                                      {i === 0 && (
                                        <span className="block truncate font-medium">
                                          {person.name}
                                          {person.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                                        </span>
                                      )}
                                      <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink3">
                                        {mehrereBaustellen && e.tagesmeldung.baustelle && <span className="knr">{e.tagesmeldung.baustelle.konto_nr}</span>}
                                        {e.tagesmeldung.normalfall
                                          ? <>{stunden(e.normal_min)} normal{e.ueber_min > 0 && <span className="font-semibold text-amber-deep"> + {stunden(e.ueber_min)} Überstunden</span>}</>
                                          : <span className="rounded-md bg-amber-soft px-1.5 py-0.5 font-semibold text-amber-deep">
                                              {/* «Zusatzarbeit · zusätzlich gearbeitet» sagte zweimal dasselbe — nur andere Gründe dazuschreiben */}
                                              {e.tagesmeldung.abweichung_typ === 'zusaetzlich' ? 'Zusatzarbeit' : `Zusatzarbeit · ${ABWEICHUNG_KURZ[e.tagesmeldung.abweichung_typ ?? ''] ?? 'Abweichung'}`}
                                            </span>}
                                        {/* Zeiten von–bis, wie das Team sie eingetragen hat — ohne Pausenrechnung (20.09.) */}
                                        {zeitenText(e) && <span className="font-mono tabular-nums text-ink2">· {zeitenText(e)}</span>}
                                      </span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1.5">
                                      {darfFreigeben && e.status === 'offen' && <button type="button" className="btn-ghost px-2.5" onClick={() => korrekturStarten(e, -30)} aria-label={`${person.name}: weniger`}>−</button>}
                                      <span className={'w-12 text-center font-mono text-sm tabular-nums ' + (korrektur?.id === e.id && korrektur.total !== korrektur.alt ? 'font-semibold text-steel' : '')}>
                                        {stunden(korrektur?.id === e.id ? korrektur.total : e.normal_min + e.ueber_min)} h
                                      </span>
                                      {darfFreigeben && e.status === 'offen' && <button type="button" className="btn-ghost px-2.5" onClick={() => korrekturStarten(e, 30)} aria-label={`${person.name}: mehr`}>+</button>}
                                      {e.status === 'offen'
                                        ? <span className="w-7 text-center text-xs text-ink3">offen</span>
                                        : <span className="w-7 text-center text-good" title="freigegeben">✓</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>

                        {korrektur && detail.some((e) => e.id === korrektur.id) && korrektur.total !== korrektur.alt && (
                          <div className="rounded-[10px] border border-steel/40 bg-steel-soft px-3 py-2">
                            <p className="text-xs font-semibold text-steel">
                              {detail.find((e) => e.id === korrektur.id)?.mitarbeiter.name}: {stunden(korrektur.alt)} → {stunden(korrektur.total)} h · Warum?
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {GRUENDE.map((g) => (
                                <button key={g} type="button" disabled={speichert} className="chip px-2.5 py-1 text-xs" onClick={() => void korrekturSpeichern(detail.find((e) => e.id === korrektur.id)!, g)}>{g}</button>
                              ))}
                              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setKorrektur(null)}>Abbrechen</button>
                            </div>
                            {tag.offen.length > 1 && (
                              <p className="mt-2 text-[11px] text-ink3">
                                Gilt der Wert für alle im Team an diesem Tag?{' '}
                                {GRUENDE.slice(0, 2).map((g) => (
                                  <button key={g} type="button" disabled={speichert} className="mr-1 font-semibold text-steel underline underline-offset-2" onClick={() => void teamSetzen(tag.eintraege, korrektur.total, g)}>
                                    alle auf {stunden(korrektur.total)} h ({g})
                                  </button>
                                ))}
                              </p>
                            )}
                          </div>
                        )}

                        {doppelteNormalmeldungen(detail) > new Set(detail.map((e) => e.mitarbeiter.id)).size && (
                          <p className="rounded-[10px] bg-amber-soft px-3 py-2 text-xs text-amber-deep">
                            Der normale Tag wurde mehrfach gemeldet — die Stunden addieren sich. Falls doppelt: im Teamgerät «Frühere ersetzen» wählen.
                          </p>
                        )}

                        {/* Bemerkung zum Tag: Sprachnotiz ohne Überstunden-Karte (seit 20.09. immer möglich; seit 09.10. auch Überstunden
                            unter «Gelb markieren ab»). Meldungen mit Überstunden-Karte zeigen die Notiz dort. */}
                        {[...new Map(detail.filter((e) => (e.tagesmeldung.transkript || e.tagesmeldung.audio_pfad) && !faelle.some((f) => f.meldung.id === e.tagesmeldung.id)).map((e) => [e.tagesmeldung.id, e.tagesmeldung])).values()].map((meldung) => (
                          <div key={meldung.id} className="rounded-[12px] border border-line bg-ground p-3">
                            <p className="font-display text-[14px] font-semibold">
                              Bemerkung zum Tag
                              {mehrereBaustellen && <span className="font-body text-xs font-normal text-ink3"> · {meldung.baustelle?.bezeichnung ?? '—'}</span>}
                            </p>
                            {meldung.transkript ? (
                              <div className="mt-1.5 rounded-[10px] bg-surface px-3 py-2 text-sm text-ink2">
                                <p className="italic">«{meldung.transkript}»</p>
                                {meldung.transkript_quelle && (meldung.transkript_sprache ?? 'de') !== 'de' && (
                                  <details className="mt-1 text-xs text-ink3">
                                    <summary className="cursor-pointer">Original auf {SPRACHE[meldung.transkript_sprache ?? ''] ?? 'anderer Sprache'} · automatisch übersetzt</summary>
                                    <p className="mt-1 italic" dir="auto">{meldung.transkript_quelle}</p>
                                  </details>
                                )}
                              </div>
                            ) : (
                              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink3">
                                {transkribiert.has(meldung.id) ? 'Text wird erstellt …' : meldung.transkript_fehler ? <span className="text-amber-deep">Text konnte nicht erstellt werden.</span> : 'Noch kein Text zur Sprachnotiz.'}
                                {!transkribiert.has(meldung.id) && meldung.audio_pfad && (
                                  <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => void transkribieren(meldung.id)}>Text erstellen</button>
                                )}
                              </p>
                            )}
                            {meldung.audio_pfad && (
                              <div className="mt-2 flex items-center gap-2">
                                <button type="button" onClick={() => void anhoeren(meldung.id, meldung.audio_pfad!)} className="btn-ghost">▶ Sprachnotiz{meldung.audio_sekunden ? ` · ${meldung.audio_sekunden} Sek.` : ''}</button>
                                {audio?.meldung === meldung.id && <audio controls autoPlay src={audio.url} className="h-8 flex-1" />}
                              </div>
                            )}
                          </div>
                        ))}

                        {faelle.map(({ meldung, eintraege: liste, ausloeser, geprueft, info, rapport, keineRegie: keineRegieGrund }) => (
                          <div key={meldung.id} className={'rounded-[12px] border p-3 ' + (rapport || keineRegieGrund || geprueft || info ? 'border-line bg-ground' : 'border-amber/40 bg-amber-soft/60') + (markierteMeldung === meldung.id ? ' ring-2 ring-steel' : '')}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-display text-[14px] font-semibold">
                                {rapport ? 'Regierapport angelegt ✓'
                                  : keineRegieGrund ? 'Keine Regie ✓'
                                  : info ? 'Länger gearbeitet'
                                  : geprueft ? (regie ? 'Regieverdacht geprüft ✓' : 'Überstunden geprüft ✓')
                                  : regie ? 'Regieverdacht' : 'Überstunden — Notiz lesen'}
                                {mehrereBaustellen && <span className="font-body text-xs font-normal text-ink3"> · {meldung.baustelle?.bezeichnung ?? '—'}</span>}
                              </span>
                            </div>
                            <ul className="mt-1 space-y-0.5 text-xs text-ink2">
                              {ausloeser.map((a) => <li key={a}>• {a}</li>)}
                            </ul>
                            {meldung.foto?.length > 0 && (
                              <div className="mt-2">
                                <FotoGalerie pfade={meldung.foto.map((f) => f.pfad)} klein />
                              </div>
                            )}
                            {meldung.transkript && (
                              <div className="mt-2 rounded-[10px] bg-surface px-3 py-2 text-sm text-ink2">
                                <p className="italic">«{meldung.transkript}»</p>
                                {meldung.transkript_quelle && (
                                  <details className="mt-1 text-xs text-ink3">
                                    <summary className="cursor-pointer">{(meldung.transkript_sprache ?? 'de') === 'de' ? 'So wurde es gesprochen · Text ist bereinigt' : `Original auf ${SPRACHE[meldung.transkript_sprache ?? ''] ?? 'anderer Sprache'} · automatisch übersetzt`}</summary>
                                    <p className="mt-1 italic" dir="auto">{meldung.transkript_quelle}</p>
                                  </details>
                                )}
                              </div>
                            )}
                            {!meldung.transkript && meldung.audio_pfad && (
                              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink3">
                                {transkribiert.has(meldung.id)
                                  ? 'Text wird erstellt …'
                                  : meldung.transkript_fehler
                                    ? <span className="text-amber-deep">Text konnte nicht erstellt werden.</span>
                                    : 'Noch kein Text zur Sprachnotiz.'}
                                {!transkribiert.has(meldung.id) && (
                                  <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => void transkribieren(meldung.id)}>Text erstellen</button>
                                )}
                              </p>
                            )}
                            {meldung.audio_pfad && (
                              <div className="mt-2 flex items-center gap-2">
                                {meldung.audio_pfad ? (
                                  <button type="button" onClick={() => void anhoeren(meldung.id, meldung.audio_pfad!)} className="btn-ghost">▶ Sprachnotiz{meldung.audio_sekunden ? ` · ${meldung.audio_sekunden} Sek.` : ''}</button>
                                ) : (
                                  <span className="font-mono text-[11px] text-ink3">Sprachnotiz {meldung.audio_sekunden} Sek. (Demo — keine Aufnahme hinterlegt)</span>
                                )}
                                {audio?.meldung === meldung.id && <audio controls autoPlay src={audio.url} className="h-8 flex-1" />}
                              </div>
                            )}
                            <p className="mt-2 text-sm">
                              {meldung.normalfall
                                ? <>{stunden(liste.reduce((s, e) => s + e.ueber_min, 0))} h Überstunden</>
                                : <>{stunden(liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0))} h {meldung.abweichung_typ === 'laenger' ? 'länger' : 'Zusatzarbeit'}</>}
                              {regie && !info && (
                                <> ·{' '}
                                  <span className="font-mono font-semibold text-accent-deep">
                                    {formatChf(betragVorgerechnet(meldung.normalfall ? liste.map((e) => ({ ...e, normal_min: e.ueber_min, ueber_min: 0 })) : liste))}
                                  </span>
                                  <span className="text-xs text-ink3"> vorgerechnet</span>
                                </>
                              )}
                              {regie && info && <span className="text-xs text-ink3"> · geht in den Lohn, nicht an den Kunden</span>}
                              <span className="text-xs text-ink3"> · {liste.map((e) => `${e.mitarbeiter.name.split(' ').pop()} ${stunden(meldung.normalfall ? e.ueber_min : e.normal_min + e.ueber_min)}`).join(' · ')}</span>
                            </p>
                            {/* Ohne Regie entscheidet der Bauführer in SORBA (20.09.) — die App zeigt nur, was das Team gemeldet hat. */}
                            {regie && (
                              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                                {rapport ? (
                                  <Link to={`/regie/${rapport.id}`} className="btn-ghost shrink-0 border-steel text-steel">
                                    {rapport.nummer ?? 'Regierapport'} · {RAPPORT_STAND[rapport.status] ?? rapport.status} ›
                                  </Link>
                                ) : keineRegieGrund ? (
                                  <span className="flex items-center gap-2 text-xs text-ink2">
                                    <span>keine Regie · {keineRegieGrund}</span>
                                    {darfFreigeben && <button type="button" className="font-semibold text-steel" onClick={() => void dochRegie(meldung.id)}>doch Regie</button>}
                                  </span>
                                ) : info ? (
                                  <Link to={`/regie/neu?meldung=${meldung.id}${meldung.normalfall ? '&nur=ueber' : ''}`} className="shrink-0 text-xs font-semibold text-steel">Doch Regie? Vorrechnen ›</Link>
                                ) : (
                                  <>
                                    {darfFreigeben && (
                                      <button type="button" className="btn-ghost" onClick={() => setKeineRegieFrage(keineRegieFrage === meldung.id ? null : meldung.id)}>Keine Regie …</button>
                                    )}
                                    <Link to={`/regie/neu?meldung=${meldung.id}${meldung.normalfall ? '&nur=ueber' : ''}`} className="btn-ghost border-accent text-accent-deep">
                                      Regierapport vorrechnen ›
                                    </Link>
                                  </>
                                )}
                              </div>
                            )}
                            {regie && keineRegieFrage === meldung.id && !rapport && !keineRegieGrund && (
                              <div className="mt-2 space-y-1.5 rounded-[10px] bg-surface p-3">
                                <p className="text-xs text-ink2">Warum keine Regie? Die Stunden bleiben im Lohn — nur die Verrechnung an den Kunden entfällt.</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(REGIE_GRUND).map(([k, text]) => (
                                    <button key={k} type="button" className="chip px-3 py-1.5 text-xs" onClick={() => void keineRegie(meldung.id, k)}>{text}</button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {detail.some((e) => (e.freigabe_log?.length ?? 0) > 0) && (
                          <details className="text-[11px] text-ink3">
                            <summary className="cursor-pointer font-semibold uppercase tracking-wide">Verlauf</summary>
                            {detail.flatMap((e) => (e.freigabe_log ?? []).map((l) => ({ ...l, wer_name: e.mitarbeiter.name }))).sort((a, b) => a.wann.localeCompare(b.wann)).map((l, i) => (
                              <p key={i} className="mt-0.5">
                                {ch(new Date(l.wann))} {new Date(l.wann).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} · {l.wer_name}: {l.feld === 'status' ? 'freigegeben' : `${FELD[l.feld] ?? l.feld} ${stunden(Number(l.alt))} → ${stunden(Number(l.neu))} h`}{l.begruendung ? ` · ${l.begruendung}` : ''}
                              </p>
                            ))}
                          </details>
                        )}

                        {/* Der Knopf für diesen Tag — so gibt der Bauführer einzelne Teams an einzelnen Tagen frei */}
                        {darfFreigeben && tag.offen.length > 0 ? (
                          <div className="space-y-1">
                            <button type="button" className="cta cta-good disabled:opacity-60" disabled={!userId || speichert} onClick={() => void freigeben(tag.offen, `${z.team.bezeichnung}, ${tagName(tag.datum)}`)}>
                              {speichert ? 'Speichert …' : `${tagName(tag.datum)} freigeben · ${personenN} Pers.`}
                            </button>
                            {(tag.status === 'gelb' || tag.status === 'rot') && (
                              <p className="text-center text-[11px] text-ink3">Freigeben heisst: angeschaut — Notiz gelesen, Stunden geprüft. Verrechnen an den Kunden macht das Büro.</p>
                            )}
                          </div>
                        ) : tag.offen.length === 0 ? (
                          <p className="text-center text-sm font-semibold text-good-deep">✓ Tag freigegeben</p>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </section>
          </>
        )}

        {!laedt && sichtbar.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-steel" />offen</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-good" />freigegeben</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber" />{regie ? 'Regieverdacht — entscheiden' : 'Überstunden — Notiz lesen'}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />über 10 h</span>
            <span>Zelle antippen = Tag öffnen</span>
          </p>
        )}
      </div>
    </Shell>
  );
}
