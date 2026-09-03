import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { iso } from '../../lib/datum';

interface Team { id: string; bezeichnung: string; fahrzeug: string | null; chefmonteur_id: string | null; aktiv: boolean }
interface Person { id: string; name: string; typ: string; funktion: string }
interface Mitglied { team_id: string; mitarbeiter_id: string; von: string; mitarbeiter: Person }

export function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [mitglieder, setMitglieder] = useState<Mitglied[]>([]);
  const [personen, setPersonen] = useState<Person[]>([]);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [neu, setNeu] = useState('');
  const [fehler, setFehler] = useState('');

  const laden = useCallback(async () => {
    if (!supabase) return;
    const [t, m, p] = await Promise.all([
      supabase.from('team').select('id,bezeichnung,fahrzeug,chefmonteur_id,aktiv').order('bezeichnung'),
      supabase.from('team_mitglied').select('team_id,mitarbeiter_id,von,mitarbeiter:mitarbeiter_id(id,name,typ,funktion)').is('bis', null),
      supabase.from('mitarbeiter').select('id,name,typ,funktion').eq('aktiv', true).order('name'),
    ]);
    if (t.error) { setFehler(t.error.message.includes('aktiv') ? 'Migration 0005 fehlt — bitte im SQL-Editor ausführen.' : t.error.message); return; }
    setTeams((t.data ?? []).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
    setMitglieder((m.data ?? []) as unknown as Mitglied[]);
    setPersonen(p.data ?? []);
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  const team = teams.find((t) => t.id === gewaehlt) ?? null;
  const teamLeute = mitglieder.filter((m) => m.team_id === gewaehlt);
  const inIrgendeinemTeam = new Set(mitglieder.map((m) => m.mitarbeiter_id));
  const frei = personen.filter((p) => !inIrgendeinemTeam.has(p.id) && p.funktion !== 'bauf');

  async function teamAnlegen() {
    if (!supabase || !neu.trim()) return;
    const { error } = await supabase.from('team').insert({ bezeichnung: neu.trim() });
    if (error) { setFehler(error.message); return; }
    setNeu('');
    void laden();
  }
  async function aendern(patch: Partial<Team>) {
    if (!supabase || !team) return;
    await supabase.from('team').update(patch).eq('id', team.id);
    void laden();
  }
  async function hinzufuegen(mitarbeiterId: string) {
    if (!supabase || !team) return;
    await supabase.from('team_mitglied').insert({ team_id: team.id, mitarbeiter_id: mitarbeiterId, von: iso(new Date()) });
    void laden();
  }
  async function entfernen(m: Mitglied) {
    if (!supabase || !team) return;
    await supabase.from('team_mitglied').update({ bis: iso(new Date()) }).eq('team_id', m.team_id).eq('mitarbeiter_id', m.mitarbeiter_id).eq('von', m.von);
    if (team.chefmonteur_id === m.mitarbeiter_id) await supabase.from('team').update({ chefmonteur_id: null }).eq('id', team.id);
    void laden();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Neues Team, z. B. Team 21" className="field" />
        <button type="button" onClick={() => void teamAnlegen()} className="btn-ghost whitespace-nowrap">+ Anlegen</button>
      </div>
      {fehler && <p className="card text-sm font-semibold text-accent-deep">{fehler}</p>}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {teams.map((t) => {
          const n = mitglieder.filter((m) => m.team_id === t.id).length;
          return (
            <button key={t.id} type="button" onClick={() => setGewaehlt(t.id === gewaehlt ? null : t.id)} className={'chip flex items-center justify-between px-3 py-2 text-left ' + (gewaehlt === t.id ? 'chip-on' : '') + (t.aktiv ? '' : ' opacity-50')}>
              <span className="text-sm">{t.bezeichnung}</span>
              <span className="font-mono text-[11px] text-ink3">{n}</span>
            </button>
          );
        })}
      </div>

      {team && (
        <section className="card space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-display text-lg font-bold">{team.bezeichnung}</p>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={team.aktiv} onChange={(e) => void aendern({ aktiv: e.target.checked })} /> aktiv</label>
          </div>
          <div>
            <label className="lbl">Fahrzeug</label>
            <input defaultValue={team.fahrzeug ?? ''} onBlur={(e) => e.target.value !== (team.fahrzeug ?? '') && void aendern({ fahrzeug: e.target.value || null })} placeholder="z. B. VW Crafter · BE 45 812" className="field" />
          </div>
          <div>
            <label className="lbl">Mitglieder · Chefmonteur antippen</label>
            <div className="divide-y divide-line rounded-[10px] border border-line">
              {teamLeute.map((m) => {
                const chef = team.chefmonteur_id === m.mitarbeiter_id;
                return (
                  <div key={m.mitarbeiter_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <button type="button" onClick={() => void aendern({ chefmonteur_id: m.mitarbeiter_id })} className="flex min-w-0 items-center gap-2 text-left">
                      <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold ' + (chef ? 'bg-accent text-white' : 'border border-line-strong text-ink3')}>{chef ? 'C' : ''}</span>
                      <span className="truncate">{m.mitarbeiter.name}{m.mitarbeiter.typ === 'temporaer' && <span className="ml-1 text-[10px] text-ink3">temp</span>}</span>
                    </button>
                    <button type="button" onClick={() => void entfernen(m)} className="btn-ghost px-2 text-xs">entfernen</button>
                  </div>
                );
              })}
              {teamLeute.length === 0 && <p className="px-3 py-2 text-sm text-ink3">Noch niemand im Team.</p>}
            </div>
          </div>
          <div>
            <label className="lbl">Hinzufügen</label>
            <select value="" onChange={(e) => e.target.value && void hinzufuegen(e.target.value)} className="field">
              <option value="">Person wählen …</option>
              {frei.map((p) => <option key={p.id} value={p.id}>{p.name}{p.typ === 'temporaer' ? ' (temp)' : ''}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-ink3">{frei.length} Personen ohne Team</p>
          </div>
        </section>
      )}
    </div>
  );
}
