import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '../ui/Shell';
import { supabase } from '../lib/supabase';
import { addTage, ausIso, iso, kurz, kw, montag } from '../lib/datum';

/**
 * Das digitale Board — Ebene 1: Jahresplan (welches Team wann auf welcher Baustelle).
 * Spiegelt das Whiteboard. Änderungen werden fortgeschrieben, nie überschrieben:
 * jede Verschiebung landet als Zeile in planaenderung (Terminhistorie, Signal R4b).
 */

interface Team { id: string; bezeichnung: string }
interface Plan { id: string; team_id: string | null; von: string; bis: string; baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null }

const WOCHEN_VOR = 6;
const WOCHEN_NACH = 12;
const FARBEN = ['bg-steel-soft text-steel', 'bg-good-soft text-good-deep', 'bg-accent-soft text-accent-deep', 'bg-amber-soft text-amber-deep', 'bg-purple-100 text-purple-900', 'bg-sky-100 text-sky-900'];

export function Board() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [plaene, setPlaene] = useState<Plan[]>([]);
  const [gewaehlt, setGewaehlt] = useState<Plan | null>(null);
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [grund, setGrund] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  /** Rückmeldung nach dem Verschieben — eine Zeile über dem Board, verschwindet nach 3 s */
  const [rueckmeldung, setRueckmeldung] = useState<{ art: 'gut' | 'fehler'; text: string } | null>(null);
  const heute = new Date();
  const start = addTage(montag(heute), -7 * WOCHEN_VOR);
  const wochen = Array.from({ length: WOCHEN_VOR + WOCHEN_NACH + 1 }, (_, i) => addTage(start, i * 7));

  const laden = useCallback(async () => {
    if (!supabase) return;
    const [t, p] = await Promise.all([
      supabase.from('team').select('id,bezeichnung').eq('aktiv', true),
      supabase.from('jahresplan').select('id,team_id,von,bis,baustelle:baustelle_id(id,konto_nr,bezeichnung)').gte('bis', iso(start)).lte('von', iso(addTage(start, 7 * (WOCHEN_VOR + WOCHEN_NACH + 1)))),
    ]);
    setTeams((t.data ?? []).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })));
    setPlaene((p.data ?? []) as unknown as Plan[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void laden(); }, [laden]);
  useEffect(() => { if (supabase) void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const farbeVon = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const p of plaene) if (p.baustelle && !m.has(p.baustelle.id)) m.set(p.baustelle.id, FARBEN[i++ % FARBEN.length]);
    return m;
  }, [plaene]);

  function planIn(teamId: string, wochenStart: Date): Plan | undefined {
    const a = iso(wochenStart), b = iso(addTage(wochenStart, 6));
    return plaene.find((p) => p.team_id === teamId && p.von <= b && p.bis >= a);
  }

  function waehlen(p: Plan) {
    setGewaehlt(p); setVon(p.von); setBis(p.bis); setGrund('');
  }

  function melden(art: 'gut' | 'fehler', text: string) {
    setRueckmeldung({ art, text });
    setTimeout(() => setRueckmeldung((r) => (r?.text === text ? null : r)), 3000);
  }

  async function speichern() {
    if (!supabase || !gewaehlt) return;
    if (!userId) { melden('fehler', 'Keine Sitzung — Seite neu laden.'); return; }
    const aenderungen: { feld: string; alt: string; neu: string }[] = [];
    if (von !== gewaehlt.von) aenderungen.push({ feld: 'von', alt: gewaehlt.von, neu: von });
    if (bis !== gewaehlt.bis) aenderungen.push({ feld: 'bis', alt: gewaehlt.bis, neu: bis });
    if (aenderungen.length === 0) { setGewaehlt(null); return; }
    if (!von || !bis || bis < von) { melden('fehler', '«Bis» liegt vor «Von».'); return; }
    const { error: e1 } = await supabase.from('jahresplan').update({ von, bis }).eq('id', gewaehlt.id);
    if (e1) { melden('fehler', 'Verschieben: ' + e1.message); return; }
    const { error: e2 } = await supabase.from('planaenderung').insert(aenderungen.map((a) => ({ jahresplan_id: gewaehlt.id, ...a, geaendert_von: userId, grund: grund.trim() || null })));
    if (e2) melden('fehler', 'Verschoben, aber nicht protokolliert: ' + e2.message);
    else melden('gut', 'Verschoben ✓');
    setGewaehlt(null);
    void laden();
  }

  const heuteKw = kw(heute);

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <header>
          <h1 className="font-display text-2xl font-bold">Board</h1>
          <p className="text-sm text-ink3">Jahresplan — Block antippen, um Termine zu verschieben. Jede Verschiebung wird festgehalten.</p>
        </header>

        {rueckmeldung && (
          <p role="status" className={'text-sm font-semibold ' + (rueckmeldung.art === 'gut' ? 'text-good-deep' : 'text-accent-deep')}>{rueckmeldung.text}</p>
        )}

        <section className="card overflow-x-auto p-0">
          <table className="text-[11px]" style={{ minWidth: `${140 + wochen.length * 44}px` }}>
            <thead>
              <tr className="border-b border-line-strong">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink3">Team</th>
                {wochen.map((w) => (
                  <th key={iso(w)} className={'px-1 py-2 text-center font-mono text-[10px] font-semibold ' + (kw(w) === heuteKw ? 'bg-accent-soft text-accent-deep' : 'text-ink3')}>
                    KW {kw(w)}<span className="block text-[9px] font-normal">{kurz(w)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-b-0">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 font-medium">{t.bezeichnung}</td>
                  {wochen.map((w, i) => {
                    const p = planIn(t.id, w);
                    const vorher = i > 0 ? planIn(t.id, wochen[i - 1]) : undefined;
                    const neu = p && p.id !== vorher?.id;
                    return (
                      <td key={iso(w)} className="p-0.5">
                        {p ? (
                          <button type="button" onClick={() => waehlen(p)} title={`${p.baustelle?.bezeichnung ?? ''} · ${kurz(ausIso(p.von))} – ${kurz(ausIso(p.bis))}${p.bis.slice(0, 4)}`} className={'block h-7 w-full overflow-hidden whitespace-nowrap px-1 text-left leading-7 ' + (farbeVon.get(p.baustelle?.id ?? '') ?? 'bg-ground') + (neu ? ' rounded-l-md' : '') + (gewaehlt?.id === p.id ? ' ring-2 ring-accent' : '')}>
                            {neu ? p.baustelle?.bezeichnung : ''}
                          </button>
                        ) : <span className="block h-7" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {teams.length === 0 && <tr><td className="p-3 text-sm text-ink3">Keine Teams — Verwaltung oder Demo-Betrieb.</td></tr>}
            </tbody>
          </table>
        </section>

        {gewaehlt && (
          <section className="card space-y-3 p-4">
            <p className="font-display font-bold">{gewaehlt.baustelle?.bezeichnung} <span className="knr ml-1">{gewaehlt.baustelle?.konto_nr}</span></p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="lbl">Von</label><input type="date" value={von} onChange={(e) => setVon(e.target.value)} className="field" /></div>
              <div><label className="lbl">Bis</label><input type="date" value={bis} onChange={(e) => setBis(e.target.value)} className="field" /></div>
            </div>
            <input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Grund (z. B. Baumeister verzögert)" className="field" />
            <div className="flex gap-2">
              <button type="button" onClick={() => void speichern()} className="cta w-auto px-5 py-2.5 text-sm">Verschieben</button>
              <button type="button" onClick={() => setGewaehlt(null)} className="btn-ghost">Abbrechen</button>
            </div>
            <p className="text-[11px] text-ink3">Wird als Terminänderung protokolliert — Grundlage für Standzeit-Nachweise und das Regiesignal «ausserhalb des Zeitfensters».</p>
          </section>
        )}
      </div>
    </Shell>
  );
}
