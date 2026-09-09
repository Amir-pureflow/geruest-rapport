import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ausIso, iso, lang } from '../../lib/datum';

interface Baustelle { id: string; konto_nr: string; bezeichnung: string | null; status: 'aktiv' | 'fertig_gemeldet' | 'abgeschlossen'; fertigstellung_am: string | null; kunde_id: string | null }
interface Kunde { id: string; name: string }

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
  const [fehler, setFehler] = useState('');

  const laden = useCallback(async () => {
    if (!supabase) return;
    const [b, k] = await Promise.all([
      supabase.from('baustelle').select('id,konto_nr,bezeichnung,status,fertigstellung_am,kunde_id').order('bezeichnung'),
      supabase.from('kunde').select('id,name').order('name'),
    ]);
    if (b.data) setListe(b.data as Baustelle[]);
    if (k.data) setKunden(k.data);
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return liste.filter((b) => (filter === 'alle' || b.status === filter) && (!q || (b.bezeichnung ?? '').toLowerCase().includes(q) || b.konto_nr.includes(q))).slice(0, 60);
  }, [liste, suche, filter]);

  async function aendern(id: string, patch: Partial<Baustelle>) {
    if (!supabase) return;
    const { error } = await supabase.from('baustelle').update(patch).eq('id', id);
    if (error) setFehler(error.message);
    void laden();
  }
  async function anlegen() {
    if (!supabase) return;
    if (!/^\d{6}$/.test(neuNr.trim())) { setFehler('Kontonummer: sechs Ziffern.'); return; }
    if (!neuBez.trim()) { setFehler('Bezeichnung fehlt.'); return; }
    const { error } = await supabase.from('baustelle').insert({ konto_nr: neuNr.trim(), bezeichnung: neuBez.trim() });
    if (error) { setFehler(error.message.includes('unique') ? 'Diese Kontonummer gibt es schon.' : error.message); return; }
    setFehler(''); setNeuNr(''); setNeuBez('');
    void laden();
  }

  const zaehl = (s: Baustelle['status']) => liste.filter((b) => b.status === s).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink2"><b className="text-ink">{liste.length}</b> Konten · {zaehl('aktiv')} aktiv · {zaehl('fertig_gemeldet')} fertig gemeldet · {zaehl('abgeschlossen')} abgeschlossen</p>

      <section className="card space-y-2 p-3">
        <p className="lbl mb-0">Neue Baustelle (bei Auftragsbestätigung)</p>
        <div className="flex gap-2">
          <input value={neuNr} onChange={(e) => setNeuNr(e.target.value)} placeholder="Konto-Nr." inputMode="numeric" className="field w-28 font-mono" />
          <input value={neuBez} onChange={(e) => setNeuBez(e.target.value)} placeholder="Ort Strasse Nr." className="field" />
          <button type="button" onClick={() => void anlegen()} className="btn-ghost whitespace-nowrap">+ Anlegen</button>
        </div>
        {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
      </section>

      <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Strasse oder Nummer …" className="field" />
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
                  <span>{kunden.find((k) => k.id === b.kunde_id)?.name ?? 'kein Kunde'}</span>
                </span>
              </span>
              <span className={'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ' + STATUS[b.status][1]}>{STATUS[b.status][0]}</span>
            </button>
            {offen === b.id && (
              <div className="space-y-2 bg-surface-2 px-3 py-3">
                <div>
                  <label className="lbl">Kunde / Bauleitung</label>
                  <select value={b.kunde_id ?? ''} onChange={(e) => void aendern(b.id, { kunde_id: e.target.value || null })} className="field">
                    <option value="">– kein Kunde –</option>
                    {kunden.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
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
