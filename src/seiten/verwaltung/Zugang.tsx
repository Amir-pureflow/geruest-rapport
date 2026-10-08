/**
 * «Zugang» im Mitarbeiter-Dialog (Erin, 09.10.2026).
 *
 * Der Bauführer schickt dem Monteur einen Link per WhatsApp, der Monteur tippt ihn einmal an —
 * fertig. Kein Büro, kein QR-Code am Empfang, kein Passwort. Die meisten Monteure sind nie im
 * Büro, und die ~30 Temporären erst recht nicht.
 *
 * Hier drin: Link erzeugen, verschicken, und sehen, welche Geräte gekoppelt sind. Sperren
 * geht über die Datenbankfunktion `geraet_sperren` (0028) — die App darf `benutzer` nicht
 * selbst anfassen.
 *
 * Fehlt die Migration, bleibt der ganze Abschnitt unsichtbar statt rot. Dasselbe Muster wie
 * bei der Telefonspalte eine Ebene höher.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Smartphone, Link2, Check } from 'lucide-react';
import {
  einladungsLink, einladungsText, waLink, restText, stand, GUELTIG_STUNDEN,
  type Koppelansicht,
} from '../../lib/einladung';

interface Einladung { id: string; token: string; ansicht: Koppelansicht; gueltig_bis: string; eingeloest_am: string | null }
interface Geraet { id: string; ansicht: Koppelansicht; bezeichnung: string | null; gekoppelt_am: string; gesperrt: boolean }

const fehltTabelle = (m: string) => /does not exist|schema cache|relation .* does not exist/i.test(m);
const datum = (s: string) => new Date(s).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });

export function Zugang({ personId, name, telefon }: { personId: string; name: string; telefon: string | null | undefined }) {
  const [einladungen, setEinladungen] = useState<Einladung[]>([]);
  const [geraete, setGeraete] = useState<Geraet[]>([]);
  const [moeglich, setMoeglich] = useState<boolean | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  const [fehler, setFehler] = useState('');
  const [rolle, setRolle] = useState<Koppelansicht>('monteur');

  const laden = useCallback(async () => {
    if (!supabase) return;
    const c = supabase;
    const [e, g] = await Promise.all([
      c.from('einladung').select('id,token,ansicht,gueltig_bis,eingeloest_am').eq('mitarbeiter_id', personId).order('erstellt_am', { ascending: false }).limit(5),
      c.from('geraet').select('id,ansicht,bezeichnung,gekoppelt_am,gesperrt').eq('mitarbeiter_id', personId).order('gekoppelt_am', { ascending: false }),
    ]);
    if (e.error && fehltTabelle(e.error.message)) { setMoeglich(false); return; }
    setMoeglich(true);
    setEinladungen((e.data ?? []) as Einladung[]);
    setGeraete((g.data ?? []) as Geraet[]);
  }, [personId]);

  useEffect(() => { void laden(); }, [laden]);

  /** Offene Einladung dieser Rolle — erst wenn keine mehr gilt, lohnt ein neuer Link. */
  const offen = einladungen.find((e) => stand(e) === 'offen' && e.ansicht === rolle);
  const link = offen ? einladungsLink(window.location.origin, offen.token) : '';

  async function einladen() {
    if (!supabase || laeuft) return;
    setLaeuft(true);
    setFehler('');
    const token = crypto.randomUUID();
    const { error } = await supabase.from('einladung').insert({
      mitarbeiter_id: personId,
      ansicht: rolle,
      token,
      gueltig_bis: new Date(Date.now() + GUELTIG_STUNDEN * 3600_000).toISOString(),
    });
    setLaeuft(false);
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  async function sperren(id: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc('geraet_sperren', { p_geraet: id });
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch { setFehler('Kopieren ging nicht — Link von Hand markieren.'); }
  }

  if (moeglich === false || moeglich === null) return null;

  const wa = offen ? waLink(telefon, einladungsText(name, link)) : null;
  const aktiv = geraete.filter((g) => !g.gesperrt);

  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-surface-2/40 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="lbl mb-0">Zugang aufs Handy</span>
        <div className="flex rounded-full border border-ink/10 bg-white p-0.5" role="group" aria-label="Als wen">
          {(['monteur', 'chef'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setRolle(k)} aria-pressed={rolle === k}
              className={'rounded-full px-2.5 py-1 text-[11px] font-semibold transition ' + (rolle === k ? 'bg-ink text-white' : 'text-ink2 hover:text-ink')}>
              {k === 'monteur' ? 'Monteur' : 'Chefmonteur'}
            </button>
          ))}
        </div>
      </div>

      {aktiv.length > 0 && (
        <ul className="space-y-1.5">
          {aktiv.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <Smartphone size={15} className="shrink-0 text-steel" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {g.bezeichnung ?? 'Gerät'} <span className="text-ink3">· {g.ansicht === 'chef' ? 'Chefmonteur' : 'Monteur'} · seit {datum(g.gekoppelt_am)}</span>
              </span>
              <button type="button" onClick={() => void sperren(g.id)} className="shrink-0 text-xs font-semibold text-accent-deep hover:underline">Sperren</button>
            </li>
          ))}
        </ul>
      )}

      {offen ? (
        <div className="space-y-2">
          <p className="text-xs text-ink3">Link bereit, {restText(offen.gueltig_bis)} gültig. Einmal verwendbar.</p>
          <div className="flex flex-wrap gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-px">
                Per WhatsApp schicken
              </a>
            )}
            <button type="button" onClick={() => void kopieren()} className="btn-ghost inline-flex items-center gap-1.5">
              {kopiert ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
              {kopiert ? 'Kopiert' : 'Link kopieren'}
            </button>
          </div>
          {!wa && <p className="text-xs text-ink3">Keine Telefonnummer hinterlegt — darum nur zum Kopieren.</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <button type="button" onClick={() => void einladen()} disabled={laeuft} className="btn-ghost disabled:opacity-60">
            {laeuft ? 'Einen Moment …' : aktiv.length > 0 ? 'Weiteres Gerät einladen' : 'Zugang einladen'}
          </button>
          <p className="text-xs text-ink3">
            {name.split(/\s+/)[0] || 'Die Person'} bekommt einen Link, tippt ihn einmal an und muss sich danach nie wieder anmelden.
          </p>
        </div>
      )}

      {fehler && <p className="text-xs font-semibold text-accent-deep">{fehler}</p>}
    </div>
  );
}
