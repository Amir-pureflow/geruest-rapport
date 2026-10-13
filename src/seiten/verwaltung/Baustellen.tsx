import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { alle } from '../../lib/abfrage';
import { ausIso, iso, lang } from '../../lib/datum';
import { baustellenSuchen } from '../../lib/suche';
import { Auswahl } from '../../ui/Auswahl';

interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null; plz: string | null; status: 'aktiv' | 'fertig_gemeldet' | 'abgeschlossen'; fertigstellung_am: string | null; kunde_id: string | null }
interface Kunde { id: string; name: string }

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

  // Seitenweise (13.10.2026): heute 217 aktive, über die Jahre mehr als 1000 Konten — sonst fehlten die neuesten still
  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    try {
      const [b, k] = await Promise.all([
        alle<Baustelle>((von, bis) => c.from('baustelle').select('id,konto_nr,bezeichnung,plz,status,fertigstellung_am,kunde_id').order('bezeichnung').order('id').range(von, bis)),
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

  const sichtbar = useMemo(() => {
    const q = suche.trim();
    const imFilter = liste.filter((b) => filter === 'alle' || b.status === filter);
    return q ? baustellenSuchen(imFilter, q, 60) : imFilter.slice(0, 60);
  }, [liste, suche, filter]);

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
    const { error } = await supabase.from('baustelle').insert({ konto_nr: neuNr.trim(), bezeichnung: neuBez.trim(), plz: p.plz });
    setLegtAn(false);
    if (error) { setFehler(error.message.includes('unique') ? 'Diese Kontonummer gibt es schon.' : error.message); return; }
    setFehler(''); setNeuNr(''); setNeuBez(''); setNeuPlz('');
    void laden();
  }

  const zaehl = (s: Baustelle['status']) => liste.filter((b) => b.status === s).length;

  return (
    <div className="space-y-3">
      {ladeFehler && <p className="card text-sm font-semibold text-accent-deep">{ladeFehler}</p>}
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
      </div>

      <div className="card divide-y divide-line p-0">
        {sichtbar.map((b) => (
          <div key={b.id}>
            <button type="button" onClick={() => setOffen(offen === b.id ? null : b.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ground">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{b.bezeichnung}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink3">
                  <span className="knr">{b.konto_nr}</span>
                  {b.plz && <span className="font-mono">{b.plz}</span>}
                  <span>{kunden.find((k) => k.id === b.kunde_id)?.name ?? 'kein Kunde'}</span>
                </span>
              </span>
              <span className={'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ' + STATUS[b.status][1]}>{STATUS[b.status][0]}</span>
            </button>
            {offen === b.id && (
              <div className="space-y-2 bg-surface-2 px-3 py-3">
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
                </div>
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
