import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Navigation, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { alle } from '../../lib/abfrage';
import { ausIso, iso, kurz, lang } from '../../lib/datum';
import { baustellenSuchen } from '../../lib/suche';
import { hatKoordinaten, istApple, navigationsLink, suchText, type Treffer } from '../../lib/adresse';
import { AdressSuche } from '../../ui/AdressSuche';
import { Auswahl } from '../../ui/Auswahl';
import { LoeschLeiste, useLoeschFrage } from '../../ui/LoeschFrage';
import { baustelleEntfernen, baustellePruefen } from '../../lib/entfernen';

// Karte mit verschiebbarem Punkt (Schritt 7) — nachgeladen, die Kartenbibliothek ist gross
const OrtWahl = lazy(() => import('../../ui/OrtWahl').then((m) => ({ default: m.OrtWahl })));

interface Baustelle {
  id: string; konto_nr: string; bezeichnung: string | null; plz: string | null; status: 'aktiv' | 'fertig_gemeldet' | 'abgeschlossen'; fertigstellung_am: string | null; kunde_id: string | null;
  /** Adresse und Lage (Strasse/Ort seit 0001, Koordinaten seit 0050) — ohne 0050 undefined */
  strasse?: string | null; ort?: string | null; lat?: number | null; lon?: number | null; lage_quelle?: 'suche' | 'von_hand' | null; lage_geprueft_am?: string | null;
}
interface Kunde { id: string; name: string }

const SPALTEN = 'id,konto_nr,bezeichnung,plz,status,fertigstellung_am,kunde_id,strasse,ort,lat,lon,lage_quelle,lage_geprueft_am';
/** Ohne Migration 0050 */
const SPALTEN_ALT = 'id,konto_nr,bezeichnung,plz,status,fertigstellung_am,kunde_id';

/**
 * Adresse der Baustelle (24.10.2026, Amir: Karte und Navigieren). «Adresse prüfen» sucht bei der Adresssuche des Bundes
 * (geo.admin.ch) mit Bezeichnung und PLZ; das Büro tippt den richtigen Treffer an — gespeichert werden Strasse, PLZ, Ort
 * und die Koordinaten. Nichts wird ungefragt übernommen: «Lorrainestrasse 18» ohne PLZ fand zuerst Herzogenbuchsee.
 * Darunter die Karte (25.10.2026, Schritt 7): Punkt ziehen oder tippen, wenn die Zufahrt nicht an der Adresse liegt —
 * gespeichert als «von Hand gesetzt», auch ganz ohne Adresse.
 */
function AdresseFeld({ b, speichern, naehe, sofortSuchen = false }: {
  b: Baustelle;
  speichern: (patch: Partial<Baustelle>) => Promise<string | null>;
  /** Gebiet der Firma (Mittelpunkt der geprüften Baustellen) — nähere Treffer zuerst */
  naehe: { lat: number; lon: number } | null;
  sofortSuchen?: boolean;
}) {
  const [offen, setOffen] = useState(sofortSuchen);
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null);
  const apple = istApple(navigator.userAgent, navigator.maxTouchPoints);

  async function waehlen(t: Treffer) {
    const f = await speichern({ strasse: t.strasse, plz: t.plz, ort: t.ort, lat: t.lat, lon: t.lon, lage_quelle: 'suche', lage_geprueft_am: new Date().toISOString() });
    setMeldung(f ? { text: 'Nicht gespeichert: ' + f, ok: false } : { text: 'Adresse gespeichert ✓', ok: true });
    if (!f) setOffen(false);
  }
  async function entfernen() {
    // Die PLZ kam mit dem Treffer — sie geht mit, sonst bliebe die PLZ einer falschen Adresse stehen («7610» aus Soglio)
    const f = await speichern({ strasse: null, ort: null, plz: b.ort ? null : b.plz, lat: null, lon: null, lage_quelle: null, lage_geprueft_am: null });
    setMeldung(f ? { text: 'Nicht gespeichert: ' + f, ok: false } : { text: 'Adresse entfernt.', ok: true });
  }

  const geprueft = hatKoordinaten(b);
  return (
    <div className="space-y-2">
      <span className="lbl">Adresse</span>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-white px-3 py-2.5">
        <span className="flex min-w-0 items-start gap-2">
          <MapPin size={16} className={'mt-0.5 shrink-0 ' + (geprueft ? 'text-good' : 'text-ink3')} aria-hidden="true" />
          <span className="min-w-0">
            {b.strasse || b.ort ? (
              <span className="block text-sm font-medium text-ink">{[b.strasse, [b.plz, b.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
            ) : (
              <span className="block text-sm text-ink3">{geprueft ? 'Keine Adresse — nur der Punkt auf der Karte.' : 'Noch keine Adresse — «Adresse prüfen» sucht mit der Bezeichnung.'}</span>
            )}
            <span className={'block text-[11px] ' + (geprueft ? 'text-good-deep' : 'text-amber-deep')}>
              {geprueft
                ? `${b.lage_quelle === 'von_hand' ? 'Punkt von Hand gesetzt' : 'Ort geprüft'}${b.lage_geprueft_am ? ` am ${kurz(new Date(b.lage_geprueft_am))}` : ''} — «Navigieren» führt genau hierhin`
                : 'Ort nicht geprüft — «Navigieren» sucht nur nach dem Text'}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {(b.strasse || b.bezeichnung) && (
            <a href={navigationsLink(b, apple)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-steel hover:underline">
              <Navigation size={13} aria-hidden="true" /> Navigieren testen
            </a>
          )}
          <button type="button" onClick={() => { setOffen(!offen); setMeldung(null); }} className="btn-ghost py-1.5 text-xs">
            {offen ? 'Schliessen' : geprueft ? 'Ändern' : 'Adresse prüfen'}
          </button>
        </span>
      </div>
      {offen && (
        <AdressSuche start={suchText(b)} plz={b.plz} naehe={naehe} onWaehlen={(t) => void waehlen(t)}
          fuss={(b.strasse || geprueft) && <button type="button" onClick={() => void entfernen()} className="font-semibold text-ink3 hover:text-accent-deep">Adresse entfernen</button>} />
      )}
      {meldung && <p className={'text-xs ' + (meldung.ok ? 'text-good-deep' : 'font-semibold text-accent-deep')}>{meldung.text}</p>}
      <Suspense fallback={<div className="h-64 rounded-[12px] border border-line bg-white sm:h-72" />}>
        <OrtWahl lat={b.lat ?? null} lon={b.lon ?? null} naehe={naehe} vonHand={b.lage_quelle === 'von_hand'}
          onSpeichern={(o) => speichern({ lat: o.lat, lon: o.lon, lage_quelle: 'von_hand', lage_geprueft_am: new Date().toISOString() })} />
      </Suspense>
    </div>
  );
}

/**
 * Postleitzahl als eigenes Feld (13.10.2026, Amir: «dass man Postleitzahlen noch eingeben kann … separat»). Schweizer
 * PLZ = vier Ziffern; leer ist erlaubt. Ort und Strasse stehen weiter in der Bezeichnung («Zollikofen Waldstrasse 6»).
 */
function plzPruefen(roh: string): { plz: string | null } | { fehler: string } {
  const p = roh.trim();
  if (!p) return { plz: null };
  return /^\d{4}$/.test(p) ? { plz: p } : { fehler: 'Postleitzahl: vier Ziffern (z. B. 3052).' };
}

/** PLZ in der Detailansicht: speichert beim Verlassen des Feldes oder mit Enter, nur wenn sich etwas geändert hat. */
function PlzFeld({ wert, speichern }: { wert: string | null; speichern: (plz: string | null) => Promise<string | null> }) {
  const [text, setText] = useState(wert ?? '');
  const [hinweis, setHinweis] = useState('');
  useEffect(() => { setText(wert ?? ''); }, [wert]);
  async function fertig() {
    const p = plzPruefen(text);
    if ('fehler' in p) { setHinweis(p.fehler); return; }
    if (p.plz === (wert ?? null)) { setHinweis(''); return; }
    const f = await speichern(p.plz);
    setHinweis(f ? 'Nicht gespeichert: ' + f : 'Gespeichert ✓');
  }
  return (
    <div>
      <label className="lbl" htmlFor="bs-plz">Postleitzahl</label>
      <div className="flex items-center gap-2">
        <input id="bs-plz" value={text} onChange={(e) => { setText(e.target.value); setHinweis(''); }} onBlur={() => void fertig()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          inputMode="numeric" maxLength={4} placeholder="PLZ" className="field w-24 font-mono" />
        {hinweis && <span className={'text-xs ' + (hinweis.startsWith('Gespeichert') ? 'text-good-deep' : 'font-semibold text-accent-deep')}>{hinweis}</span>}
      </div>
    </div>
  );
}

const STATUS: Record<Baustelle['status'], [string, string]> = {
  aktiv: ['aktiv', 'bg-good-soft text-good-deep'],
  fertig_gemeldet: ['fertig gemeldet', 'bg-steel-soft text-steel'],
  abgeschlossen: ['abgeschlossen', 'bg-ground text-ink3'],
};

export function Baustellen() {
  const [liste, setListe] = useState<Baustelle[]>([]);
  const [kunden, setKunden] = useState<Kunde[]>([]);
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<'alle' | Baustelle['status']>('aktiv');
  const [offen, setOffen] = useState<string | null>(null);
  const [neuNr, setNeuNr] = useState('');
  const [neuBez, setNeuBez] = useState('');
  const [neuPlz, setNeuPlz] = useState('');
  const [fehler, setFehler] = useState('');
  const [ladeFehler, setLadeFehler] = useState('');
  const [legtAn, setLegtAn] = useState(false);
  const [hinweis, setHinweis] = useState('');
  /** Nur Baustellen ohne geprüften Ort — zum Nachtragen (die Gerüst GmbH hat 217 Konten ohne Adresse) */
  const [ohneOrt, setOhneOrt] = useState(false);
  /** Eben angelegt: Adresssuche gleich offen */
  const [neuAngelegt, setNeuAngelegt] = useState<string | null>(null);

  // Seitenweise (13.10.2026): heute 217 aktive, über die Jahre mehr als 1000 Konten — sonst fehlten die neuesten still
  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    try {
      const baustellen = (spalten: string) => alle<Baustelle>((von, bis) => c.from('baustelle').select(spalten).order('bezeichnung').order('id').range(von, bis));
      const [b, k] = await Promise.all([
        // Ohne Migration 0050 (Koordinaten) wie bisher
        baustellen(SPALTEN).catch((e: unknown) => (/lat|lage_quelle|column/i.test(e instanceof Error ? e.message : String(e)) ? baustellen(SPALTEN_ALT) : Promise.reject(e))),
        alle<Kunde>((von, bis) => c.from('kunde').select('id,name').order('name').order('id').range(von, bis)),
      ]);
      setListe(b);
      setKunden(k);
      setLadeFehler('');
    } catch (e) {
      setLadeFehler('Baustellen konnten nicht geladen werden: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  /**
   * Löschen (13.10.2026, Amir: «wenn es doch nicht ging mit dem Auftrag»): nur ohne Belege, geplante Einsätze gehen mit
   * (src/lib/entfernen.ts). Mit Meldungen, Zusatzauftrag oder Rapport sagt die Rückfrage, warum es nicht geht.
   */
  const loeschFrage = useLoeschFrage<Baustelle>(
    (b) => baustellePruefen(b),
    (b, entscheid) => baustelleEntfernen(b.id, entscheid),
    (b) => {
      setOffen(null);
      setHinweis(`«${b.bezeichnung ?? b.konto_nr}» ist gelöscht.`);
      void laden();
    },
  );

  const sichtbar = useMemo(() => {
    const q = suche.trim();
    const imFilter = liste.filter((b) => (filter === 'alle' || b.status === filter) && (!ohneOrt || !hatKoordinaten(b)));
    return q ? baustellenSuchen(imFilter, q, 60) : imFilter.slice(0, 60);
  }, [liste, suche, filter, ohneOrt]);

  async function aendern(id: string, patch: Partial<Baustelle>): Promise<string | null> {
    if (!supabase) return 'Keine Datenverbindung.';
    const { error } = await supabase.from('baustelle').update(patch).eq('id', id);
    if (error) setFehler(error.message);
    void laden();
    return error ? error.message : null;
  }
  async function anlegen() {
    if (!supabase || legtAn) return;
    if (!/^\d{6}$/.test(neuNr.trim())) { setFehler('Kontonummer: sechs Ziffern.'); return; }
    if (!neuBez.trim()) { setFehler('Bezeichnung fehlt.'); return; }
    const p = plzPruefen(neuPlz);
    if ('fehler' in p) { setFehler(p.fehler); return; }
    // Doppelklick: sonst meldete der zweite Klick «gibt es schon» über eine eben angelegte Baustelle
    setLegtAn(true);
    const { data, error } = await supabase.from('baustelle').insert({ konto_nr: neuNr.trim(), bezeichnung: neuBez.trim(), plz: p.plz }).select('id').single();
    setLegtAn(false);
    if (error) { setFehler(error.message.includes('unique') ? 'Diese Kontonummer gibt es schon.' : error.message); return; }
    setFehler(''); setNeuNr(''); setNeuBez(''); setNeuPlz('');
    // Gleich aufklappen und die Adresse suchen — dann hat jede neue Baustelle von Anfang an einen geprüften Ort
    const id = (data as { id: string } | null)?.id ?? null;
    setNeuAngelegt(id);
    setOffen(id);
    setFilter('aktiv');
    setSuche('');
    setOhneOrt(false);
    void laden();
  }

  const zaehl = (s: Baustelle['status']) => liste.filter((b) => b.status === s).length;
  // Gebiet der Firma für die Adresssuche: Mittelpunkt der schon geprüften Baustellen (später: der Werkhof)
  const naehe = useMemo(() => {
    const mit = liste.filter((b): b is Baustelle & { lat: number; lon: number } => hatKoordinaten(b));
    if (mit.length === 0) return null;
    return { lat: mit.reduce((s, b) => s + b.lat, 0) / mit.length, lon: mit.reduce((s, b) => s + b.lon, 0) / mit.length };
  }, [liste]);

  return (
    <div className="space-y-3">
      {ladeFehler && <p className="card text-sm font-semibold text-accent-deep">{ladeFehler}</p>}
      {hinweis && <p className="rounded-[12px] border border-good/30 bg-good-soft px-4 py-2 text-sm font-medium text-good-deep" role="status">{hinweis}</p>}
      <p className="text-sm text-ink2"><b className="text-ink">{liste.length}</b> Konten · {zaehl('aktiv')} aktiv · {zaehl('fertig_gemeldet')} fertig gemeldet · {zaehl('abgeschlossen')} abgeschlossen</p>

      <section className="card space-y-2 p-3">
        <p className="lbl mb-0">Neue Baustelle (bei Auftragsbestätigung)</p>
        <div className="flex gap-2">
          <input value={neuNr} onChange={(e) => setNeuNr(e.target.value)} placeholder="Konto-Nr." inputMode="numeric" className="field w-28 font-mono" />
          <input value={neuPlz} onChange={(e) => setNeuPlz(e.target.value)} placeholder="PLZ" inputMode="numeric" maxLength={4} aria-label="Postleitzahl" className="field w-20 font-mono" />
          <input value={neuBez} onChange={(e) => setNeuBez(e.target.value)} placeholder="Ort Strasse Nr." className="field" />
          <button type="button" onClick={() => void anlegen()} disabled={legtAn} className="btn-ghost whitespace-nowrap disabled:opacity-50"><Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Anlegen</button>
        </div>
        {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
      </section>

      <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Strasse, Nummer oder PLZ …" className="field" />
      <div className="flex gap-1.5">
        {(['aktiv', 'fertig_gemeldet', 'abgeschlossen', 'alle'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={'chip px-3 py-1 text-xs ' + (filter === k ? 'chip-on' : '')}>{k === 'alle' ? 'alle' : STATUS[k][0]}</button>
        ))}
        {liste.some((b) => b.lat !== undefined) && (
          <button type="button" onClick={() => setOhneOrt(!ohneOrt)} aria-pressed={ohneOrt} className={'chip ml-auto px-3 py-1 text-xs ' + (ohneOrt ? 'chip-on' : '')}>
            ohne geprüften Ort · {liste.filter((b) => (filter === 'alle' || b.status === filter) && !hatKoordinaten(b)).length}
          </button>
        )}
      </div>

      <div className="card divide-y divide-line p-0">
        {sichtbar.map((b) => (
          <div key={b.id}>
            <button type="button" onClick={() => { setOffen(offen === b.id ? null : b.id); loeschFrage.abbrechen(); setHinweis(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ground">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{b.bezeichnung}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink3">
                  <span className="knr">{b.konto_nr}</span>
                  {hatKoordinaten(b) && <MapPin size={12} className="text-good" aria-label="Ort geprüft" />}
                  {b.plz && <span className="font-mono">{b.plz}</span>}
                  <span>{kunden.find((k) => k.id === b.kunde_id)?.name ?? 'kein Kunde'}</span>
                </span>
              </span>
              <span className={'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ' + STATUS[b.status][1]}>{STATUS[b.status][0]}</span>
            </button>
            {offen === b.id && (
              <div className="space-y-2 bg-surface-2 px-3 py-3">
                {b.lat !== undefined && <AdresseFeld key={b.id} b={b} naehe={naehe} speichern={(patch) => aendern(b.id, patch)} sofortSuchen={neuAngelegt === b.id} />}
                <PlzFeld wert={b.plz} speichern={(plz) => aendern(b.id, { plz })} />
                <div>
                  <span className="lbl">Kunde / Bauleitung</span>
                  <Auswahl label="Kunde / Bauleitung" wert={b.kunde_id ?? ''} aendern={(k) => void aendern(b.id, { kunde_id: k || null })} leer="Kein Kunde gefunden."
                    optionen={[{ wert: '', text: 'Kein Kunde', trenner: true }, ...kunden.map((k) => ({ wert: k.id, text: k.name }))]} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.status === 'aktiv' && (
                    <button type="button" onClick={() => void aendern(b.id, { status: 'fertig_gemeldet', fertigstellung_am: iso(new Date()) })} className="cta w-auto px-4 py-2.5 text-sm">Fertigstellung melden</button>
                  )}
                  {b.status === 'fertig_gemeldet' && (
                    <>
                      <span className="self-center text-xs text-ink3">fertig gemeldet am {b.fertigstellung_am ? lang(ausIso(b.fertigstellung_am)) : '—'} — ab jetzt ist jeder Eingriff zusätzlich (AGB 4.1)</span>
                      <button type="button" onClick={() => void aendern(b.id, { status: 'abgeschlossen' })} className="btn-ghost">abschliessen</button>
                    </>
                  )}
                  {b.status !== 'aktiv' && (
                    <button type="button" onClick={() => void aendern(b.id, { status: 'aktiv', fertigstellung_am: null })} className="btn-ghost">wieder aktiv</button>
                  )}
                  <button type="button" onClick={() => loeschFrage.fragen(b)} disabled={loeschFrage.frage?.ding.id === b.id}
                    className="ml-auto self-center text-xs font-semibold text-ink3 underline-offset-2 hover:text-accent-deep hover:underline disabled:opacity-50">
                    Baustelle löschen
                  </button>
                </div>
                {loeschFrage.frage?.ding.id === b.id && (
                  <LoeschLeiste frage={loeschFrage.frage} onAbbrechen={loeschFrage.abbrechen} onBestaetigen={loeschFrage.bestaetigen} art="fenster" />
                )}
              </div>
            )}
          </div>
        ))}
        {sichtbar.length === 0 && <p className="p-3 text-sm text-ink3">Nichts gefunden.</p>}
        {liste.length > 60 && sichtbar.length === 60 && <p className="p-3 text-[11px] text-ink3">Die ersten 60 — bitte Suche eingrenzen.</p>}
      </div>
    </div>
  );
}
