import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { FotoGalerie } from '../ui/FotoGalerie';
import { supabase } from '../lib/supabase';
import { minutenBetrag, formatChf, tarifNachCode } from '../lib/tarif';

/**
 * Phase 3 — Wochenübersicht des Bauführers.
 *
 * Aufbau (08.09.): «Zu tun» zuerst. Teams mit Hinweis zeigen Kästchen (nur Hinweis-Tage farbig),
 * Teams ohne Hinweis sind eine ruhige Zeile. Ein Knopf oben gibt alles ohne Hinweis frei.
 * Grün ist Hintergrund, nicht Inhalt — der Bauführer soll in 3 Sekunden sehen, was ihn braucht.
 *
 * Harte Regel #1: Das System sagt NIE «diese Stunden sind falsch».
 * Jede Markierung nennt ihre Quelle («weicht ab von X», «offener Zusatzauftrag»)
 * — entscheiden tut der Bauführer. Jede Korrektur landet im freigabe_log.
 */

interface Eintrag {
  id: string;
  normal_min: number;
  ueber_min: number;
  status: string;
  mitarbeiter: { id: string; name: string; funktion: string; typ: string };
  tagesmeldung: {
    id: string;
    datum: string;
    normalfall: boolean;
    abweichung_typ: string | null;
    wer_hats_gewollt: string | null;
    transkript: string | null;
    audio_pfad: string | null;
    audio_sekunden: number | null;
    team: { id: string; bezeichnung: string } | null;
    baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null;
    foto: { id: string; pfad: string }[];
  };
}

interface Team { id: string; bezeichnung: string; chefmonteur: { name: string } | null }

interface OffenerAuftrag {
  id: string;
  baustelle_id: string;
  taetigkeit: string;
  besteller_name: string;
  geplant_fuer: string | null;
}

type ZellStatus = 'leer' | 'gruen' | 'gelb' | 'rot' | 'frei';
type Filter = 'zutun' | 'alle';

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ZEHN_STUNDEN_MIN = 600;
/** Rang für «schlechtester Status des Tages» und für die Sortierung der Teams. */
const RANG: Record<ZellStatus, number> = { rot: 4, gelb: 3, gruen: 2, frei: 1, leer: 0 };

function montag(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(12, 0, 0, 0);
  return x;
}
function addTage(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ch(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
function stunden(min: number): string {
  return (min / 60).toFixed(1);
}
function kurzName(name: string): string {
  const teile = name.trim().split(' ');
  return teile.length > 1 ? `${teile[0][0]}. ${teile.slice(1).join(' ')}` : name;
}

const ZELL_STIL: Record<ZellStatus, string> = {
  leer: 'text-ink3',
  gruen: 'bg-surface',
  frei: 'bg-good-soft text-good-deep',
  gelb: 'bg-amber-100 text-amber-900',
  rot: 'bg-accent-soft text-accent-deep font-semibold',
};

/** Team-Kästchen: gleiche Farben, aber auf grauem Grund, damit «grün» als Fläche lesbar ist. */
const TEAM_ZELL_STIL: Record<ZellStatus, string> = {
  leer: 'bg-ground text-ink3',
  gruen: 'bg-surface ring-1 ring-line',
  frei: 'bg-good-soft text-good-deep',
  gelb: 'bg-amber-100 text-amber-900',
  rot: 'bg-accent-soft text-accent-deep font-semibold',
};

export function Cockpit() {
  // Montag/Dienstag prüft der Bauführer die Vorwoche (Arbnor, 27.08.) — dann dort starten, nicht in der leeren neuen Woche
  // Aufruf mit ?woche=JJJJ-MM-TT&team=<id> (z. B. vom Regierapport «Ursprung») springt direkt dorthin.
  const params = new URLSearchParams(window.location.search);
  const [wochenStart, setWochenStart] = useState<Date>(() => {
    const w = params.get('woche');
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) return montag(new Date(w + 'T12:00:00'));
    const heute = new Date();
    const dieseWoche = montag(heute);
    return heute.getDay() === 1 || heute.getDay() === 2 ? addTage(dieseWoche, -7) : dieseWoche;
  });
  const istAktuelleWoche = iso(wochenStart) === iso(montag(new Date()));
  const istVorwoche = iso(wochenStart) < iso(montag(new Date()));
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [auftraege, setAuftraege] = useState<OffenerAuftrag[]>([]);
  const [gewaehlt, setGewaehlt] = useState<{ mit: string; datum: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const navigiere = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  // Standard «Zu tun»: nur Teams mit Hinweis. Kommt man gezielt zu einem Team (Tagesübersicht/Rapport), alle zeigen.
  const [filter, setFilter] = useState<Filter>(() => (params.get('team') ? 'alle' : 'zutun'));
  // Aufgeklappte Teams mit Hinweis zeigen zuerst nur die Personen mit Hinweis — hier: wer «alle zeigen» gedrückt hat
  const [alleLeute, setAlleLeute] = useState<Set<string>>(new Set());
  // Aufgeklapptes Team — die Tagesübersicht («Woche prüfen ›») setzt denselben Schlüssel
  const [offenesTeam, setOffenesTeam] = useState<string | null>(() => {
    const t = params.get('team') ?? localStorage.getItem('cockpit-team');
    return t && t !== 'alle' ? t : null;
  });
  const [audio, setAudio] = useState<{ meldung: string; url: string } | null>(null);
  // Herkunft «vom Regierapport»: markierter Tag + Meldung, Rücksprung, und das Team ins Bild scrollen
  const markierterTag = params.get('tag');
  const herkunftRapport = params.get('rapport');
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
  useEffect(() => {
    if (offenesTeam) localStorage.setItem('cockpit-team', offenesTeam);
    else localStorage.removeItem('cockpit-team');
  }, [offenesTeam]);

  const vonIso = iso(wochenStart);
  const bisIso = iso(addTage(wochenStart, 6));

  const laden = useCallback(async () => {
    if (!supabase) return;
    setLaedt(true);
    const [z, a] = await Promise.all([
      supabase
        .from('zeiteintrag')
        .select(
          'id,normal_min,ueber_min,status,mitarbeiter:mitarbeiter_id(id,name,funktion,typ),tagesmeldung:tagesmeldung_id!inner(id,datum,normalfall,abweichung_typ,wer_hats_gewollt,transkript,audio_pfad,audio_sekunden,team:team_id(id,bezeichnung),baustelle:baustelle_id(id,konto_nr,bezeichnung),foto(id,pfad))',
        )
        .gte('tagesmeldung.datum', vonIso)
        .lte('tagesmeldung.datum', bisIso),
      // Sicht: nur bestellt/gemeldet — wer schon einen Regierapport hat, wird nicht nochmals verdächtig
      supabase
        .from('zusatzauftrag_stand')
        .select('id,baustelle_id,taetigkeit,besteller_name,geplant_fuer')
        .in('stand', ['bestellt', 'gemeldet']),
    ]);
    if (z.data) setEintraege(z.data as unknown as Eintrag[]);
    if (a.data) setAuftraege(a.data);
    setLaedt(false);
  }, [vonIso, bisIso]);

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

  const auftragProBaustelle = useMemo(() => {
    const m = new Map<string, OffenerAuftrag>();
    for (const a of auftraege) if (!m.has(a.baustelle_id)) m.set(a.baustelle_id, a);
    return m;
  }, [auftraege]);

  /** Ein offener Auftrag macht nur den GEPLANTEN Tag verdächtig — nicht die ganze Woche. */
  function passenderAuftrag(baustelleId: string | undefined, datum: string): OffenerAuftrag | undefined {
    if (!baustelleId) return undefined;
    const a = auftragProBaustelle.get(baustelleId);
    if (!a) return undefined;
    return a.geplant_fuer === null || a.geplant_fuer === datum ? a : undefined;
  }

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

  function zellStatus(liste: Eintrag[] | undefined): ZellStatus {
    if (!liste || liste.length === 0) return 'leer';
    const summe = liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
    if (summe > ZEHN_STUNDEN_MIN) return 'rot';
    const verdacht = liste.some(
      (e) =>
        e.tagesmeldung.abweichung_typ !== null ||
        e.tagesmeldung.wer_hats_gewollt === 'kunde' ||
        passenderAuftrag(e.tagesmeldung.baustelle?.id, e.tagesmeldung.datum) !== undefined,
    );
    if (verdacht) return 'gelb';
    if (liste.every((e) => e.status === 'freigegeben')) return 'frei';
    return 'gruen';
  }

  // Regieverdacht: eine Karte pro betroffener Tagesmeldung
  const verdachtsfaelle = useMemo(() => {
    const gesehen = new Set<string>();
    const faelle: { meldung: Eintrag['tagesmeldung']; eintraege: Eintrag[]; ausloeser: string[] }[] = [];
    for (const e of eintraege) {
      const tm = e.tagesmeldung;
      if (gesehen.has(tm.id)) continue;
      const ausloeser: string[] = [];
      if (tm.abweichung_typ) ausloeser.push(`Team meldet «${tm.abweichung_typ}»`);
      if (tm.wer_hats_gewollt === 'kunde') ausloeser.push('Team: der Kunde wollte es');
      const auftrag = passenderAuftrag(tm.baustelle?.id, tm.datum);
      if (auftrag)
        ausloeser.push(`offener Zusatzauftrag: ${auftrag.taetigkeit} (${auftrag.besteller_name})`);
      if (ausloeser.length === 0) continue;
      gesehen.add(tm.id);
      faelle.push({
        meldung: tm,
        eintraege: eintraege.filter((x) => x.tagesmeldung.id === tm.id),
        ausloeser,
      });
    }
    return faelle;
  }, [eintraege, auftragProBaustelle]);

  const wochenTage = useMemo(() => TAGE.map((_, i) => iso(addTage(wochenStart, i))), [wochenStart]);

  /**
   * Eine Zeile pro Team: Tageskästchen (Summe + schlechtester Status), Baustellen der Woche,
   * offene Einträge, Statuswort. Teams ohne Meldung stehen auch drin — die fehlen sonst.
   */
  const teamZeilen = useMemo(() => {
    type Zeile = {
      team: Team;
      tage: { datum: string; min: number; status: ZellStatus }[];
      leute: typeof personen;
      baustellen: { konto_nr: string; bezeichnung: string | null }[];
      offen: number;
      gruene: Eintrag[];
      totalMin: number;
      schlimmster: ZellStatus;
      wort: string;
      rang: number;
      /** Erste Zelle mit Hinweis — Ziel beim Klick aufs Statuswort */
      hinweisZelle: { mit: string; datum: string } | null;
      /** Personen, die mindestens einen Hinweis-Tag haben */
      leuteMitHinweis: Set<string>;
      tageMitEintrag: number;
    };
    const zeilen: Zeile[] = teams.map((team) => {
      const leute = personen.filter(([, p]) => p.teamId === team.id);
      const tage = wochenTage.map((datum) => {
        let min = 0;
        let status: ZellStatus = 'leer';
        for (const [, p] of leute) {
          const liste = p.tage.get(datum);
          if (!liste) continue;
          min += liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
          const st = zellStatus(liste);
          if (RANG[st] > RANG[status]) status = st;
        }
        return { datum, min, status };
      });
      const alle = leute.flatMap(([, p]) => [...p.tage.values()].flat());
      const bsMap = new Map<string, { konto_nr: string; bezeichnung: string | null }>();
      for (const e of alle) if (e.tagesmeldung.baustelle) bsMap.set(e.tagesmeldung.baustelle.konto_nr, e.tagesmeldung.baustelle);
      const offen = alle.filter((e) => e.status === 'offen').length;
      const gruene = leute.flatMap(([, p]) => [...p.tage.values()].flatMap((liste) => (zellStatus(liste) === 'gruen' ? liste.filter((e) => e.status === 'offen') : [])));
      const totalMin = alle.reduce((s, e) => s + e.normal_min + e.ueber_min, 0);
      const schlimmster = tage.reduce<ZellStatus>((s, t) => (RANG[t.status] > RANG[s] ? t.status : s), 'leer');
      let wort: string;
      let rang: number;
      if (schlimmster === 'rot') { wort = 'über 10 h'; rang = 0; }
      else if (schlimmster === 'gelb') { wort = 'Regieverdacht'; rang = 0; }
      else if (alle.length === 0) { wort = 'keine Meldung'; rang = 3; }
      else if (offen > 0) { wort = `${offen} offen`; rang = 1; }
      else { wort = 'fertig'; rang = 2; }
      let hinweisZelle: { mit: string; datum: string } | null = null;
      const leuteMitHinweis = new Set<string>();
      for (const [mitId, p] of leute) {
        for (const datum of wochenTage) {
          const st = zellStatus(p.tage.get(datum));
          if (st === 'rot' || st === 'gelb') {
            leuteMitHinweis.add(mitId);
            if (!hinweisZelle || RANG[st] > RANG[zellStatus(leute.find(([id]) => id === hinweisZelle!.mit)?.[1].tage.get(hinweisZelle!.datum))]) hinweisZelle = { mit: mitId, datum };
          }
        }
      }
      const tageMitEintrag = tage.filter((t) => t.min > 0).length;
      return { team, tage, leute, baustellen: [...bsMap.values()], offen, gruene, totalMin, schlimmster, wort, rang, hinweisZelle, leuteMitHinweis, tageMitEintrag };
    });
    return zeilen.sort((a, b) => a.rang - b.rang || a.team.bezeichnung.localeCompare(b.team.bezeichnung, 'de', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, personen, wochenTage, auftragProBaustelle]);

  const zaehler = useMemo(() => ({
    gemeldet: teamZeilen.filter((z) => z.leute.length > 0).length,
    anschauen: teamZeilen.filter((z) => z.rang === 0).length,
    offen: teamZeilen.filter((z) => z.rang <= 1 && z.offen > 0).length,
    fertig: teamZeilen.filter((z) => z.rang === 2).length,
  }), [teamZeilen]);

  // «Zu tun» leer → alles zeigen, sonst steht der Bauführer vor einer leeren Seite
  const sichtbar = useMemo(
    () => (filter === 'zutun' && zaehler.anschauen > 0 ? teamZeilen.filter((z) => z.rang === 0) : teamZeilen),
    [teamZeilen, filter, zaehler.anschauen],
  );

  // Der eine Knopf gilt für die ganze Woche, nicht nur für die sichtbaren Teams
  const gruene = useMemo(() => teamZeilen.flatMap((z) => z.gruene), [teamZeilen]);

  function betragVorgerechnet(liste: Eintrag[]): number {
    return liste.reduce((s, e) => {
      let ansatz = 10800; // Rückfall Gerüstmonteur/in
      try {
        ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
      } catch {
        /* unbekannte Funktion → Monteursansatz */
      }
      return s + minutenBetrag(e.normal_min + e.ueber_min, ansatz);
    }, 0);
  }

  async function freigeben(liste: Eintrag[]) {
    if (!supabase || !userId || liste.length === 0) return;
    const ids = liste.map((e) => e.id);
    await supabase.from('zeiteintrag').update({ status: 'freigegeben' }).in('id', ids);
    await supabase.from('freigabe_log').insert(
      liste.map((e) => ({
        zeiteintrag_id: e.id,
        wer: userId,
        feld: 'status',
        alt: e.status,
        neu: 'freigegeben',
      })),
    );
    void laden();
  }

  /** Korrektur ±30 Min — jede Änderung landet im Protokoll (wer/wann/von/auf). */
  async function korrigieren(e: Eintrag, deltaMin: number) {
    if (!supabase || !userId) return;
    const neu = Math.max(0, e.normal_min + deltaMin);
    if (neu === e.normal_min) return;
    await supabase.from('zeiteintrag').update({ normal_min: neu }).eq('id', e.id);
    await supabase.from('freigabe_log').insert({
      zeiteintrag_id: e.id,
      wer: userId,
      feld: 'normal_min',
      alt: String(e.normal_min),
      neu: String(neu),
    });
    void laden();
  }

  /** Gelbe Karte → Regierapport-Entwurf: Positionen aus den Zeiteinträgen, Betrag nach SGUV. */
  async function regierapportErstellen(fall: { meldung: Eintrag['tagesmeldung']; eintraege: Eintrag[] }) {
    if (!supabase) return;
    const bs = fall.meldung.baustelle;
    if (!bs) return;
    const { data: r, error } = await supabase
      .from('regierapport')
      .insert({
        baustelle_id: bs.id,
        zusatzauftrag_id: auftragProBaustelle.get(bs.id)?.id ?? null,
        tagesmeldung_id: fall.meldung.id, // Ursprung — vom Rapport zurück zur Meldung
        betrag_rappen: betragVorgerechnet(fall.eintraege),
      })
      .select('id')
      .single();
    if (error || !r) return;
    await supabase.from('regie_position').insert(
      fall.eintraege.map((e) => {
        const min = e.normal_min + e.ueber_min;
        let ansatz = 10800;
        try {
          ansatz = tarifNachCode(e.mitarbeiter.funktion).ansatz_rappen;
        } catch {
          /* unbekannte Funktion → Monteursansatz */
        }
        return {
          regierapport_id: r.id,
          tarif_code: e.mitarbeiter.funktion,
          bezeichnung: `${e.mitarbeiter.name} · ${stunden(min)} h`,
          menge_hundertstel: Math.round((min * 100) / 60),
          ansatz_rappen: ansatz,
          betrag_rappen: minutenBetrag(min, ansatz),
        };
      }),
    );
    navigiere(`/regie/${r.id}`);
  }

  const detail = gewaehlt
    ? personen.find(([id]) => id === gewaehlt.mit)?.[1].tage.get(gewaehlt.datum) ?? []
    : [];

  function teamUmschalten(id: string) {
    setGewaehlt(null);
    setOffenesTeam((t) => (t === id ? null : id));
  }

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'zutun', label: 'Zu tun', n: zaehler.anschauen },
    { key: 'alle', label: 'Alle Teams', n: teamZeilen.length },
  ];

  /** Klick aufs Statuswort: Team auf, direkt in die betroffene Zelle. */
  function zumHinweis(z: (typeof teamZeilen)[number]) {
    setOffenesTeam(z.team.id);
    setGewaehlt(z.hinweisZelle);
  }

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Woche</h1>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, -7))}>‹</button>
            <span className="font-mono text-xs text-ink2">
              {ch(wochenStart)}–{ch(addTage(wochenStart, 6))}{istVorwoche ? ' · Vorwoche' : ''}
            </span>
            <button type="button" className="btn-ghost" onClick={() => setWochenStart(addTage(wochenStart, 7))}>›</button>
          </div>
        </header>

        {herkunftRapport && (
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-steel/40 bg-steel-soft px-4 py-2.5 text-sm">
            <span>
              Sicht aus dem Regierapport{markierterTag ? <> — markiert ist <strong>{ch(new Date(markierterTag + 'T12:00:00'))}</strong></> : ''}
            </span>
            <Link to={`/regie/${herkunftRapport}`} className="shrink-0 font-semibold text-steel">‹ zurück zum Rapport</Link>
          </div>
        )}

        {!laedt && teams.length > 0 && (
          <p className="text-sm text-ink2">
            <strong>{zaehler.gemeldet} von {teams.length} Teams</strong> haben gemeldet
            {zaehler.anschauen > 0
              ? <> · <span className="font-semibold text-accent-deep">{zaehler.anschauen} zum Anschauen</span></>
              : eintraege.length > 0 ? <> · nichts zum Anschauen</> : null}
          </p>
        )}

        {/* Der eine Knopf — zuoberst, nicht unter 20 Teams versteckt */}
        {!laedt && gruene.length > 0 && (
          <button type="button" className="cta cta-good" onClick={() => void freigeben(gruene)}>
            Alle {gruene.length} Einträge ohne Hinweis freigeben
          </button>
        )}

        {!laedt && zaehler.anschauen > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                className={'px-3 py-1.5 text-xs ' + (filter === c.key ? 'chip chip-on' : 'chip')}
              >
                {c.label} <span className="ml-1 font-mono opacity-70">{c.n}</span>
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
          <section className="card overflow-hidden p-0">
            {/* Kopfzeile mit den Wochentagen — einmal, nicht pro Team */}
            {/* Schmal: nur die Tage (Team steht in jeder Zeile darüber). Breit: Team-Spalte + Tage in einer Zeile. */}
            {sichtbar.map((z) => {
              const auf = offenesTeam === z.team.id;
              const faelle = verdachtsfaelle.filter((f) => f.meldung.team?.id === z.team.id);
              return (
                <div key={z.team.id} ref={auf ? zielRef : undefined} className={'scroll-mt-20 border-b border-line last:border-b-0 ' + (auf ? 'bg-steel-soft/30' : '')}>
                  {z.rang !== 0 ? (
                    /* Team ohne Hinweis: eine ruhige Zeile, keine Kästchen. Antippen = Stichprobe. */
                    <button
                      type="button"
                      onClick={() => teamUmschalten(z.team.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-display text-[14px] font-bold">{z.team.bezeichnung}</span>
                        {z.team.chefmonteur && <span className="ml-1.5 text-xs text-ink3">{kurzName(z.team.chefmonteur.name)}</span>}
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink3">
                        {z.rang === 3
                          ? <span className="font-semibold text-ink2">keine Meldung</span>
                          : <>
                              <span className="font-mono tabular-nums">{z.tageMitEintrag} {z.tageMitEintrag === 1 ? 'Tag' : 'Tage'} · {stunden(z.totalMin)} h</span>
                              <span className={'ml-2 font-semibold ' + (z.rang === 2 ? 'text-good-deep' : 'text-ink2')}>{z.rang === 2 ? '✓ freigegeben' : '✓ wie geplant · ' + z.wort}</span>
                            </>}
                      </span>
                    </button>
                  ) : (
                    /* Team mit Hinweis: Kästchen, aber nur die Hinweis-Tage sind farbig — der Rest ist ein blasser Punkt. */
                    <button
                      type="button"
                      onClick={() => teamUmschalten(z.team.id)}
                      className="block w-full px-3 py-2 text-left"
                    >
                      <span className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <span className="font-display text-[14px] font-bold">{z.team.bezeichnung}</span>
                          {z.team.chefmonteur && <span className="ml-1.5 font-body text-xs font-normal text-ink3">{kurzName(z.team.chefmonteur.name)}</span>}
                        </span>
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); zumHinweis(z); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); zumHinweis(z); } }}
                          className="shrink-0 text-[11px] font-semibold text-accent-deep underline decoration-accent/40 underline-offset-2"
                        >
                          {z.wort} ›
                        </span>
                      </span>
                      {/* Sieben Kästchen Mo–So in voller Breite; nur Hinweis-Tage tragen Wochentag + Stunden */}
                      <span className="mt-1.5 grid grid-cols-[repeat(7,minmax(0,1fr))_3.2rem] items-center gap-x-1">
                        {z.tage.map((t, i) => {
                          const hinweis = t.status === 'rot' || t.status === 'gelb';
                          return (
                            <span
                              key={t.datum}
                              className={'block rounded-md py-1 text-center font-mono text-[11px] leading-tight tabular-nums ' + (hinweis ? TEAM_ZELL_STIL[t.status] : 'text-ink3/50') + (markierterTag === t.datum && auf ? ' ring-2 ring-steel' : '')}
                            >
                              {hinweis
                                ? <><span className="block text-[9px] font-semibold uppercase opacity-80">{TAGE[i]}</span>{Math.round(t.min / 60)} h</>
                                : t.status === 'leer' ? '–' : '·'}
                            </span>
                          );
                        })}
                        <span className="text-right font-mono text-xs tabular-nums text-ink2">{z.totalMin > 0 ? stunden(z.totalMin) : '–'}</span>
                      </span>
                    </button>
                  )}

                  {auf && (
                    <div className="space-y-3 border-t border-line bg-surface px-3 py-3">
                      {z.leute.length === 0 ? (
                        <p className="text-sm text-ink3">Dieses Team hat in dieser Woche nichts gemeldet.</p>
                      ) : (
                        <>
                          <p className="text-[11px] text-ink3">
                            {z.baustellen.map((b) => `${b.konto_nr} ${b.bezeichnung ?? ''}`.trim()).join(' · ') || 'keine Baustelle'}
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[430px] text-sm">
                              <thead>
                                <tr className="text-[10px] font-semibold uppercase text-ink3">
                                  <td className="pr-2" />
                                  {wochenTage.map((datum, i) => <td key={datum} className={'text-center font-mono ' + (markierterTag === datum ? 'text-steel' : '')}>{TAGE[i]}</td>)}
                                </tr>
                              </thead>
                              <tbody>
                                {z.leute.filter(([mitId]) => z.rang !== 0 || alleLeute.has(z.team.id) || z.leuteMitHinweis.size === 0 || z.leuteMitHinweis.has(mitId)).map(([mitId, p]) => (
                                  <tr key={mitId} className="border-b border-line last:border-b-0">
                                    <td className="py-1.5 pr-2 font-medium whitespace-nowrap">
                                      {p.name}
                                      {p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                                    </td>
                                    {wochenTage.map((datum) => {
                                      const liste = p.tage.get(datum);
                                      const st = zellStatus(liste);
                                      const summe = liste?.reduce((s, e) => s + e.normal_min + e.ueber_min, 0) ?? 0;
                                      const aktiv = gewaehlt?.mit === mitId && gewaehlt.datum === datum;
                                      return (
                                        <td key={datum} className="p-0.5 text-center">
                                          <button
                                            type="button"
                                            onClick={() => setGewaehlt(aktiv ? null : { mit: mitId, datum })}
                                            className={'w-full rounded-md px-1 py-1.5 font-mono text-xs tabular-nums transition ' + ZELL_STIL[st] + (aktiv ? ' ring-2 ring-accent' : markierterTag === datum ? ' ring-2 ring-steel' : '')}
                                          >
                                            {st === 'leer' ? '–' : stunden(summe)}
                                          </button>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {z.rang === 0 && z.leuteMitHinweis.size > 0 && z.leuteMitHinweis.size < z.leute.length && !alleLeute.has(z.team.id) && (
                            <button type="button" className="text-xs font-semibold text-steel" onClick={() => setAlleLeute((s) => new Set(s).add(z.team.id))}>
                              alle {z.leute.length} Personen zeigen
                            </button>
                          )}

                          {gewaehlt && detail.length > 0 && z.leute.some(([id]) => id === gewaehlt.mit) && (
                            <div className="rounded-[12px] bg-ground p-3 space-y-2.5">
                              <p className="lbl mb-0">
                                {personen.find(([id]) => id === gewaehlt.mit)?.[1].name} · {ch(new Date(gewaehlt.datum + 'T12:00:00'))}
                              </p>
                              {detail.map((e) => (
                                <div key={e.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0">
                                  <span className="min-w-0 text-sm">
                                    <span className="block truncate font-medium">{e.tagesmeldung.baustelle?.bezeichnung ?? 'ohne Baustelle'}</span>
                                    {e.tagesmeldung.baustelle && <span className="knr">{e.tagesmeldung.baustelle.konto_nr}</span>}
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    <button type="button" className="btn-ghost px-2.5" onClick={() => void korrigieren(e, -30)}>−</button>
                                    <span className="w-12 text-center font-mono text-sm tabular-nums">{stunden(e.normal_min + e.ueber_min)} h</span>
                                    <button type="button" className="btn-ghost px-2.5" onClick={() => void korrigieren(e, 30)}>+</button>
                                    {e.status === 'offen' ? (
                                      <button type="button" className="btn-ghost text-good-deep" onClick={() => void freigeben([e])}>✓</button>
                                    ) : (
                                      <span className="px-1 text-good" title="freigegeben">✓</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                              <p className="text-[11px] text-ink3">Jede Korrektur wird protokolliert: wer, wann, von, auf.</p>
                            </div>
                          )}

                          {faelle.map(({ meldung, eintraege: liste, ausloeser }) => (
                            <div key={meldung.id} className={'rounded-[12px] border border-amber-300 bg-amber-50 p-3' + (markierteMeldung === meldung.id ? ' ring-2 ring-steel' : '')}>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-display text-[14px] font-bold">
                                  {markierteMeldung === meldung.id ? 'Diese Meldung · ' : 'Regieverdacht · '}{meldung.baustelle?.bezeichnung ?? '—'}
                                </span>
                                <span className="font-mono text-xs text-ink3">{ch(new Date(meldung.datum + 'T12:00:00'))}</span>
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
                                <p className="mt-2 rounded-[10px] bg-surface px-3 py-2 text-sm italic text-ink2">«{meldung.transkript}»</p>
                              )}
                              {(meldung.audio_pfad || meldung.audio_sekunden) && (
                                <div className="mt-2 flex items-center gap-2">
                                  {meldung.audio_pfad ? (
                                    <button type="button" onClick={() => void anhoeren(meldung.id, meldung.audio_pfad!)} className="btn-ghost">▶ Sprachnotiz{meldung.audio_sekunden ? ` · ${meldung.audio_sekunden} Sek.` : ''}</button>
                                  ) : (
                                    <span className="font-mono text-[11px] text-ink3">Sprachnotiz {meldung.audio_sekunden} Sek. (Demo — keine Aufnahme hinterlegt)</span>
                                  )}
                                  {audio?.meldung === meldung.id && <audio controls autoPlay src={audio.url} className="h-8 flex-1" />}
                                </div>
                              )}
                              {meldung.normalfall ? (
                                /* Normaler Tag mit offenem Auftrag: die 8 h sind Aufbau (Offerte), nicht Regie.
                                   Regie entsteht nur aus dem gemeldeten Extra — sonst beim Team nachfragen. */
                                <p className="mt-2 rounded-[10px] border border-dashed border-amber-400 px-3 py-2 text-xs text-ink2">
                                  Normaler Arbeitstag ({stunden(liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0))} h) — das ist Aufbau aus der Offerte, keine Regie.
                                  Der Zusatzauftrag war für diesen Tag geplant, aber <b>das Team hat keine Zusatzarbeit gemeldet</b>: nachfragen, ob sie ausgeführt wurde.
                                </p>
                              ) : (
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <span className="text-sm">
                                    {stunden(liste.reduce((s, e) => s + e.normal_min + e.ueber_min, 0))} h Zusatzarbeit ·{' '}
                                    <span className="font-mono font-semibold text-accent-deep">{formatChf(betragVorgerechnet(liste))}</span>
                                    <span className="text-xs text-ink3"> vorgerechnet</span>
                                  </span>
                                  <button type="button" onClick={() => void regierapportErstellen({ meldung, eintraege: liste })} className="btn-ghost shrink-0 border-accent text-accent-deep">
                                    → Regierapport
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}

                          {z.gruene.length > 0 && (
                            <button type="button" className="btn-ghost w-full border-good text-good-deep" onClick={() => void freigeben(z.gruene)}>
                              {z.team.bezeichnung}: {z.gruene.length} {z.gruene.length === 1 ? 'Eintrag' : 'Einträge'} ohne Hinweis freigeben
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {!laedt && sichtbar.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-200" />Regieverdacht</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent-soft ring-1 ring-accent/40" />über 10 h</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-good-soft ring-1 ring-good/40" />freigegeben</span>
            <span>· = Tag ohne Hinweis</span>
          </p>
        )}
      </div>
    </Shell>
  );
}
