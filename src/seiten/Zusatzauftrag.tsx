import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardList, ClipboardPlus, CloudOff, Ellipsis, Mail, MapPin, MoveHorizontal, Phone, Search, Sparkles, SquareMinus, SquarePlus, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { Shell } from '../ui/Shell';
import { KennzahlPille } from '../ui/Karten';
import { DatumWahl } from '../ui/DatumWahl';
import { supabase } from '../lib/supabase';
import { ausIso, iso as isoDatum, kurz } from '../lib/datum';
import { TAETIGKEITEN, TAETIGKEIT_LABEL } from '../lib/zusatzauftrag';
import {
  enqueueZusatzauftrag,
  flushNachSupabase,
  offeneAuftraege,
  type FlushErgebnis,
  type LokalerAuftrag,
} from '../lib/db';

/**
 * Stufe 1 — der Geldwert: Die Kundenbestellung wird eingetippt,
 * während der Bauleiter noch am Telefon ist. Vier Angaben, 20 Sekunden.
 * Schreibt in die Offline-Queue (CLAUDE.md #4) und sendet sofort, wenn Netz da ist.
 */

interface Baustelle {
  id: string;
  konto_nr: string;
  bezeichnung: string | null;
  /** Bauleitung des Kunden — Vorschlag fürs Feld «Wer verlangt es?» */
  kunde: { name: string | null; ansprechperson: string | null; email: string | null } | null;
}

/** Was auf dem Gerät wartet — dieselben Felder, die enqueueZusatzauftrag bekommt */
interface LokalPayload {
  baustelle_id?: string;
  besteller_name?: string;
  taetigkeit?: string;
}

/** Zeile aus der Sicht zusatzauftrag_stand — der Stand ist abgeleitet, nicht geklickt. */
interface Auftrag {
  id: string;
  besteller_name: string;
  kanal: string;
  taetigkeit: string;
  geplant_fuer: string | null;
  bestellt_am: string;
  status: 'offen' | 'erledigt_ohne_regie';
  notiz: string | null;
  konto_nr: string;
  baustelle_id?: string | null;
  baustelle_bezeichnung: string | null;
  stand: 'bestellt' | 'gemeldet' | 'im_regierapport' | 'beim_kunden' | 'bestaetigt' | 'erledigt_ohne_regie';
  gemeldet_am: string | null;
  gemeldet_von_team: string | null;
  regierapport_id: string | null;
  regierapport_nummer: string | null;
  regierapport_status: string | null;
  ohne_meldung: boolean;
  erledigt_grund: string | null;
  erledigt_am: string | null;
  /** 0011: Kunde */
  kunde_name: string | null;
  kunde_email: string | null;
  kunde_ansprechperson: string | null;
}


const KANAELE = [
  ['telefon', 'Telefon'],
  ['mail', 'Mail'],
  ['vor_ort', 'vor Ort'],
] as const;

// Stand kommt aus Meldung und Regierapport (Sicht zusatzauftrag_stand). Einziger Handgriff: «erledigt ohne Regie».
const STAND_LABEL: Record<Auftrag['stand'], string> = {
  bestellt: 'bestellt',
  gemeldet: 'gemeldet',
  im_regierapport: 'im Regierapport',
  beim_kunden: 'beim Kunden',
  bestaetigt: 'bestätigt',
  erledigt_ohne_regie: 'erledigt ohne Regie',
};

// Bernstein = Hinweis, Rot bleibt dem Speichern-Knopf vorbehalten.
const STAND_STIL: Record<Auftrag['stand'], string> = {
  bestellt: 'bg-amber-soft text-amber-deep',
  gemeldet: 'bg-amber-soft text-amber-deep',
  im_regierapport: 'bg-steel-soft text-steel',
  beim_kunden: 'bg-steel-soft text-steel',
  bestaetigt: 'bg-good-soft text-good-deep',
  erledigt_ohne_regie: 'bg-ground text-ink3',
};

const GRUENDE = [
  ['abgesagt', 'Kunde hat abgesagt'],
  ['pauschale', 'war in der Pauschale'],
  ['kulanz', 'kulant, ohne Rechnung'],
  ['doppelt', 'doppelt erfasst'],
] as const;

const GRUND_LABEL: Record<string, string> = Object.fromEntries(GRUENDE);

// Baustellenliste lokal vorhalten, damit das Formular auch ohne Netz aufgeht.
// Kommt Netz zurück, wird der Cache beim nächsten Laden erneuert. v2: mit Kunde.
const CACHE_KEY = 'baustellen-cache-v2';

type Rueckmeldung = { art: 'gesendet' | 'wartet'; text: string };


export function Zusatzauftrag() {
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [suche, setSuche] = useState('');
  const [gewaehlt, setGewaehlt] = useState<Baustelle | null>(null);
  const [besteller, setBesteller] = useState('');
  const [kanal, setKanal] = useState<string>('telefon');
  const [taetigkeit, setTaetigkeit] = useState<string>('versetzen');
  const [geplant, setGeplant] = useState('');
  const [notiz, setNotiz] = useState('');
  const [rueckmeldung, setRueckmeldung] = useState<Rueckmeldung | null>(null);
  const [fehler, setFehler] = useState('');
  const [liste, setListe] = useState<Auftrag[]>([]);
  // Offen zuerst (nach geplantem Tag), Erledigtes eingeklappt — sonst ist die Seite nach zwei Wochen eine Wand
  const [zeigeErledigte, setZeigeErledigte] = useState(false);
  const offene = useMemo(
    () => liste.filter((a) => a.stand === 'bestellt' || a.stand === 'gemeldet').sort((a, b) => (a.geplant_fuer ?? '9999').localeCompare(b.geplant_fuer ?? '9999')),
    [liste],
  );
  const erledigte = useMemo(
    () => liste.filter((a) => a.stand !== 'bestellt' && a.stand !== 'gemeldet').sort((a, b) => b.bestellt_am.localeCompare(a.bestellt_am)),
    [liste],
  );
  const [lokal, setLokal] = useState<LokalerAuftrag[]>([]);
  const [erledigen, setErledigen] = useState<string | null>(null); // Auftrag, für den gerade der Grund gewählt wird
  const [userId, setUserId] = useState<string | null>(null);

  // Für «gemeldet»: die Meldung des Teams in der Wochenübersicht öffnen (Sicht liefert nur Datum + Teamname)
  const [meldungLinks, setMeldungLinks] = useState<Record<string, string>>({});
  async function meldungLinksLaden(auftraege: Auftrag[]) {
    if (!supabase) return;
    const gemeldet = auftraege.filter((a) => a.stand === 'gemeldet' && a.gemeldet_am && a.baustelle_id);
    if (gemeldet.length === 0) { setMeldungLinks({}); return; }
    const { data } = await supabase
      .from('tagesmeldung')
      .select('id,team_id,datum,baustelle_id')
      .in('baustelle_id', [...new Set(gemeldet.map((a) => a.baustelle_id as string))])
      .in('datum', [...new Set(gemeldet.map((a) => a.gemeldet_am as string))]);
    const links: Record<string, string> = {};
    for (const a of gemeldet) {
      const m = (data ?? []).find((x) => x.baustelle_id === a.baustelle_id && x.datum === a.gemeldet_am);
      if (m) links[a.id] = `/cockpit?woche=${m.datum}&tag=${m.datum}&team=${m.team_id}&meldung=${m.id}`;
    }
    setMeldungLinks(links);
  }

  /**
   * «bestellt», aber das Team war schon da: Die Teams arbeiten meist täglich auf derselben Baustelle, darum zählt
   * erst ein Tag mit Überstunden als «gemeldet» (Sicht zusatzauftrag_stand, 0015). Ein normaler Tag ab dem geplanten
   * Tag wird hier trotzdem genannt — sonst stünde «wartet auf die Meldung», obwohl das Team gemeldet hat.
   */
  const [normalGemeldet, setNormalGemeldet] = useState<Record<string, { datum: string; team: string; link: string }>>({});
  async function normalGemeldetLaden(auftraege: Auftrag[]) {
    if (!supabase) return;
    const heute = isoDatum(new Date());
    const ab = (a: Auftrag) => a.geplant_fuer ?? a.bestellt_am.slice(0, 10);
    const bestellt = auftraege.filter((a) => a.stand === 'bestellt' && a.baustelle_id && ab(a) <= heute);
    if (bestellt.length === 0) { setNormalGemeldet({}); return; }
    const { data } = await supabase
      .from('tagesmeldung')
      .select('id,team_id,datum,baustelle_id,team:team_id(bezeichnung)')
      .in('baustelle_id', [...new Set(bestellt.map((a) => a.baustelle_id as string))])
      .gte('datum', bestellt.map(ab).sort()[0])
      .lte('datum', heute)
      .order('datum');
    const treffer: Record<string, { datum: string; team: string; link: string }> = {};
    for (const a of bestellt) {
      const m = ((data ?? []) as unknown as { id: string; team_id: string; datum: string; baustelle_id: string; team: { bezeichnung: string } | null }[])
        .find((x) => x.baustelle_id === a.baustelle_id && x.datum >= ab(a));
      if (m) treffer[a.id] = { datum: m.datum, team: m.team?.bezeichnung ?? 'Das Team', link: `/cockpit?woche=${m.datum}&tag=${m.datum}&team=${m.team_id}&meldung=${m.id}` };
    }
    setNormalGemeldet(treffer);
  }

  async function ladeListe() {
    void offeneAuftraege().then(setLokal);
    if (!supabase) return;
    const { data } = await supabase
      .from('zusatzauftrag_stand')
      .select(
        'id,besteller_name,kanal,taetigkeit,geplant_fuer,bestellt_am,status,notiz,konto_nr,baustelle_id,baustelle_bezeichnung,stand,gemeldet_am,gemeldet_von_team,regierapport_id,regierapport_nummer,regierapport_status,ohne_meldung,erledigt_grund,erledigt_am,kunde_name,kunde_email,kunde_ansprechperson',
      )
      .order('bestellt_am', { ascending: false })
      .limit(50);
    if (data) { setListe(data as unknown as Auftrag[]); void meldungLinksLaden(data as unknown as Auftrag[]); void normalGemeldetLaden(data as unknown as Auftrag[]); }
    else {
      // Sicht noch ohne 0011? Dann ohne die Kundenspalten laden, statt gar nicht.
      const alt = await supabase
        .from('zusatzauftrag_stand')
        .select('id,besteller_name,kanal,taetigkeit,geplant_fuer,bestellt_am,status,notiz,konto_nr,baustelle_bezeichnung,stand,gemeldet_am,gemeldet_von_team,regierapport_id,regierapport_nummer,regierapport_status,ohne_meldung,erledigt_grund,erledigt_am')
        .order('bestellt_am', { ascending: false })
        .limit(50);
      if (alt.data) setListe((alt.data as unknown as Auftrag[]).map((a) => ({ ...a, kunde_email: null, kunde_name: null, kunde_ansprechperson: null })));
    }
  }

  useEffect(() => {
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) setBaustellen(JSON.parse(c) as Baustelle[]);
    } catch {
      /* Cache nicht verfügbar — dann eben nur online */
    }
    if (supabase) {
      void supabase
        .from('baustelle')
        .select('id,konto_nr,bezeichnung,kunde:kunde_id(name,ansprechperson,email)')
        .order('bezeichnung')
        .then(({ data }) => {
          if (data) {
            setBaustellen(data as unknown as Baustelle[]);
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            } catch {
              /* voll oder blockiert — unkritisch */
            }
          }
        });
    }
    void ladeListe();
    if (supabase) void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return [];
    return baustellen
      .filter(
        (b) =>
          (b.bezeichnung ?? '').toLowerCase().includes(q) || b.konto_nr.includes(q),
      )
      .slice(0, 8);
  }, [suche, baustellen]);

  async function speichern() {
    setFehler('');
    if (!gewaehlt) {
      setFehler('Zuerst die Baustelle wählen.');
      return;
    }
    if (!besteller.trim()) {
      setFehler('Wer hat die Arbeit verlangt? Name eintragen.');
      return;
    }
    const clientUuid = await enqueueZusatzauftrag({
      baustelle_id: gewaehlt.id,
      besteller_name: besteller.trim(),
      kanal,
      taetigkeit,
      geplant_fuer: geplant || null,
      notiz: notiz.trim() || null,
      status: 'offen',
    });
    // Erst lokal, dann senden — und ehrlich sagen, ob es angekommen ist (nie «Gespeichert ✓» bei gescheitertem Versand).
    let erg: FlushErgebnis | null = null;
    if (supabase && navigator.onLine) {
      try { erg = await flushNachSupabase(supabase); } catch (e) { erg = { gesendet: 0, fehler: 1, verworfen: 0, fehlerText: e instanceof Error ? e.message : String(e) }; }
    }
    const nochLokal = (await offeneAuftraege()).some((a) => a.client_uuid === clientUuid);
    if (!nochLokal && erg && erg.gesendet > 0) {
      setRueckmeldung({ art: 'gesendet', text: 'Gespeichert ✓ und gesendet' });
    } else {
      const grund = erg?.fehlerText ?? (!supabase ? 'keine Datenbank eingerichtet' : !navigator.onLine ? 'kein Netz' : 'wird beim nächsten Netz gesendet');
      setRueckmeldung({ art: 'wartet', text: `Auf dem Gerät gespeichert, noch nicht gesendet: ${grund}` });
    }
    setTimeout(() => setRueckmeldung(null), 6000);
    setGewaehlt(null);
    setSuche('');
    setBesteller('');
    setGeplant('');
    setNotiz('');
    setTaetigkeit('versetzen');
    setKanal('telefon');
    void ladeListe();
  }

  /** Der einzige Handgriff: bestellt, aber es gibt keine Regie — mit Pflichtgrund, wer, wann. */

  async function ohneRegieErledigen(a: Auftrag, grund: string) {
    if (!supabase) return;
    await supabase
      .from('zusatzauftrag')
      .update({ status: 'erledigt_ohne_regie', erledigt_grund: grund, erledigt_am: new Date().toISOString(), erledigt_von: userId })
      .eq('id', a.id);
    setErledigen(null);
    void ladeListe();
  }

  /** Versehentlich erledigt → wieder offen; der Stand ergibt sich dann wieder aus den Daten. */
  async function wiederOeffnen(a: Auftrag) {
    if (!supabase) return;
    await supabase
      .from('zusatzauftrag')
      .update({ status: 'offen', erledigt_grund: null, erledigt_am: null, erledigt_von: null })
      .eq('id', a.id);
    void ladeListe();
  }

  const heuteIso = isoDatum(new Date());
  const heuteGeplant = offene.filter((a) => a.geplant_fuer === heuteIso).length;
  const ohneMeldung = offene.filter((a) => a.ohne_meldung).length;
  const sichtbar = zeigeErledigte ? erledigte : offene;

  return (
    <Shell zurueck>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lbl mb-0.5">Tagesgeschäft</p>
            <h1 className="font-display text-2xl font-semibold">Zusatzaufträge</h1>
            <p className="mt-1 text-sm text-ink3">Was der Kunde zusätzlich bestellt — erfassen, solange er noch am Telefon ist.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <KennzahlPille wert={String(offene.length + lokal.length)} text="offen" icon={ClipboardList} />
            <KennzahlPille wert={String(heuteGeplant)} text="heute geplant" icon={CalendarCheck} farbe="blau" />
            {ohneMeldung > 0 && <KennzahlPille wert={String(ohneMeldung)} text="ohne Meldung" icon={TriangleAlert} farbe="gelb" />}
          </div>
        </header>

        <div className="space-y-6">
          {/* ── Neuer Auftrag ─────────────────────────────────────────────── */}
          <section className="card p-5 lg:p-7">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent text-white shadow-[0_4px_10px_-4px_rgb(224_48_30/0.6)]">
                <ClipboardPlus size={19} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-lg font-semibold">Neuer Auftrag</span>
                <span className="block text-xs text-ink3">Vier Angaben, zwanzig Sekunden</span>
              </span>
            </div>

            <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
            <div className="space-y-5">
            <Schritt nr={1} titel="Baustelle">
              {gewaehlt ? (
                <button
                  type="button"
                  onClick={() => { setGewaehlt(null); setSuche(''); }}
                  className="flex w-full items-center justify-between gap-3 rounded-[14px] border border-accent/40 bg-gradient-to-br from-white to-accent-soft px-3.5 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[15px] font-semibold">{gewaehlt.bezeichnung}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink3"><span className="knr">{gewaehlt.konto_nr}</span>{gewaehlt.kunde?.name}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-steel">ändern</span>
                </button>
              ) : (
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden="true" />
                  <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Strasse, Name oder Kontonummer …" className="field pl-10" />
                  {treffer.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-[14px] border border-line bg-white shadow-[0_16px_40px_-12px_rgb(17_17_19/0.25)]">
                      {treffer.map((b) => (
                        <button key={b.id} type="button" onClick={() => setGewaehlt(b)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-ground">
                          <span className="knr">{b.konto_nr}</span>
                          <span className="truncate font-medium">{b.bezeichnung}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Schritt>

            <Schritt nr={2} titel="Wer verlangt es?">
              {gewaehlt?.kunde?.ansprechperson && (
                <button
                  type="button"
                  onClick={() => setBesteller(gewaehlt.kunde?.ansprechperson ?? '')}
                  className={'chip mb-2 rounded-full px-3 py-1 text-xs font-semibold ' + (besteller.trim() === gewaehlt.kunde.ansprechperson.trim() ? 'chip-on' : '')}
                  title={gewaehlt.kunde.email ?? undefined}
                >
                  Bauleitung: {gewaehlt.kunde.ansprechperson}
                </button>
              )}
              <input id="besteller" value={besteller} onChange={(e) => setBesteller(e.target.value)} placeholder="z. B. M. Huber, Bauleitung" className="field" />
              <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-[14px] bg-surface-2 p-1" role="group" aria-label="Wie bestellt">
                {KANAELE.map(([wert, label]) => {
                  const Icon = KANAL_ICON[wert];
                  const an = kanal === wert;
                  return (
                    <button key={wert} type="button" onClick={() => setKanal(wert)} aria-pressed={an}
                      className={'flex items-center justify-center gap-1.5 rounded-[11px] py-2 text-xs font-semibold transition ' + (an ? 'bg-white text-ink shadow-[0_1px_2px_rgb(17_17_19/0.08),0_4px_10px_-6px_rgb(17_17_19/0.3)]' : 'text-ink3 hover:text-ink')}>
                      <Icon size={14} aria-hidden="true" />{label}
                    </button>
                  );
                })}
              </div>
            </Schritt>
            </div>

            <div className="space-y-5">
            <Schritt nr={3} titel="Was ist zu tun?">
              <div className="grid grid-cols-3 gap-2">
                {TAETIGKEITEN.map(([wert, label]) => {
                  const Icon = TAETIGKEIT_ICON[wert] ?? Ellipsis;
                  const an = taetigkeit === wert;
                  return (
                    <button key={wert} type="button" onClick={() => setTaetigkeit(wert)} aria-pressed={an}
                      className={'chip flex flex-col items-center gap-1.5 py-3 text-xs font-semibold ' + (an ? 'chip-on' : '')}>
                      <Icon size={18} strokeWidth={2} className={an ? 'text-accent' : 'text-ink3'} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </Schritt>

            <Schritt nr={4} titel="Wann?">
              <div className="grid grid-cols-2 gap-3">
                <DatumWahl wert={geplant} aendern={setGeplant} label="Geplant für" platzhalter="Tag wählen" />
                <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz (freiwillig)" className="field" aria-label="Notiz (optional)" />
              </div>
            </Schritt>

            </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-ink3"><CloudOff size={13} aria-hidden="true" />Ohne Netz wird lokal gespeichert und gesendet, sobald Empfang da ist.</p>
              <div className="flex flex-col gap-2 sm:items-end">
                {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
                {rueckmeldung?.art === 'wartet' && (
                  <p role="status" className="rounded-[12px] bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-deep">{rueckmeldung.text}</p>
                )}
                <button type="button" onClick={() => void speichern()} className={'cta sm:w-auto sm:px-10 ' + (rueckmeldung?.art === 'gesendet' ? 'cta-good' : '')}>
                  {rueckmeldung?.art === 'gesendet' ? rueckmeldung.text : 'Auftrag speichern'}
                </button>
              </div>
            </div>
          </section>

          {/* ── Aufträge ──────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgb(17_17_19/0.06)]" role="group" aria-label="Auswahl">
                {([[false, `Offen · ${offene.length + lokal.length}`], [true, `Erledigt · ${erledigte.length}`]] as const).map(([erl, label]) => (
                  <button key={label} type="button" onClick={() => setZeigeErledigte(erl)} aria-pressed={zeigeErledigte === erl}
                    className={'rounded-full px-3.5 py-1.5 text-xs font-semibold transition ' + (zeigeErledigte === erl ? 'bg-ink text-white shadow-sm' : 'text-ink2 hover:text-ink')}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink3">Der Stand ergibt sich aus Meldung und Regierapport.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {!zeigeErledigte && lokal.map((e) => {
              const p = e.payload as LokalPayload;
              const b = baustellen.find((x) => x.id === p.baustelle_id);
              return (
                <div key={e.client_uuid} className="rounded-[18px] border border-dashed border-amber/50 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[15px] font-semibold">{b?.bezeichnung ?? b?.konto_nr ?? 'Baustelle'}</span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-deep"><CloudOff size={13} aria-hidden="true" />wartet auf Netz</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink2">
                    {b && <span className="knr">{b.konto_nr}</span>}
                    <span>{TAETIGKEIT_LABEL[p.taetigkeit ?? ''] ?? p.taetigkeit ?? '—'}</span>
                    <span className="text-ink3">·</span>
                    <span>{p.besteller_name ?? '—'}</span>
                  </p>
                </div>
              );
            })}

            {sichtbar.length === 0 && (zeigeErledigte || lokal.length === 0) && (
              <div className="card text-sm text-ink3 lg:col-span-2">
                {zeigeErledigte ? 'Noch nichts erledigt.' : erledigte.length > 0 ? 'Nichts offen — alles im Regierapport oder beim Kunden.' : 'Noch keine — der nächste Kundenanruf landet hier.'}
              </div>
            )}

            {sichtbar.map((a) => {
              const KanalIcon = KANAL_ICON[a.kanal] ?? Phone;
              const offen = a.stand === 'bestellt' || a.stand === 'gemeldet';
              return (
                <article key={a.id} className={'overflow-hidden rounded-[18px] border bg-white shadow-[0_1px_2px_rgb(17_17_19/0.04),0_10px_28px_-18px_rgb(17_17_19/0.28)] ' + (a.ohne_meldung ? 'border-amber/50' : 'border-ink/[0.06]')}>
                  <div className="flex gap-4 p-4">
                    <DatumKachel iso={a.geplant_fuer} heuteIso={heuteIso} warn={a.ohne_meldung} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 truncate font-display text-[15px] font-semibold">{a.baustelle_bezeichnung ?? a.konto_nr}</h3>
                        <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ' + (STAND_STIL[a.stand] ?? 'bg-ground text-ink3')}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {STAND_LABEL[a.stand] ?? a.stand}
                        </span>
                      </div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink2">
                        <span className="knr">{a.konto_nr}</span>
                        <span className="font-semibold text-ink">{TAETIGKEIT_LABEL[a.taetigkeit] ?? a.taetigkeit}</span>
                        <span className="inline-flex items-center gap-1"><KanalIcon size={12} className="text-ink3" aria-hidden="true" />{a.besteller_name}</span>
                        {a.notiz && <span className="text-ink3">«{a.notiz}»</span>}
                      </p>
                      {a.stand !== 'erledigt_ohne_regie' && <Fortschritt stand={a.stand} />}
                    </div>
                  </div>

                  {erledigen === a.id && (
                    <div className="mx-4 mb-3 space-y-2 rounded-[12px] bg-ground p-3">
                      <p className="text-xs font-semibold">Warum gibt es keine Regie?</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {GRUENDE.map(([code, text]) => (
                          <button key={code} type="button" onClick={() => void ohneRegieErledigen(a, code)} className="chip text-xs">{text}</button>
                        ))}
                      </div>
                      <button type="button" onClick={() => setErledigen(null)} className="text-xs text-ink3">Abbrechen</button>
                    </div>
                  )}

                  {/* Fusszeile: woher der Stand kommt (benannte Quelle statt Urteil) und der eine Handgriff */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line bg-surface-2/40 px-4 py-2.5 text-xs">
                    <span className="min-w-0 text-ink3">
                      {a.stand === 'gemeldet' && a.gemeldet_am && (
                        <>
                          gemeldet am {kurz(ausIso(a.gemeldet_am))}{a.gemeldet_von_team ? ` von ${a.gemeldet_von_team}` : ''} ·{' '}
                          {meldungLinks[a.id]
                            ? <Link to={meldungLinks[a.id]} className="font-semibold text-steel" title="Meldung ansehen und Regierapport vorrechnen">Meldung ansehen ›</Link>
                            : <Link to={`/cockpit?woche=${a.gemeldet_am}&tag=${a.gemeldet_am}`} className="font-semibold text-steel">in der Wochenübersicht ansehen ›</Link>}
                        </>
                      )}
                      {(a.stand === 'im_regierapport' || a.stand === 'beim_kunden' || a.stand === 'bestaetigt') && a.regierapport_id && (
                        <Link to={`/regie/${a.regierapport_id}`} className="font-semibold text-steel">Regierapport {a.regierapport_nummer ?? ''} ›</Link>
                      )}
                      {a.stand === 'bestellt' && normalGemeldet[a.id] && (
                        <>
                          {normalGemeldet[a.id].team} hat am {kurz(ausIso(normalGemeldet[a.id].datum))} hier gemeldet — ohne Überstunden ·{' '}
                          <Link to={normalGemeldet[a.id].link} className="font-semibold text-steel" title="Meldung ansehen: Zusatzarbeit gemacht?">Meldung ansehen ›</Link>
                        </>
                      )}
                      {a.stand === 'bestellt' && !normalGemeldet[a.id] && a.ohne_meldung && (
                        <span className="font-semibold text-amber-deep">Geplanter Tag vorbei, noch keine Meldung vom Team — nachfragen?</span>
                      )}
                      {a.stand === 'bestellt' && !normalGemeldet[a.id] && !a.ohne_meldung && <>wartet auf die Meldung des Teams</>}
                      {a.stand === 'erledigt_ohne_regie' && (
                        <>{GRUND_LABEL[a.erledigt_grund ?? ''] ?? a.erledigt_grund}{a.erledigt_am ? ` · ${kurz(new Date(a.erledigt_am))}` : ''}</>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {offen && erledigen !== a.id && (
                        <button type="button" onClick={() => setErledigen(a.id)} className="font-semibold text-ink3 hover:text-ink">erledigt ohne Regie …</button>
                      )}
                    </span>
                    {a.stand === 'erledigt_ohne_regie' && (
                      <button type="button" onClick={() => void wiederOeffnen(a)} className="shrink-0 font-semibold text-steel">wieder öffnen</button>
                    )}
                  </div>
                </article>
              );
            })}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

const KANAL_ICON: Record<string, LucideIcon> = { telefon: Phone, mail: Mail, vor_ort: MapPin };
const TAETIGKEIT_ICON: Record<string, LucideIcon> = {
  versetzen: MoveHorizontal, ergaenzen: SquarePlus, reparieren: Wrench, teilabbau: SquareMinus, reinigen: Sparkles, anderes: Ellipsis,
};

/** Nummerierter Formularschritt. */
function Schritt({ nr, titel, children }: { nr: number; titel: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">{nr}</span>
        {titel}
      </p>
      {children}
    </div>
  );
}

/** Geplanter Tag als kleines Kalenderblatt — heute rot, verpasst bernstein, ohne Datum ein Strich. */
function DatumKachel({ iso, heuteIso, warn }: { iso: string | null; heuteIso: string; warn: boolean }) {
  if (!iso) {
    return <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-xs text-ink3" aria-label="ohne Datum">—</span>;
  }
  const d = ausIso(iso);
  const tage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const heute = iso === heuteIso;
  const stil = warn ? 'bg-amber-soft text-amber-deep ring-amber/40' : heute ? 'bg-accent-soft text-accent-deep ring-accent/30' : 'bg-white text-ink ring-ink/10';
  return (
    <span className={'flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[14px] ring-1 ' + stil}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{heute ? 'heute' : tage[d.getDay()]}</span>
      <span className="font-display text-[17px] font-semibold leading-tight tabular-nums">{d.getDate()}.{d.getMonth() + 1}.</span>
    </span>
  );
}

const STUFEN: { stand: Auftrag['stand']; label: string }[] = [
  { stand: 'bestellt', label: 'Bestellt' },
  { stand: 'gemeldet', label: 'Gemeldet' },
  { stand: 'im_regierapport', label: 'Rapport' },
  { stand: 'beim_kunden', label: 'Kunde' },
  { stand: 'bestaetigt', label: 'Bestätigt' },
];

/** Wo der Auftrag steht — fünf Stufen, die erreichten ausgefüllt. */
function Fortschritt({ stand }: { stand: Auftrag['stand'] }) {
  const erreicht = STUFEN.findIndex((s) => s.stand === stand);
  return (
    <ol className="mt-3 flex items-center gap-1" aria-label={`Stand: ${STAND_LABEL[stand]}`}>
      {STUFEN.map((s, i) => (
        <li key={s.stand} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={'h-1.5 rounded-full ' + (i <= erreicht ? (stand === 'bestaetigt' ? 'bg-good' : 'bg-steel') : 'bg-ink/10')} />
          <span className={'truncate text-[10px] ' + (i === erreicht ? 'font-semibold text-ink' : 'text-ink3')}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
