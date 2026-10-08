import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { iso } from '../../lib/datum';
import { Plus, Star, Truck, Users } from 'lucide-react';
import { Avatar, Dialog } from '../../ui/Dialog';
import { teamEntfernen, teamPruefen } from '../../lib/entfernen';
import { LoeschLeiste, Papierkorb, useLoeschFrage } from '../../ui/LoeschFrage';

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
  /**
   * Löschen (09.10.2026, Amir): ohne Meldung wirklich weg, mit Meldungen nur aus allen Listen — die Stunden bleiben im
   * Lohn-Export, die Leute als Mitarbeitende. Was passiert, sagt die Rückfrage, bevor jemand bestätigt
   * (src/lib/entfernen.ts). Ersetzt das alte «Team löschen …», das bei jeder Meldung oder Planung nur abgelehnt hat.
   */
  const [hinweis, setHinweis] = useState('');
  const loeschFrage = useLoeschFrage<Team>(
    (t) => teamPruefen(t, mitglieder.filter((m) => m.team_id === t.id).length),
    (t, entscheid) => teamEntfernen(t.id, entscheid),
    (t, ergebnis) => {
      setGewaehlt(null);
      setHinweis(ergebnis === 'geloescht'
        ? `«${t.bezeichnung}» ist gelöscht.`
        : `«${t.bezeichnung}» ist aus allen Listen entfernt, die Stunden bleiben im Lohn-Export. Wieder aktivieren geht unter «Inaktive Teams».`);
      void laden();
    },
  );
  const { frage, abbrechen } = loeschFrage;
  function loeschenFragen(t: Team) {
    setHinweis('');
    loeschFrage.fragen(t);
  }

  const schliessen = useCallback(() => { setGewaehlt(null); setFehler(''); abbrechen(); }, [abbrechen]);

  /** Eine Karte im Raster — aktive oben, ruhende und entfernte darunter unter «Inaktive Teams». */
  function karte(t: Team) {
    const leute = mitglieder.filter((m) => m.team_id === t.id);
    const chef = leute.find((m) => m.mitarbeiter_id === t.chefmonteur_id)?.mitarbeiter ?? null;
    const andere = leute.filter((m) => m.mitarbeiter_id !== t.chefmonteur_id);
    return (
      <div key={t.id} className="relative rounded-[18px] border border-ink/[0.06] bg-white shadow-[0_1px_2px_rgb(17_17_19/0.04),0_10px_28px_-18px_rgb(17_17_19/0.28)] transition hover:-translate-y-px hover:shadow-[0_1px_2px_rgb(17_17_19/0.05),0_16px_32px_-16px_rgb(17_17_19/0.35)]">
        <button type="button" onClick={() => { setFehler(''); setHinweis(''); setGewaehlt(t.id); }} className="block w-full rounded-[18px] p-4 text-left">
          <span className="flex items-center justify-between gap-2 pr-8">
            <span className="font-display text-[16px] font-semibold text-ink">{t.bezeichnung}</span>
            <span className={'rounded-full px-2.5 py-0.5 text-[11px] font-semibold ' + (t.aktiv ? 'bg-surface-2 text-ink2' : 'bg-ink/10 text-ink3')}>{t.aktiv ? `${leute.length} Personen` : 'inaktiv'}</span>
          </span>
          <span className="mt-3 flex items-center gap-2.5">
            {chef ? <Avatar name={chef.name} gross /> : <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-line-strong text-ink3">?</span>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{chef?.name ?? 'kein Chefmonteur'}</span>
              <span className="block text-[11px] text-ink3">Chefmonteur</span>
            </span>
          </span>
          <span className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="flex -space-x-1">
              {andere.slice(0, 5).map((m) => <Avatar key={m.mitarbeiter_id} name={m.mitarbeiter.name} ring />)}
              {andere.length === 0 && <span className="text-[11px] text-ink3">noch niemand dazu</span>}
            </span>
            {t.fahrzeug && <span className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-ink3"><Truck size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{t.fahrzeug}</span></span>}
          </span>
        </button>
        {frage?.ding.id !== t.id && <span className="absolute right-2 top-3"><Papierkorb titel={`${t.bezeichnung} löschen`} onClick={() => loeschenFragen(t)} /></span>}
        {frage?.ding.id === t.id && gewaehlt !== t.id && <LoeschLeiste frage={frage} onAbbrechen={abbrechen} onBestaetigen={loeschFrage.bestaetigen} />}
      </div>
    );
  }

  const aktive = teams.filter((t) => t.aktiv);
  const inaktive = teams.filter((t) => !t.aktiv);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void teamAnlegen(); }} placeholder="Neues Team, z. B. Team 21" className="field max-w-sm flex-1" />
        <button type="button" onClick={() => void teamAnlegen()} disabled={!neu.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7)] transition hover:-translate-y-px disabled:opacity-50">
          <Plus size={15} strokeWidth={2.6} aria-hidden="true" />Team anlegen
        </button>
        <span className="text-sm text-ink3">{aktive.length} aktive Teams · {frei.length} Personen ohne Team</span>
      </div>
      {!team && fehler && <p className="card text-sm font-semibold text-accent-deep">{fehler}</p>}
      {hinweis && <p className="card text-sm text-ink2" role="status">{hinweis}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {aktive.map(karte)}
      </div>
      {/* Ruhende (Nebensaison) und entfernte Teams: zugeklappt, öffnen → Haken «aktiv» setzt sie zurück */}
      {inaktive.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-sm font-semibold text-ink3 hover:text-ink">Inaktive Teams <span className="opacity-60">{inaktive.length}</span></summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {inaktive.map(karte)}
          </div>
        </details>
      )}

      {team && (
        <Dialog
          titel={team.bezeichnung}
          untertitel="Name, Fahrzeug, Mitglieder und Chefmonteur"
          icon={Users}
          onSchliessen={schliessen}
          fuss={<>
            <button type="button" onClick={() => loeschenFragen(team)} className="text-xs font-semibold text-accent-deep hover:text-accent">Team löschen …</button>
            <button type="button" onClick={schliessen} className="btn-ghost">Fertig</button>
          </>}
        >
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="lbl">Name</span>
                {/* Umbenennen: tippen, Feld verlassen oder Enter */}
                <input
                  key={team.id}
                  defaultValue={team.bezeichnung}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== team.bezeichnung) void aendern({ bezeichnung: v }); else e.target.value = team.bezeichnung; }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="field"
                />
              </label>
              <label className="flex items-center gap-2 rounded-[12px] bg-surface-2/70 px-3.5 py-3 text-sm"><input type="checkbox" checked={team.aktiv} onChange={(e) => void aendern({ aktiv: e.target.checked })} /> aktiv</label>
            </div>
            <label className="block">
              <span className="lbl">Fahrzeug</span>
              <input key={team.id + '-f'} defaultValue={team.fahrzeug ?? ''} onBlur={(e) => e.target.value !== (team.fahrzeug ?? '') && void aendern({ fahrzeug: e.target.value || null })} placeholder="z. B. VW Crafter · BE 45 812" className="field" />
            </label>
            <div>
              <span className="lbl">Mitglieder · Stern = Chefmonteur</span>
              <div className="divide-y divide-line overflow-hidden rounded-[14px] border border-line">
                {teamLeute.map((m) => {
                  const chef = team.chefmonteur_id === m.mitarbeiter_id;
                  return (
                    <div key={m.mitarbeiter_id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={m.mitarbeiter.name} />
                        <span className="truncate">{m.mitarbeiter.name}{m.mitarbeiter.typ === 'temporaer' && <span className="ml-1.5 rounded-full bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-amber-deep">temp</span>}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => void aendern({ chefmonteur_id: m.mitarbeiter_id })} aria-pressed={chef} title={chef ? 'Chefmonteur' : 'Zum Chefmonteur machen'}
                          className={'grid h-8 w-8 place-items-center rounded-full transition ' + (chef ? 'bg-accent text-white' : 'text-ink3 hover:bg-surface-2 hover:text-ink')}>
                          <Star size={14} fill={chef ? 'currentColor' : 'none'} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => void entfernen(m)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink3 hover:bg-surface-2 hover:text-ink">entfernen</button>
                      </span>
                    </div>
                  );
                })}
                {teamLeute.length === 0 && <p className="px-3 py-2.5 text-sm text-ink3">Noch niemand im Team.</p>}
              </div>
            </div>
            <label className="block">
              <span className="lbl">Person hinzufügen</span>
              <select value="" onChange={(e) => e.target.value && void hinzufuegen(e.target.value)} className="field">
                <option value="">Person wählen …</option>
                {frei.map((p) => <option key={p.id} value={p.id}>{p.name}{p.typ === 'temporaer' ? ' (temp)' : ''}</option>)}
              </select>
              <span className="mt-1 block text-[11px] text-ink3">{frei.length} Personen ohne Team</span>
            </label>
            {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
            {frage && frage.ding.id === team.id && <LoeschLeiste frage={frage} onAbbrechen={abbrechen} onBestaetigen={loeschFrage.bestaetigen} art="fenster" />}
          </div>
        </Dialog>
      )}
    </div>
  );
}
