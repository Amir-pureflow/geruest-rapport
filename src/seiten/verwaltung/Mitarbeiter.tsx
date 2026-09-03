import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import tarife from '../../../fixtures/tarife_sguv_2026.json';

interface Person {
  id?: string;
  name: string;
  typ: 'intern' | 'extern' | 'temporaer';
  funktion: string;
  sprache: 'de' | 'ar' | 'pl' | 'en';
  temporaerbuero: string | null;
  aktiv: boolean;
  oev_standard: boolean;
  km_standard: number;
}

const LEER: Person = { name: '', typ: 'intern', funktion: 'monteur', sprache: 'de', temporaerbuero: null, aktiv: true, oev_standard: false, km_standard: 0 };
const SPRACHEN: [Person['sprache'], string][] = [['de', 'Deutsch'], ['ar', 'Arabisch'], ['pl', 'Polnisch'], ['en', 'Englisch']];

export function Mitarbeiter() {
  const [liste, setListe] = useState<(Person & { id: string })[]>([]);
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<'alle' | 'intern' | 'temporaer' | 'inaktiv'>('alle');
  const [bearbeitet, setBearbeitet] = useState<Person | null>(null);
  const [fehler, setFehler] = useState('');

  const laden = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('mitarbeiter').select('id,name,typ,funktion,sprache,temporaerbuero,aktiv,oev_standard,km_standard').order('name');
    if (error) { setFehler(error.message.includes('oev_standard') ? 'Migration 0005 fehlt — bitte im SQL-Editor ausführen.' : error.message); return; }
    if (data) setListe(data as (Person & { id: string })[]);
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return liste.filter((p) =>
      (filter === 'alle' ? p.aktiv : filter === 'inaktiv' ? !p.aktiv : p.aktiv && p.typ === filter) &&
      (!q || p.name.toLowerCase().includes(q) || (p.temporaerbuero ?? '').toLowerCase().includes(q)),
    );
  }, [liste, suche, filter]);

  const fest = liste.filter((p) => p.aktiv && p.typ !== 'temporaer').length;
  const temp = liste.filter((p) => p.aktiv && p.typ === 'temporaer').length;

  async function speichern() {
    if (!supabase || !bearbeitet) return;
    if (!bearbeitet.name.trim()) { setFehler('Name fehlt.'); return; }
    setFehler('');
    const row = { ...bearbeitet, name: bearbeitet.name.trim(), temporaerbuero: bearbeitet.typ === 'temporaer' ? bearbeitet.temporaerbuero : null };
    const { error } = row.id
      ? await supabase.from('mitarbeiter').update(row).eq('id', row.id)
      : await supabase.from('mitarbeiter').insert(row);
    if (error) { setFehler(error.message); return; }
    setBearbeitet(null);
    void laden();
  }

  const f = (patch: Partial<Person>) => setBearbeitet((b) => (b ? { ...b, ...patch } : b));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink2"><b className="text-ink">{fest}</b> fest · <b className="text-ink">{temp}</b> temporär · {liste.filter((p) => !p.aktiv).length} inaktiv</p>
        <button type="button" onClick={() => setBearbeitet({ ...LEER })} className="btn-ghost">+ Neu</button>
      </div>

      {bearbeitet && (
        <section className="card space-y-3 p-4">
          <p className="lbl mb-0">{bearbeitet.id ? 'Bearbeiten' : 'Neue Person'}</p>
          <input value={bearbeitet.name} onChange={(e) => f({ name: e.target.value })} placeholder="Vorname Name" className="field" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="lbl">Anstellung</label>
              <select value={bearbeitet.typ} onChange={(e) => f({ typ: e.target.value as Person['typ'] })} className="field">
                <option value="intern">fest (intern)</option>
                <option value="temporaer">temporär</option>
                <option value="extern">extern</option>
              </select>
            </div>
            <div>
              <label className="lbl">Funktion (Tarif)</label>
              <select value={bearbeitet.funktion} onChange={(e) => f({ funktion: e.target.value })} className="field">
                {tarife.personal.map((t) => <option key={t.code} value={t.code}>{t.bezeichnung}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl">Sprache</label>
              <select value={bearbeitet.sprache} onChange={(e) => f({ sprache: e.target.value as Person['sprache'] })} className="field">
                {SPRACHEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {bearbeitet.typ === 'temporaer' && (
              <div>
                <label className="lbl">Temporärbüro</label>
                <input value={bearbeitet.temporaerbuero ?? ''} onChange={(e) => f({ temporaerbuero: e.target.value || null })} placeholder="z. B. Adecco" className="field" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={bearbeitet.oev_standard} onChange={(e) => f({ oev_standard: e.target.checked, km_standard: e.target.checked ? 0 : bearbeitet.km_standard })} /> reist mit öV</label>
            {!bearbeitet.oev_standard && (
              <label className="flex items-center gap-1.5">km/Tag <input type="number" min={0} value={bearbeitet.km_standard} onChange={(e) => f({ km_standard: Math.max(0, Number(e.target.value) || 0) })} className="field w-20 py-1" /></label>
            )}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={bearbeitet.aktiv} onChange={(e) => f({ aktiv: e.target.checked })} /> aktiv</label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void speichern()} className="cta py-3 text-base">Speichern</button>
            <button type="button" onClick={() => setBearbeitet(null)} className="btn-ghost">Abbrechen</button>
          </div>
          {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
        </section>
      )}
      {!bearbeitet && fehler && <p className="card text-sm font-semibold text-accent-deep">{fehler}</p>}

      <div className="flex gap-2">
        <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen …" className="field" />
      </div>
      <div className="flex gap-1.5">
        {(['alle', 'intern', 'temporaer', 'inaktiv'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={'chip px-3 py-1 text-xs ' + (filter === k ? 'chip-on' : '')}>
            {k === 'alle' ? 'alle' : k === 'intern' ? 'fest' : k === 'temporaer' ? 'temporär' : 'inaktiv'}
          </button>
        ))}
      </div>

      <div className="card divide-y divide-line p-0">
        {sichtbar.map((p) => (
          <button key={p.id} type="button" onClick={() => setBearbeitet({ ...p })} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ground">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-[11px] text-ink3">
                {tarife.personal.find((t) => t.code === p.funktion)?.bezeichnung ?? p.funktion}
                {p.typ === 'temporaer' && ` · temporär (${p.temporaerbuero ?? '–'})`}
                {p.sprache !== 'de' && ` · ${SPRACHEN.find(([k]) => k === p.sprache)?.[1]}`}
              </span>
            </span>
            <span className="font-mono text-[11px] text-ink3">{p.oev_standard ? 'öV' : p.km_standard > 0 ? `${p.km_standard} km` : ''}</span>
          </button>
        ))}
        {sichtbar.length === 0 && <p className="p-3 text-sm text-ink3">Niemand gefunden.</p>}
      </div>
    </div>
  );
}
