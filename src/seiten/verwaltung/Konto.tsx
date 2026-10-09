/**
 * «Benutzerkonto» im Mitarbeiter-Dialog (10.10.2026, Erin).
 *
 * Der Bauführer erfasst eine Person und gibt ihr hier gleich ein Konto: Rolle wählen, Passwort steht
 * schon da, ein Knopf. Danach sieht er Adresse und Passwort **einmal** — zum Aufschreiben oder
 * Kopieren und per Nachricht schicken. Später lässt sich das Passwort neu setzen, nicht mehr lesen.
 *
 * Alles läuft über die Datenbankfunktionen aus 0034 (`konto_anlegen`, `konto_passwort`,
 * `konto_loeschen`). Die prüfen selbst, dass nur ein Büro-Zugang das darf.
 * Fehlt die Migration, blendet Mitarbeiter.tsx den Abschnitt aus.
 */
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { KeyRound, Copy, Check, RefreshCw } from 'lucide-react';
import { benutzername, kontoAdresse, passwortVorschlag } from '../../lib/benutzername';

export type KontoRolle = 'chef' | 'monteur';
export interface KontoInfo { mitarbeiter_id: string; email: string; ansicht: KontoRolle; letzte_anmeldung: string | null }

const ROLLEN: [KontoRolle, string][] = [['monteur', 'Monteur'], ['chef', 'Chefmonteur']];
/** Funktionen, die meist ein Team führen — dann ist «Chefmonteur» vorgewählt. */
const FUEHREN = ['gruppe', 'objekt', 'bauf'];

const datum = (s: string) => new Date(s).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
/** Datenbankmeldung ohne das technische Drumherum. */
const meldung = (m: string) => m.replace(/^.*?ERROR:\s*/, '');

export function Konto({ personId, name, funktion, domain, konto, onGeaendert }: {
  personId: string;
  name: string;
  funktion: string;
  /** firma.mail_domain, z. B. «geruest.ch» — nur für die Vorschau; die Adresse macht die Datenbank. */
  domain: string | null;
  konto: KontoInfo | undefined;
  onGeaendert: () => void;
}) {
  const [rolle, setRolle] = useState<KontoRolle>(FUEHREN.includes(funktion) ? 'chef' : 'monteur');
  const [passwort, setPasswort] = useState(() => passwortVorschlag());
  const [neuesPasswort, setNeuesPasswort] = useState<string | null>(null);
  const [loeschenFragen, setLoeschenFragen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  /** Gerade angelegt oder neu gesetzt: einmal zeigen. */
  const [zugang, setZugang] = useState<{ benutzer: string; passwort: string } | null>(null);
  const [kopiert, setKopiert] = useState(false);

  const vorschlag = benutzername(name);
  const adresse = kontoAdresse(name, domain);

  async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!supabase) throw new Error('Keine Datenverbindung.');
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(meldung(error.message));
    return data;
  }

  async function los(f: () => Promise<void>) {
    if (laeuft) return;
    setLaeuft(true);
    setFehler('');
    try { await f(); } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    setLaeuft(false);
  }

  const anlegen = () => los(async () => {
    if (!vorschlag) throw new Error('Zuerst einen Namen eintragen und speichern.');
    const b = (await rpc('konto_anlegen', { p_mitarbeiter: personId, p_benutzername: vorschlag, p_passwort: passwort, p_ansicht: rolle })) as string;
    setZugang({ benutzer: b, passwort });
    onGeaendert();
  });

  const passwortSetzen = () => los(async () => {
    if (!konto || !neuesPasswort) return;
    await rpc('konto_passwort', { p_mitarbeiter: personId, p_passwort: neuesPasswort });
    setZugang({ benutzer: konto.email, passwort: neuesPasswort });
    setNeuesPasswort(null);
  });

  const loeschen = () => los(async () => {
    await rpc('konto_loeschen', { p_mitarbeiter: personId });
    setLoeschenFragen(false);
    setZugang(null);
    onGeaendert();
  });

  async function kopieren() {
    if (!zugang) return;
    const text = `Rapporto: ${window.location.origin}\nE-Mail: ${zugang.benutzer}\nPasswort: ${zugang.passwort}`;
    try { await navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 2000); } catch { /* ohne Zwischenablage: abschreiben */ }
  }

  return (
    <div className="space-y-3 rounded-[14px] border border-line px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} className="text-ink3" aria-hidden="true" />Benutzerkonto</p>

      {zugang && (
        <div className="space-y-2 rounded-[10px] bg-surface-2/70 px-3 py-2.5 text-sm">
          <p className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="text-ink3">E-Mail</span><span className="font-mono font-semibold">{zugang.benutzer}</span>
            <span className="text-ink3">Passwort</span><span className="font-mono font-semibold">{zugang.passwort}</span>
          </p>
          <p className="text-xs text-ink3">Jetzt aufschreiben oder kopieren und schicken. Das Passwort ist später nicht mehr zu sehen.</p>
          <button type="button" onClick={() => void kopieren()} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
            {kopiert ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{kopiert ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      )}

      {konto ? (
        <>
          <p className="text-sm">
            <span className="font-mono font-semibold">{konto.email}</span>
            <span className="text-ink2"> · {konto.ansicht === 'chef' ? 'Chefmonteur' : 'Monteur'}</span>
            <span className="text-ink3"> · {konto.letzte_anmeldung ? `zuletzt angemeldet ${datum(konto.letzte_anmeldung)}` : 'noch nie angemeldet'}</span>
          </p>
          {neuesPasswort !== null ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={neuesPasswort} onChange={(e) => setNeuesPasswort(e.target.value)} className="field w-44 py-1.5 font-mono" aria-label="Neues Passwort" />
              <button type="button" onClick={() => setNeuesPasswort(passwortVorschlag())} className="btn-ghost p-2" title="Anderer Vorschlag" aria-label="Anderer Vorschlag"><RefreshCw size={14} /></button>
              <button type="button" disabled={laeuft} onClick={() => void passwortSetzen()} className="btn-ghost text-xs font-semibold">Setzen</button>
              <button type="button" onClick={() => setNeuesPasswort(null)} className="btn-ghost text-xs">Abbrechen</button>
            </div>
          ) : loeschenFragen ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Konto löschen? Das Handy ist sofort abgemeldet. Person und Stunden bleiben.</span>
              <button type="button" disabled={laeuft} onClick={() => void loeschen()} className="btn-ghost text-xs font-semibold text-accent-deep">Ja, löschen</button>
              <button type="button" onClick={() => setLoeschenFragen(false)} className="btn-ghost text-xs">Nein</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setZugang(null); setNeuesPasswort(passwortVorschlag()); }} className="btn-ghost text-xs">Passwort neu setzen</button>
              <button type="button" onClick={() => setLoeschenFragen(true)} className="btn-ghost text-xs text-accent-deep">Konto löschen</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rolle">
            {ROLLEN.map(([k, t]) => (
              <button key={k} type="button" onClick={() => setRolle(k)} aria-pressed={rolle === k} className={'chip px-3 py-1.5 text-xs ' + (rolle === k ? 'chip-on' : '')}>{t}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="lbl">E-Mail zum Anmelden</span>
              <p className="py-2 font-mono text-sm font-semibold">{vorschlag ? adresse : '—'}</p>
            </div>
            <label className="block">
              <span className="lbl">Passwort</span>
              <span className="flex items-center gap-2">
                <input value={passwort} onChange={(e) => setPasswort(e.target.value)} className="field py-1.5 font-mono" />
                <button type="button" onClick={() => setPasswort(passwortVorschlag())} className="btn-ghost p-2" title="Anderer Vorschlag" aria-label="Anderer Vorschlag"><RefreshCw size={14} /></button>
              </span>
            </label>
          </div>
          <button type="button" disabled={laeuft || passwort.length < 8} onClick={() => void anlegen()} className="btn-ghost text-sm font-semibold">
            {laeuft ? 'Wird angelegt …' : 'Konto anlegen'}
          </button>
          {passwort.length < 8 && <p className="text-xs text-ink3">Passwort: mindestens 8 Zeichen.</p>}
        </>
      )}

      {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
    </div>
  );
}
