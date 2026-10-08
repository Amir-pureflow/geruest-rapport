import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Search, UserRound } from 'lucide-react';
import tarife from '../../../fixtures/tarife_sguv_2026.json';
import { Avatar, Dialog } from '../../ui/Dialog';
import { personEntfernen, personPruefen } from '../../lib/entfernen';
import { LoeschLeiste, Papierkorb, useLoeschFrage } from '../../ui/LoeschFrage';

interface Person {
  id?: string;
  name: string;
  typ: 'intern' | 'extern' | 'temporaer';
  funktion: string;
  sprache: 'de' | 'sq' | 'pt' | 'it' | 'fr' | 'ar' | 'pl' | 'en';
  temporaerbuero: string | null;
  aktiv: boolean;
  oev_standard: boolean;
  km_standard: number;
  /** Optional — die Spalte kommt mit Migration 0009; ohne sie bleibt das Feld unsichtbar. */
  telefon?: string | null;
}

const LEER: Person = { name: '', typ: 'intern', funktion: 'monteur', sprache: 'de', temporaerbuero: null, aktiv: true, oev_standard: false, km_standard: 0, telefon: null };
/**
 * Sprache für die Sprachnotiz: in ihr spricht der Chefmonteur, daraus entsteht der deutsche Text.
 * Reihenfolge nach Häufigkeit im Betrieb — Albanisch, Portugiesisch und Italienisch kamen am 04.10.2026 dazu.
 */
const SPRACHEN: [Person['sprache'], string][] = [
  ['de', 'Deutsch'],
  ['sq', 'Albanisch'],
  ['pt', 'Portugiesisch'],
  ['it', 'Italienisch'],
  ['fr', 'Französisch'],
  ['ar', 'Arabisch'],
  ['pl', 'Polnisch'],
  ['en', 'Englisch'],
];
const BASIS_SPALTEN = 'id,name,typ,funktion,sprache,temporaerbuero,aktiv,oev_standard,km_standard';

const spalteFehlt = (msg: string, spalte: string) => new RegExp(`column .*${spalte}.* does not exist`).test(msg) || (msg.includes(spalte) && /does not exist|schema cache/.test(msg));

export function Mitarbeiter() {
  const [liste, setListe] = useState<(Person & { id: string })[]>([]);
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<'alle' | 'intern' | 'temporaer' | 'inaktiv'>('alle');
  const [bearbeitet, setBearbeitet] = useState<Person | null>(null);
  const [fehler, setFehler] = useState('');
  /** null = noch nicht geprüft */
  const [hatTelefon, setHatTelefon] = useState<boolean | null>(null);

  const laden = useCallback(async () => {
    if (!supabase) return;
    // Erst mit Telefon versuchen; fehlt die Spalte (Migration 0009 nicht ausgeführt), ohne sie laden.
    const c = supabase;
    const abfrage = async (spalten: string): Promise<{ data: unknown; error: { message: string } | null }> => c.from('mitarbeiter').select(spalten).order('name');
    let mitTelefon = hatTelefon !== false;
    let r = await abfrage(mitTelefon ? BASIS_SPALTEN + ',telefon' : BASIS_SPALTEN);
    if (r.error && mitTelefon && spalteFehlt(r.error.message, 'telefon')) {
      mitTelefon = false;
      r = await abfrage(BASIS_SPALTEN);
    }
    setHatTelefon(mitTelefon);
    if (r.error) { setFehler(r.error.message.includes('oev_standard') ? 'Migration 0005 fehlt — bitte im SQL-Editor ausführen.' : r.error.message); return; }
    if (r.data) setListe(r.data as unknown as (Person & { id: string })[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return liste.filter((p) =>
      (filter === 'alle' ? p.aktiv : filter === 'inaktiv' ? !p.aktiv : p.aktiv && p.typ === filter) &&
      (!q || p.name.toLowerCase().includes(q) || (p.temporaerbuero ?? '').toLowerCase().includes(q) || (p.telefon ?? '').includes(q)),
    );
  }, [liste, suche, filter]);

  const fest = liste.filter((p) => p.aktiv && p.typ !== 'temporaer').length;
  const temp = liste.filter((p) => p.aktiv && p.typ === 'temporaer').length;

  async function speichern() {
    if (!supabase || !bearbeitet) return;
    if (!bearbeitet.name.trim()) { setFehler('Name fehlt.'); return; }
    setFehler('');
    const { telefon, ...rest } = bearbeitet;
    const row: Record<string, unknown> = { ...rest, name: bearbeitet.name.trim(), temporaerbuero: bearbeitet.typ === 'temporaer' ? bearbeitet.temporaerbuero : null };
    if (hatTelefon) row.telefon = telefon?.trim() || null;
    const { error } = row.id
      ? await supabase.from('mitarbeiter').update(row).eq('id', row.id as string)
      : await supabase.from('mitarbeiter').insert(row);
    if (error) {
      if (spalteFehlt(error.message, 'telefon')) { setHatTelefon(false); setFehler('Migration 0009 fehlt — die Spalte «telefon» gibt es noch nicht. Bitte supabase/migrations/0009 ausführen, dann nochmals speichern.'); return; }
      setFehler(error.message);
      return;
    }
    setBearbeitet(null);
    void laden();
  }

  /**
   * Löschen (09.10.2026, Amir): ohne Stunden wirklich weg, mit Stunden nur aus allen Listen — der Lohn-Export
   * behält sie. Was passiert, sagt die Rückfrage, bevor jemand bestätigt (src/lib/entfernen.ts).
   */
  const [hinweis, setHinweis] = useState('');
  const loeschFrage = useLoeschFrage<Person & { id: string }>(
    personPruefen,
    (p, entscheid) => personEntfernen(p.id, entscheid),
    (p, ergebnis, entscheid) => {
      setBearbeitet(null);
      setHinweis(ergebnis === 'geloescht'
        ? `«${p.name}» ist gelöscht.`
        : entscheid === 'loeschen'
          ? `«${p.name}» hat inzwischen Stunden — darum nur aus allen Listen entfernt, die Stunden bleiben im Lohn-Export.`
          : `«${p.name}» ist aus allen Listen entfernt, die Stunden bleiben im Lohn-Export. Wieder aktivieren geht unter «Inaktiv».`);
      void laden();
    },
  );
  const { frage, abbrechen } = loeschFrage;
  function loeschenFragen(p: Person & { id: string }) {
    setHinweis('');
    loeschFrage.fragen(p);
  }

  const f = (patch: Partial<Person>) => setBearbeitet((b) => (b ? { ...b, ...patch } : b));
  const schliessen = useCallback(() => { setBearbeitet(null); abbrechen(); }, [abbrechen]);

  const anzahl = { alle: fest + temp, intern: fest, temporaer: temp, inaktiv: liste.filter((p) => !p.aktiv).length };
  const funktionText = (code: string) => tarife.personal.find((t) => t.code === code)?.bezeichnung ?? code;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden="true" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Temporärbüro oder Telefon …" className="field pl-10" />
        </div>
        <div className="flex rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgb(17_17_19/0.06)]" role="group" aria-label="Filter">
          {(['alle', 'intern', 'temporaer', 'inaktiv'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={'rounded-full px-3 py-1.5 text-xs font-semibold transition ' + (filter === k ? 'bg-ink text-white shadow-sm' : 'text-ink2 hover:text-ink')}>
              {k === 'alle' ? 'Alle' : k === 'intern' ? 'Fest' : k === 'temporaer' ? 'Temporär' : 'Inaktiv'} <span className="opacity-60">{anzahl[k]}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { setFehler(''); setHinweis(''); setBearbeitet({ ...LEER }); }} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7)] transition hover:-translate-y-px">
          <Plus size={15} strokeWidth={2.6} aria-hidden="true" />Person
        </button>
      </div>
      {!bearbeitet && fehler && <p className="card text-sm font-semibold text-accent-deep">{fehler}</p>}
      {hinweis && <p className="card text-sm text-ink2" role="status">{hinweis}</p>}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2/60 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Funktion</th>
              <th className="hidden px-4 py-2.5 sm:table-cell">Anstellung</th>
              <th className="hidden px-4 py-2.5 lg:table-cell">Sprache</th>
              <th className="px-4 py-2.5 text-right">Weg</th>
              <th className="w-12 py-2.5 pl-0 pr-3"><span className="sr-only">Löschen</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sichtbar.map((p) => (
              <Fragment key={p.id}>
              <tr onClick={() => { setFehler(''); setHinweis(''); setBearbeitet({ ...p }); }} className="cursor-pointer transition hover:bg-ground/70">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-3">
                    <Avatar name={p.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-[11px] text-ink3 md:hidden">{funktionText(p.funktion)}</span>
                    </span>
                  </span>
                </td>
                <td className="hidden px-4 py-2.5 text-ink2 md:table-cell">{funktionText(p.funktion)}</td>
                <td className="hidden px-4 py-2.5 sm:table-cell">
                  {p.typ === 'temporaer'
                    ? <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-[11px] font-semibold text-amber-deep">temporär{p.temporaerbuero ? ` · ${p.temporaerbuero}` : ''}</span>
                    : <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-ink2">{p.typ === 'extern' ? 'extern' : 'fest'}</span>}
                </td>
                <td className="hidden px-4 py-2.5 text-ink2 lg:table-cell">{SPRACHEN.find(([k]) => k === p.sprache)?.[1]}</td>
                <td className="px-4 py-2.5 text-right text-xs text-ink3">{p.oev_standard ? <span className="rounded-full bg-steel-soft px-2 py-0.5 font-semibold text-steel">öV</span> : p.km_standard > 0 ? <span className="font-mono tabular-nums">{p.km_standard} km</span> : '—'}</td>
                <td className="py-1 pl-0 pr-3 text-right">
                  {frage?.ding.id !== p.id && <Papierkorb titel={`${p.name} löschen`} onClick={() => loeschenFragen(p)} />}
                </td>
              </tr>
              {frage?.ding.id === p.id && !bearbeitet && (
                <tr>
                  <td colSpan={6} className="p-0"><LoeschLeiste frage={frage} onAbbrechen={abbrechen} onBestaetigen={loeschFrage.bestaetigen} art="tabelle" /></td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {sichtbar.length === 0 && <p className="p-4 text-sm text-ink3">Niemand gefunden.</p>}
      </div>

      {bearbeitet && (
        <Dialog
          titel={bearbeitet.id ? bearbeitet.name || 'Person bearbeiten' : 'Neue Person'}
          untertitel="Anstellung, Funktion, Sprache der Sprachnotiz"
          icon={UserRound}
          onSchliessen={schliessen}
          fuss={<>
            {bearbeitet.id
              ? <button type="button" onClick={() => { const p = liste.find((x) => x.id === bearbeitet.id); if (p) loeschenFragen(p); }} className="text-xs font-semibold text-accent-deep hover:text-accent">Person löschen …</button>
              : <span />}
            <span className="flex items-center gap-2">
              <button type="button" onClick={schliessen} className="btn-ghost">Abbrechen</button>
              <button type="button" onClick={() => void speichern()} className="inline-flex items-center rounded-full bg-gradient-to-br from-[#ff6d4c] via-accent to-[#9c1409] px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgb(224_48_30/0.7)]">Speichern</button>
            </span>
          </>}
        >
          <div className="space-y-4">
            <label className="block">
              <span className="lbl">Name</span>
              <input value={bearbeitet.name} onChange={(e) => f({ name: e.target.value })} placeholder="Vorname Name" className="field" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="lbl">Anstellung</span>
                <select value={bearbeitet.typ} onChange={(e) => f({ typ: e.target.value as Person['typ'] })} className="field">
                  <option value="intern">fest (intern)</option>
                  <option value="temporaer">temporär</option>
                  <option value="extern">extern</option>
                </select>
              </label>
              <label className="block">
                <span className="lbl">Funktion (Tarif)</span>
                <select value={bearbeitet.funktion} onChange={(e) => f({ funktion: e.target.value })} className="field">
                  {tarife.personal.map((t) => <option key={t.code} value={t.code}>{t.bezeichnung}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="lbl">Sprache der Sprachnotiz</span>
                <select value={bearbeitet.sprache} onChange={(e) => f({ sprache: e.target.value as Person['sprache'] })} className="field">
                  {SPRACHEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              {hatTelefon && (
                <label className="block">
                  <span className="lbl">Telefon <span className="font-normal text-ink3">(freiwillig)</span></span>
                  <input type="tel" value={bearbeitet.telefon ?? ''} onChange={(e) => f({ telefon: e.target.value || null })} placeholder="079 …" className="field" />
                </label>
              )}
              {bearbeitet.typ === 'temporaer' && (
                <label className="block">
                  <span className="lbl">Temporärbüro</span>
                  <input value={bearbeitet.temporaerbuero ?? ''} onChange={(e) => f({ temporaerbuero: e.target.value || null })} placeholder="z. B. Adecco" className="field" />
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] bg-surface-2/70 px-4 py-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={bearbeitet.oev_standard} onChange={(e) => f({ oev_standard: e.target.checked, km_standard: e.target.checked ? 0 : bearbeitet.km_standard })} /> reist mit öV</label>
              {!bearbeitet.oev_standard && (
                <label className="flex items-center gap-2">km pro Tag <input type="number" min={0} value={bearbeitet.km_standard} onChange={(e) => f({ km_standard: Math.max(0, Number(e.target.value) || 0) })} className="field w-20 py-1" /></label>
              )}
              <label className="flex items-center gap-2"><input type="checkbox" checked={bearbeitet.aktiv} onChange={(e) => f({ aktiv: e.target.checked })} /> aktiv</label>
            </div>
            {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
            {frage && frage.ding.id === bearbeitet.id && <LoeschLeiste frage={frage} onAbbrechen={abbrechen} onBestaetigen={loeschFrage.bestaetigen} art="fenster" />}
          </div>
        </Dialog>
      )}
    </div>
  );
}
