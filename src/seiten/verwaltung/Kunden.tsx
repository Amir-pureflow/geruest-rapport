import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Kunde { id?: string; name: string; ansprechperson: string | null; email: string | null; telefon: string | null; praeferenz: 'einzel' | 'sammel'; anzeige_noetig: boolean; frist_tage: number; adresse: string | null }

const LEER: Kunde = { name: '', ansprechperson: '', email: '', telefon: '', praeferenz: 'einzel', anzeige_noetig: true, frist_tage: 3, adresse: '' };

export function Kunden() {
  const [liste, setListe] = useState<(Kunde & { id: string; baustellen: number })[]>([]);
  const [bearbeitet, setBearbeitet] = useState<Kunde | null>(null);
  const [suche, setSuche] = useState('');
  const [fehler, setFehler] = useState('');

  const laden = useCallback(async () => {
    if (!supabase) return;
    const [k, b] = await Promise.all([
      supabase.from('kunde').select('id,name,ansprechperson,email,telefon,praeferenz,anzeige_noetig,frist_tage,adresse').order('name'),
      supabase.from('baustelle').select('kunde_id').not('kunde_id', 'is', null),
    ]);
    if (k.error) { setFehler(/anzeige_noetig|frist_tage/.test(k.error.message) ? 'Migration 0011 fehlt — bitte einspielen.' : k.error.message.includes('ansprechperson') ? 'Migration 0005 fehlt — bitte im SQL-Editor ausführen.' : k.error.message); return; }
    const zaehler = new Map<string, number>();
    for (const r of b.data ?? []) zaehler.set(r.kunde_id, (zaehler.get(r.kunde_id) ?? 0) + 1);
    setListe((k.data ?? []).map((x) => ({ ...(x as Kunde & { id: string }), baustellen: zaehler.get(x.id) ?? 0 })));
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  async function speichern() {
    if (!supabase || !bearbeitet) return;
    if (!bearbeitet.name.trim()) { setFehler('Name fehlt.'); return; }
    setFehler('');
    const row = { ...bearbeitet, name: bearbeitet.name.trim(), email: bearbeitet.email?.trim() || null, ansprechperson: bearbeitet.ansprechperson?.trim() || null, telefon: bearbeitet.telefon?.trim() || null, adresse: bearbeitet.adresse?.trim() || null, frist_tage: Math.min(60, Math.max(1, Math.round(Number(bearbeitet.frist_tage) || 3))) };
    const { error } = row.id ? await supabase.from('kunde').update(row).eq('id', row.id) : await supabase.from('kunde').insert(row);
    if (error) { setFehler(error.message); return; }
    setBearbeitet(null);
    void laden();
  }
  const f = (patch: Partial<Kunde>) => setBearbeitet((b) => (b ? { ...b, ...patch } : b));
  const q = suche.trim().toLowerCase();
  const sichtbar = liste.filter((k) => !q || k.name.toLowerCase().includes(q) || (k.ansprechperson ?? '').toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink2"><b className="text-ink">{liste.length}</b> Kunden · {liste.filter((k) => k.praeferenz === 'sammel').length} mit Sammelabrechnung</p>
        <button type="button" onClick={() => setBearbeitet({ ...LEER })} className="btn-ghost">+ Neu</button>
      </div>

      {bearbeitet && (
        <section className="card space-y-3 p-4">
          <p className="lbl mb-0">{bearbeitet.id ? 'Bearbeiten' : 'Neuer Kunde'}</p>
          <input value={bearbeitet.name} onChange={(e) => f({ name: e.target.value })} placeholder="Firma" className="field" />
          <div className="grid grid-cols-2 gap-2">
            <input value={bearbeitet.ansprechperson ?? ''} onChange={(e) => f({ ansprechperson: e.target.value })} placeholder="Bauleitung (Name)" className="field" />
            <input value={bearbeitet.telefon ?? ''} onChange={(e) => f({ telefon: e.target.value })} placeholder="Telefon" className="field" />
          </div>
          <input type="email" value={bearbeitet.email ?? ''} onChange={(e) => f({ email: e.target.value })} placeholder="E-Mail der Bauleitung — dorthin gehen die Regierapporte" className="field" />
          <div>
            <label className="lbl">Rechnungsadresse (steht auf dem Regierapport-PDF)</label>
            <textarea value={bearbeitet.adresse ?? ''} onChange={(e) => f({ adresse: e.target.value })} rows={2} placeholder={'Weltpoststrasse 19/21\n3015 Bern'} className="field" />
          </div>
          <div>
            <label className="lbl">Regierapporte</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => f({ praeferenz: 'einzel' })} className={'chip px-3 ' + (bearbeitet.praeferenz === 'einzel' ? 'chip-on' : '')}>einzeln, sofort</button>
              <button type="button" onClick={() => f({ praeferenz: 'sammel' })} className={'chip px-3 ' + (bearbeitet.praeferenz === 'sammel' ? 'chip-on' : '')}>gesammelt, Monatsende</button>
            </div>
          </div>
          {/* Regeln aus dem Werkvertrag — pro Kunde anders, darum hier und nicht im Code */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div hidden>
              <label className="lbl">Zusatzarbeit vorher anzeigen</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => f({ anzeige_noetig: true })} className={'chip px-3 ' + (bearbeitet.anzeige_noetig ? 'chip-on' : '')}>ja, schriftlich</button>
                <button type="button" onClick={() => f({ anzeige_noetig: false })} className={'chip px-3 ' + (!bearbeitet.anzeige_noetig ? 'chip-on' : '')}>nicht nötig</button>
              </div>
              <p className="mt-1 text-[11px] text-ink3">Viele Bauleitungen zahlen Mehrkosten nur, wenn sie vor der Arbeit schriftlich angezeigt wurden.</p>
            </div>
            <div>
              <label className="lbl">Frist für die Gegenzeichnung</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={60} value={bearbeitet.frist_tage} onChange={(e) => f({ frist_tage: Number(e.target.value) })} className="field w-24" />
                <span className="text-sm text-ink2">Tage</span>
              </div>
              <p className="mt-1 text-[11px] text-ink3">Steht im Werkvertrag. Üblich sind 3 Tage.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void speichern()} className="cta py-3 text-base">Speichern</button>
            <button type="button" onClick={() => setBearbeitet(null)} className="btn-ghost">Abbrechen</button>
          </div>
          {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
        </section>
      )}
      {!bearbeitet && fehler && <p className="card text-sm font-semibold text-accent-deep">{fehler}</p>}

      <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen …" className="field" />
      <div className="card divide-y divide-line p-0">
        {sichtbar.map((k) => (
          <button key={k.id} type="button" onClick={() => setBearbeitet({ ...k })} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ground">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{k.name}</span>
              <span className="block truncate text-[11px] text-ink3">{k.ansprechperson ?? '–'} · {k.email ?? 'keine Mail'}</span>
            </span>
            <span className="flex flex-none items-center gap-2 font-mono text-[11px] text-ink3">
              {k.praeferenz === 'sammel' && <span className="rounded bg-steel-soft px-1 text-steel">Sammel</span>}
              {k.frist_tage !== 3 && <span className="rounded bg-surface-2 px-1 text-ink3">{k.frist_tage} Tage</span>}
              {k.baustellen} BS
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
