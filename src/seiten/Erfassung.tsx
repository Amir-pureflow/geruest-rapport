import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { enqueueMeldung, flushNachSupabase, offeneMeldungen, offeneAnzahl, type MeldungPayload } from '../lib/db';
import { addTage, iso, lang } from '../lib/datum';

/**
 * Phase 2 — das Teamgerät. Ein Chefmonteur meldet für sein Team.
 *
 * Harte Regeln: keine Tastatur, keine Liste über 5 Einträgen, alles offline.
 * Normalfall = ein Knopf. Abweichung = Symbol → «Wer wollte das?» → kurz erzählen.
 * Es wird nie gefragt, OB etwas Regie ist — das kann der Monteur nicht wissen.
 */

interface Team { id: string; bezeichnung: string; fahrzeug: string | null }
interface Person { id: string; name: string; typ: string; funktion: string; oev_standard: boolean; km_standard: number }
interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null }
interface Anwesenheit { dabei: boolean; min: number; oev: boolean; km: number }

type Schritt = 'team' | 'tag' | 'symbol' | 'wer' | 'notiz';
type Abweichung = 'zusaetzlich' | 'warten' | 'kaputt';
type Wer = 'kunde' | 'chef' | 'niemand';

const TEAM_KEY = 'teamgeraet-team-id';
const STANDARD_MIN = 480;

const SYMBOLE: { typ: Abweichung; label: string; svg: ReactElement }[] = [
  {
    typ: 'zusaetzlich', label: 'zusätzlich gearbeitet',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9" fill="currentColor"><rect x="17" y="8" width="6" height="24" rx="2" /><rect x="8" y="17" width="24" height="6" rx="2" /></svg>,
  },
  {
    typ: 'warten', label: 'warten müssen',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none" stroke="currentColor"><circle cx="20" cy="20" r="13" strokeWidth="3.5" /><path d="M20 12v8.5l6 3.5" strokeWidth="3.5" strokeLinecap="round" /></svg>,
  },
  {
    typ: 'kaputt', label: 'etwas kaputt / repariert',
    svg: <svg viewBox="0 0 40 40" className="h-9 w-9"><path d="M20 7 L34 31 H6 Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" /><rect x="18.2" y="15" width="3.6" height="8" rx="1.8" fill="currentColor" /><circle cx="20" cy="26.5" r="2" fill="currentColor" /></svg>,
  },
];

function Helm({ farbe }: { farbe: string }) {
  return (
    <svg viewBox="0 0 48 40" className="h-10 w-12" aria-hidden="true">
      <path d="M11 28a13 13 0 0 1 26 0z" fill={farbe} />
      <rect x="5" y="28" width="38" height="5" rx="2.5" fill={farbe} />
    </svg>
  );
}

function Stepper({ wert, setWert, schritt, min, format }: { wert: number; setWert: (v: number) => void; schritt: number; min: number; format: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] border border-line-strong bg-surface-2 px-2 py-1">
      <button type="button" onClick={() => setWert(Math.max(min, wert - schritt))} className="px-3 py-1.5 font-mono text-xl text-steel">◄</button>
      <span className="font-mono text-xl font-semibold tabular-nums">{format(wert)}</span>
      <button type="button" onClick={() => setWert(wert + schritt)} className="px-3 py-1.5 font-mono text-xl text-steel">►</button>
    </div>
  );
}

export function Erfassung() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [leute, setLeute] = useState<Person[]>([]);
  const [kacheln, setKacheln] = useState<Baustelle[]>([]);
  const [alleGeplanten, setAlleGeplanten] = useState<Baustelle[]>([]);
  const [zeigeAndere, setZeigeAndere] = useState(false);
  const [suche, setSuche] = useState('');
  const [suchTreffer, setSuchTreffer] = useState<Baustelle[]>([]);
  const [baustelle, setBaustelle] = useState<Baustelle | null>(null);
  const [teamMin, setTeamMin] = useState(STANDARD_MIN);
  const [anw, setAnw] = useState<Record<string, Anwesenheit>>({});
  const [anreiseOffen, setAnreiseOffen] = useState<string | null>(null);
  const [schritt, setSchritt] = useState<Schritt>(teamId ? 'tag' : 'team');
  const [abweichung, setAbweichung] = useState<Abweichung | null>(null);
  const [wer, setWer] = useState<Wer | null>(null);
  const [abMin, setAbMin] = useState(60);
  const [abLeute, setAbLeute] = useState<Set<string>>(new Set());
  const [aufnahme, setAufnahme] = useState<{ blob: Blob; sekunden: number } | null>(null);
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [sekunden, setSekunden] = useState(0);
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState('');
  const [heuteGemeldet, setHeuteGemeldet] = useState<{ bezeichnung: string; normalfall: boolean; lokal: boolean }[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [wartend, setWartend] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const ticker = useRef<number | null>(null);

  const heute = new Date();
  const heuteIso = iso(heute);
  const team = teams.find((t) => t.id === teamId) ?? null;

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('team').select('id,bezeichnung,fahrzeug').eq('aktiv', true).order('bezeichnung').then(({ data }) => data && setTeams(data));
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    void offeneAnzahl().then(setWartend);
  }, []);

  const heutigeLaden = useCallback(async () => {
    if (!teamId) return;
    const lokal = (await offeneMeldungen()).filter((m) => (m.payload as unknown as MeldungPayload).team_id === teamId && (m.payload as unknown as MeldungPayload).datum === heuteIso);
    const liste: typeof heuteGemeldet = lokal.map((m) => {
      const p = m.payload as unknown as MeldungPayload;
      return { bezeichnung: kacheln.concat(alleGeplanten).find((b) => b.id === p.baustelle_id)?.bezeichnung ?? 'Baustelle', normalfall: p.normalfall, lokal: true };
    });
    if (supabase) {
      const { data } = await supabase.from('tagesmeldung').select('normalfall,baustelle:baustelle_id(bezeichnung)').eq('team_id', teamId).eq('datum', heuteIso);
      for (const d of (data ?? []) as unknown as { normalfall: boolean; baustelle: { bezeichnung: string | null } | null }[]) {
        liste.push({ bezeichnung: d.baustelle?.bezeichnung ?? 'Baustelle', normalfall: d.normalfall, lokal: false });
      }
    }
    setHeuteGemeldet(liste);
  }, [teamId, heuteIso, kacheln, alleGeplanten]);

  // Team gewählt → Leute, Kacheln (Plan + zuletzt), Vorbelegung
  useEffect(() => {
    if (!supabase || !teamId) return;
    const client = supabase;
    void (async () => {
      const { data: mg } = await client
        .from('team_mitglied')
        .select('mitarbeiter:mitarbeiter_id(id,name,typ,funktion,oev_standard,km_standard,aktiv)')
        .eq('team_id', teamId)
        .is('bis', null);
      const personen = ((mg ?? []) as unknown as { mitarbeiter: Person & { aktiv: boolean } }[])
        .map((r) => r.mitarbeiter)
        .filter((p) => p && p.aktiv)
        .sort((a, b) => a.name.localeCompare(b.name));
      setLeute(personen);
      const a: Record<string, Anwesenheit> = {};
      for (const p of personen) a[p.id] = { dabei: true, min: STANDARD_MIN, oev: p.oev_standard, km: p.km_standard };
      setAnw(a);

      const [plan, zuletzt] = await Promise.all([
        client.from('jahresplan').select('von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).order('von'),
        client.from('tagesmeldung').select('datum,baustelle:baustelle_id(id,konto_nr,bezeichnung)').eq('team_id', teamId).gte('datum', iso(addTage(heute, -14))).order('datum', { ascending: false }).limit(40),
      ]);
      const gesehen = new Set<string>();
      const tiles: Baustelle[] = [];
      const push = (b: Baustelle | null) => { if (b && !gesehen.has(b.id) && tiles.length < 4) { gesehen.add(b.id); tiles.push(b); } };
      for (const z of (zuletzt.data ?? []) as unknown as { baustelle: Baustelle | null }[]) push(z.baustelle);
      const planRows = (plan.data ?? []) as unknown as { von: string; bis: string; baustelle: Baustelle | null }[];
      for (const p of planRows) if (p.von <= heuteIso && p.bis >= heuteIso) push(p.baustelle);
      for (const p of planRows) push(p.baustelle);
      setKacheln(tiles);
      setAlleGeplanten(planRows.map((p) => p.baustelle).filter((b): b is Baustelle => !!b));
      setBaustelle(tiles[0] ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => { void heutigeLaden(); }, [heutigeLaden]);

  // Ausnahme für den Chefmonteur: Suche nach Nummer/Name, falls die Kacheln nicht reichen
  useEffect(() => {
    if (!supabase || suche.trim().length < 2) { setSuchTreffer([]); return; }
    const q = suche.trim();
    const client = supabase;
    const t = setTimeout(() => {
      void client.from('baustelle').select('id,konto_nr,bezeichnung').or(`bezeichnung.ilike.%${q}%,konto_nr.like.${q}%`).limit(5).then(({ data }) => data && setSuchTreffer(data));
    }, 200);
    return () => clearTimeout(t);
  }, [suche]);

  function teamWaehlen(id: string) {
    localStorage.setItem(TEAM_KEY, id);
    setTeamId(id);
    setSchritt('tag');
  }

  const dabei = useMemo(() => leute.filter((p) => anw[p.id]?.dabei), [leute, anw]);

  function setzeTeamMin(v: number) {
    setTeamMin(v);
    setAnw((alt) => Object.fromEntries(Object.entries(alt).map(([k, a]) => [k, { ...a, min: v }])));
  }

  async function speichern(normal: boolean) {
    if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; }
    if (dabei.length === 0) { setHinweis('Niemand angehakt.'); return; }
    setHinweis('');
    const beteiligt = normal ? dabei : dabei.filter((p) => abLeute.has(p.id));
    const payload: MeldungPayload = {
      id: crypto.randomUUID(), team_id: teamId!, datum: heuteIso, baustelle_id: baustelle.id,
      normalfall: normal, abweichung_typ: normal ? null : abweichung, wer_hats_gewollt: normal ? null : wer,
      audio_sekunden: normal ? null : aufnahme?.sekunden ?? null, erfasst_von: userId,
      eintraege: beteiligt.map((p) => {
        const a = anw[p.id];
        const min = normal ? a.min : abMin;
        return { id: crypto.randomUUID(), mitarbeiter_id: p.id, normal_min: Math.min(min, 480), ueber_min: Math.max(0, min - 480), oev: normal ? a.oev : false, km: normal ? a.km : 0, baustelle_id: baustelle.id, konto_nr: baustelle.konto_nr };
      }),
    };
    await enqueueMeldung(payload, normal ? undefined : aufnahme?.blob);
    setGespeichert('Lokal gespeichert …');
    if (supabase && navigator.onLine) {
      const erg = await flushNachSupabase(supabase);
      if (erg.fehler > 0) {
        // Ehrlich bleiben: auf dem Gerät ist es sicher, aber der Server hat abgelehnt — Grund zeigen
        setHinweis(`Auf dem Gerät gespeichert, aber noch nicht gesendet: ${erg.fehlerText ?? 'unbekannter Fehler'}`);
        setGespeichert('Lokal gespeichert — Senden fehlgeschlagen');
      } else {
        setGespeichert(normal ? 'Gespeichert ✓' : 'Abweichung gespeichert ✓');
      }
    } else {
      setGespeichert('Gespeichert — wird gesendet, sobald Netz da ist');
    }
    void heutigeLaden();
    void offeneAnzahl().then(setWartend);
    setTimeout(() => setGespeichert(null), 3500);
    setAbweichung(null); setWer(null); setAufnahme(null); setAbMin(60); setAbLeute(new Set());
    setSchritt('tag');
  }

  // Sprachnotiz — gedrückt halten / antippen
  async function aufnahmeStart() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const teile: BlobPart[] = [];
      rec.ondataavailable = (ev) => teile.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setAufnahme({ blob: new Blob(teile, { type: mime || 'audio/webm' }), sekunden: Math.max(1, Math.round((Date.now() - start) / 1000)) });
        setNimmtAuf(false);
        if (ticker.current) window.clearInterval(ticker.current);
      };
      const start = Date.now();
      recorder.current = rec;
      rec.start();
      setNimmtAuf(true);
      setSekunden(0);
      ticker.current = window.setInterval(() => setSekunden(Math.round((Date.now() - start) / 1000)), 250);
    } catch {
      setHinweis('Mikrofon nicht verfügbar — die Meldung geht auch ohne Sprachnotiz.');
    }
  }
  function aufnahmeStop() {
    recorder.current?.stop();
  }

  // ── Ansichten ──────────────────────────────────────────────────────────────

  if (schritt === 'team') {
    return (
      <Shell zurueck>
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-bold">Welches Team?</h1>
          <p className="text-sm text-ink3">Einmal wählen — das Gerät merkt es sich.</p>
          <div className="grid grid-cols-2 gap-2">
            {teams.map((t) => (
              <button key={t.id} type="button" onClick={() => teamWaehlen(t.id)} className="chip py-4 text-base">
                {t.bezeichnung}
              </button>
            ))}
          </div>
          {teams.length === 0 && <p className="card text-sm text-ink3">Keine Teams — unter Verwaltung anlegen oder den Demo-Betrieb laden.</p>}
        </div>
      </Shell>
    );
  }

  if (schritt === 'symbol') {
    return (
      <Shell zurueck>
        <div className="space-y-4">
          <p className="lbl mb-0">Abweichung</p>
          <h1 className="font-display text-2xl font-bold">Was war anders?</h1>
          <div className="grid grid-cols-3 gap-2">
            {SYMBOLE.map((s) => (
              <button key={s.typ} type="button" onClick={() => { setAbweichung(s.typ); setAbLeute(new Set(dabei.map((p) => p.id))); setSchritt('wer'); }} className="chip flex flex-col items-center gap-2 py-5 text-ink2">
                {s.svg}
                <span className="text-xs leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSchritt('tag')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'wer') {
    return (
      <Shell zurueck>
        <div className="space-y-4">
          <p className="lbl mb-0">{SYMBOLE.find((s) => s.typ === abweichung)?.label}</p>
          <h1 className="font-display text-2xl font-bold">Wer wollte das?</h1>
          <div className="grid grid-cols-3 gap-2">
            {([['kunde', 'Kunde', '#E25A1C'], ['chef', 'Unser Chef', '#29506B'], ['niemand', 'Niemand', '']] as const).map(([w, label, farbe]) => (
              <button key={w} type="button" onClick={() => { setWer(w); setSchritt('notiz'); }} className="chip flex flex-col items-center gap-2 py-5">
                {farbe ? <Helm farbe={farbe} /> : (
                  <svg viewBox="0 0 48 40" className="h-10 w-12" aria-hidden="true"><circle cx="24" cy="20" r="12" fill="none" stroke="#6C7B81" strokeWidth="3" /><line x1="15.5" y1="28.5" x2="32.5" y2="11.5" stroke="#6C7B81" strokeWidth="3" /></svg>
                )}
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink3">Kunde = der Bauleiter hat es angeordnet · Unser Chef = kam von uns · Niemand = selbst gemacht, meist weil etwas kaputt war</p>
          <button type="button" onClick={() => setSchritt('symbol')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  if (schritt === 'notiz') {
    return (
      <Shell zurueck>
        <div className="space-y-4">
          <p className="lbl mb-0">{SYMBOLE.find((s) => s.typ === abweichung)?.label} · {wer === 'kunde' ? 'Kunde' : wer === 'chef' ? 'unser Chef' : 'niemand'}</p>
          <h1 className="font-display text-2xl font-bold">Wie lange?</h1>
          <Stepper wert={abMin} setWert={setAbMin} schritt={30} min={30} format={(v) => (v / 60).toFixed(1) + ' h'} />

          <div>
            <p className="lbl">Wer war dabei</p>
            <div className="grid grid-cols-2 gap-2">
              {dabei.map((p) => (
                <button key={p.id} type="button" onClick={() => setAbLeute((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className={'chip text-left ' + (abLeute.has(p.id) ? 'chip-on' : '')}>
                  {abLeute.has(p.id) ? '✓ ' : ''}{p.name}
                </button>
              ))}
            </div>
          </div>

          <div className={'rounded-[14px] border-2 border-dashed p-5 text-center ' + (nimmtAuf ? 'border-accent bg-accent-soft' : 'border-steel bg-steel-soft')}>
            {aufnahme ? (
              <div className="space-y-2">
                <p className="font-display font-bold">Sprachnotiz · {aufnahme.sekunden} Sek. ✓</p>
                <audio controls src={URL.createObjectURL(aufnahme.blob)} className="mx-auto h-9 w-full max-w-xs" />
                <button type="button" onClick={() => setAufnahme(null)} className="btn-ghost">nochmal</button>
              </div>
            ) : (
              <button type="button" onClick={() => (nimmtAuf ? aufnahmeStop() : void aufnahmeStart())} className="w-full">
                <svg viewBox="0 0 40 48" className="mx-auto h-11 w-9" aria-hidden="true" fill={nimmtAuf ? '#E25A1C' : '#29506B'}>
                  <rect x="13" y="4" width="14" height="24" rx="7" />
                  <path d="M8 22a12 12 0 0 0 24 0" fill="none" stroke={nimmtAuf ? '#E25A1C' : '#29506B'} strokeWidth="3.5" strokeLinecap="round" />
                  <rect x="18.2" y="34" width="3.6" height="8" rx="1.8" />
                </svg>
                <span className="mt-2 block font-display font-bold">{nimmtAuf ? `Aufnahme läuft · ${sekunden} Sek. — antippen zum Stoppen` : 'Antippen und kurz erzählen, was war'}</span>
                <span className="mt-1 block text-xs text-ink3">In deiner Sprache. Freiwillig — die Meldung geht auch ohne.</span>
              </button>
            )}
          </div>

          <button type="button" onClick={() => void speichern(false)} className="cta">Speichern</button>
          {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}
          <button type="button" onClick={() => setSchritt('wer')} className="btn-ghost w-full">Zurück</button>
        </div>
      </Shell>
    );
  }

  // Hauptansicht: der normale Tag
  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">{lang(heute)}</h1>
            <button type="button" onClick={() => setSchritt('team')} className="mt-0.5 text-xs font-semibold text-steel">
              {team?.bezeichnung ?? 'Team'}{team?.fahrzeug ? ` · ${team.fahrzeug}` : ''} · ändern
            </button>
          </div>
          <span className="font-mono text-xs text-ink3">
            {navigator.onLine ? 'online' : 'offline'}
            {wartend > 0 && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-deep">{wartend} wartet</span>}
          </span>
        </header>

        <section>
          <p className="lbl">Wo wart ihr?</p>
          <div className="grid grid-cols-2 gap-2">
            {kacheln.map((b, i) => (
              <button key={b.id} type="button" onClick={() => setBaustelle(b)} className={'chip flex min-h-[4.5rem] flex-col items-start justify-center py-2.5 text-left ' + (baustelle?.id === b.id ? 'chip-on' : '')}>
                <span className="text-sm font-bold leading-tight">{b.bezeichnung}</span>
                <span className="mt-1 flex items-center gap-1.5"><span className="knr">{b.konto_nr}</span>{i === 0 && <span className="text-[10px] text-ink3">zuletzt</span>}</span>
              </button>
            ))}
            <button type="button" onClick={() => setZeigeAndere((v) => !v)} className="chip flex min-h-[4.5rem] items-center justify-center text-ink3">andere Baustelle …</button>
          </div>
          {zeigeAndere && (
            <div className="card mt-2 space-y-2 p-3">
              {alleGeplanten.filter((b) => !kacheln.some((k) => k.id === b.id)).slice(0, 5).map((b) => (
                <button key={b.id} type="button" onClick={() => { setBaustelle(b); setZeigeAndere(false); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-ground">
                  <span>{b.bezeichnung}</span><span className="knr">{b.konto_nr}</span>
                </button>
              ))}
              <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Nummer oder Strasse (nur Chefmonteur)" inputMode="search" className="field text-sm" />
              {suchTreffer.map((b) => (
                <button key={b.id} type="button" onClick={() => { setBaustelle(b); setZeigeAndere(false); setSuche(''); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-ground">
                  <span>{b.bezeichnung}</span><span className="knr">{b.konto_nr}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="lbl">Wer war dabei</p>
          <div className="card divide-y divide-line p-0">
            {leute.map((p) => {
              const a = anw[p.id];
              if (!a) return null;
              return (
                <div key={p.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, dabei: !a.dabei } }))} className={'flex h-8 w-8 flex-none items-center justify-center rounded-md border text-lg font-bold ' + (a.dabei ? 'border-good bg-good text-white' : 'border-line-strong text-ink3')}>
                      {a.dabei ? '✓' : ''}
                    </button>
                    <span className={'min-w-0 flex-1 truncate text-sm ' + (a.dabei ? 'font-medium' : 'text-ink3 line-through')}>
                      {p.name}{p.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}
                    </span>
                    {a.dabei && (
                      <>
                        <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, min: Math.max(30, a.min - 30) } }))} className="btn-ghost px-2">−</button>
                        <span className="w-11 text-center font-mono text-sm tabular-nums">{(a.min / 60).toFixed(1)}</span>
                        <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, min: a.min + 30 } }))} className="btn-ghost px-2">+</button>
                        <button type="button" onClick={() => setAnreiseOffen(anreiseOffen === p.id ? null : p.id)} className="btn-ghost px-2 text-[11px]">{a.oev ? 'öV' : a.km > 0 ? `${a.km} km` : '–'}</button>
                      </>
                    )}
                  </div>
                  {anreiseOffen === p.id && a.dabei && (
                    <div className="mt-2 flex items-center gap-2 pl-10">
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, oev: !a.oev, km: a.oev ? a.km : 0 } }))} className={'chip px-3 py-1.5 text-xs ' + (a.oev ? 'chip-on' : '')}>öV</button>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: Math.max(0, a.km - 5), oev: false } }))} className="btn-ghost px-2">−</button>
                      <span className="font-mono text-xs tabular-nums">{a.km} km</span>
                      <button type="button" onClick={() => setAnw((s) => ({ ...s, [p.id]: { ...a, km: a.km + 5, oev: false } }))} className="btn-ghost px-2">+</button>
                    </div>
                  )}
                </div>
              );
            })}
            {leute.length === 0 && <p className="p-3 text-sm text-ink3">Keine Mitglieder in diesem Team.</p>}
          </div>
        </section>

        <section>
          <p className="lbl">Wie lange — alle</p>
          <Stepper wert={teamMin} setWert={setzeTeamMin} schritt={30} min={30} format={(v) => (v / 60).toFixed(1) + ' h'} />
        </section>

        <button type="button" onClick={() => void speichern(true)} className="cta cta-good py-5">
          {gespeichert ?? '✓ Alles wie geplant'}
        </button>
        {hinweis && <p className="text-sm font-semibold text-accent-deep">{hinweis}</p>}

        <div>
          <p className="mb-2 text-center text-sm text-ink3">War etwas anders?</p>
          <div className="grid grid-cols-3 gap-2">
            {SYMBOLE.map((s) => (
              <button key={s.typ} type="button" onClick={() => { if (!baustelle) { setHinweis('Zuerst die Baustelle antippen.'); return; } setAbweichung(s.typ); setAbLeute(new Set(dabei.map((p) => p.id))); setSchritt('wer'); }} className="chip flex flex-col items-center gap-1.5 py-3 text-ink2">
                {s.svg}
                <span className="text-[11px] leading-tight">{s.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {heuteGemeldet.length > 0 && (
          <section className="card">
            <p className="lbl">Heute gemeldet</p>
            <ul className="space-y-1 text-sm">
              {heuteGemeldet.map((m, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>{m.normalfall ? '✓' : '⚑'} {m.bezeichnung}{!m.normalfall && <span className="ml-1 text-xs text-accent-deep">Abweichung</span>}</span>
                  <span className="font-mono text-[11px] text-ink3">{m.lokal ? 'wartet auf Netz' : 'gesendet'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink3">Noch eine Baustelle heute? Oben antippen und nochmals speichern.</p>
          </section>
        )}
      </div>
    </Shell>
  );
}
