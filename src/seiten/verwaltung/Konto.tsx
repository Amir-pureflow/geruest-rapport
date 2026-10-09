/**
 * «Benutzerkonto» im Mitarbeiter-Dialog (10.10.2026, Erin).
 *
 * Wer eine Person erfasst, gibt ihr hier gleich ein Konto: Rolle wählen (Monteur, Chefmonteur, Bauführer,
 * Sekretariat), Passwort steht schon da, ein Knopf. Danach stehen Adresse und Passwort **einmal** da —
 * zum Aufschreiben oder Kopieren und per Nachricht schicken. Später: Rolle ändern, Passwort neu setzen
 * (nicht mehr lesen), Konto löschen.
 *
 * Alles läuft über die Datenbankfunktionen aus 0034. Die entscheiden, wer was darf (`konten_recht`):
 * der Bauführer zum Beispiel keine Sekretariats-Konten. `darfVergeben()` graut hier nur die Knöpfe aus.
 * Fehlt die Migration, blendet Mitarbeiter.tsx den Abschnitt aus.
 */
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { festeAnsicht } from '../../lib/ansicht';
import { KeyRound, Copy, Check, RefreshCw } from 'lucide-react';
import {
  benutzername, kontoAdresse, passwortVorschlag, rolleVorschlag, darfVergeben, KONTO_ROLLEN, type KontoRolle,
} from '../../lib/benutzername';

export interface KontoInfo { mitarbeiter_id: string; email: string; ansicht: KontoRolle; letzte_anmeldung: string | null; ich: boolean }

const titel = (r: KontoRolle) => KONTO_ROLLEN.find((x) => x.key === r)?.titel ?? r;
const datum = (s: string) => new Date(s).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
/** Datenbankmeldung ohne das technische Drumherum. */
const meldung = (m: string) => m.replace(/^.*?ERROR:\s*/, '');

/** Vier Rollen als Chips, darunter ein Satz, was die gewählte kann. Was ich nicht vergeben darf, ist grau. */
function RollenWahl({ wert, onWahl }: { wert: KontoRolle; onWahl: (r: KontoRolle) => void }) {
  const ich = festeAnsicht();
  const gewaehlt = KONTO_ROLLEN.find((r) => r.key === wert);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rolle">
        {KONTO_ROLLEN.map((r) => {
          const darf = darfVergeben(ich, r.key);
          return (
            <button key={r.key} type="button" disabled={!darf} onClick={() => onWahl(r.key)} aria-pressed={wert === r.key}
              title={darf ? r.text : 'Konten fürs Sekretariat legt das Sekretariat an.'}
              className={'chip px-3 py-1.5 text-xs disabled:opacity-40 ' + (wert === r.key ? 'chip-on' : '')}>{r.titel}</button>
          );
        })}
      </div>
      {gewaehlt && <p className="text-xs text-ink3">{gewaehlt.text}</p>}
    </div>
  );
}

export function Konto({ personId, name, funktion, domain, konto, onGeaendert }: {
  personId: string;
  name: string;
  funktion: string;
  /** firma.mail_domain, z. B. «geruest.ch» — nur für die Vorschau; die Adresse macht die Datenbank. */
  domain: string | null;
  konto: KontoInfo | undefined;
  onGeaendert: () => void;
}) {
  const ich = festeAnsicht();
  const vorgeschlagen = rolleVorschlag(funktion);
  const [rolle, setRolle] = useState<KontoRolle>(darfVergeben(ich, vorgeschlagen) ? vorgeschlagen : 'monteur');
  const [passwort, setPasswort] = useState(() => passwortVorschlag());
  const [aktion, setAktion] = useState<'passwort' | 'rolle' | 'loeschen' | null>(null);
  const [neuesPasswort, setNeuesPasswort] = useState('');
  const [neueRolle, setNeueRolle] = useState<KontoRolle>('monteur');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  /** Gerade angelegt oder neu gesetzt: einmal zeigen. */
  const [zugang, setZugang] = useState<{ email: string; passwort: string } | null>(null);
  const [kopiert, setKopiert] = useState(false);

  const vorschlag = benutzername(name);
  const adresse = kontoAdresse(name, domain);
  /** Ein Bauführer sieht ein Sekretariats-Konto, darf es aber nicht anfassen; das eigene Konto fasst niemand selbst an. */
  const darfAnfassen = !!konto && darfVergeben(ich, konto.ansicht);

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
    const email = (await rpc('konto_anlegen', { p_mitarbeiter: personId, p_benutzername: vorschlag, p_passwort: passwort, p_ansicht: rolle })) as string;
    setZugang({ email, passwort });
    onGeaendert();
  });

  const passwortSetzen = () => los(async () => {
    if (!konto) return;
    await rpc('konto_passwort', { p_mitarbeiter: personId, p_passwort: neuesPasswort });
    setZugang({ email: konto.email, passwort: neuesPasswort });
    setAktion(null);
  });

  const rolleSetzen = () => los(async () => {
    await rpc('konto_rolle', { p_mitarbeiter: personId, p_ansicht: neueRolle });
    setAktion(null);
    onGeaendert();
  });

  const loeschen = () => los(async () => {
    await rpc('konto_loeschen', { p_mitarbeiter: personId });
    setAktion(null);
    setZugang(null);
    onGeaendert();
  });

  async function kopieren() {
    if (!zugang) return;
    const text = `Rapporto: ${window.location.origin}\nE-Mail: ${zugang.email}\nPasswort: ${zugang.passwort}`;
    try { await navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 2000); } catch { /* ohne Zwischenablage: abschreiben */ }
  }

  return (
    <div className="space-y-3 rounded-[14px] border border-line px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} className="text-ink3" aria-hidden="true" />Benutzerkonto</p>

      {zugang && (
        <div className="space-y-2 rounded-[10px] bg-surface-2/70 px-3 py-2.5 text-sm">
          <p className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="text-ink3">E-Mail</span><span className="break-all font-mono font-semibold">{zugang.email}</span>
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
            <span className="break-all font-mono font-semibold">{konto.email}</span>
            <span className="text-ink2"> · {titel(konto.ansicht)}</span>
            <span className="text-ink3"> · {konto.letzte_anmeldung ? `zuletzt angemeldet ${datum(konto.letzte_anmeldung)}` : 'noch nie angemeldet'}</span>
          </p>

          {konto.ich ? (
            <p className="text-xs text-ink3">Das ist dein eigenes Konto. Rolle ändern oder löschen kann es nur jemand anderes.</p>
          ) : !darfAnfassen ? (
            <p className="text-xs text-ink3">Konten fürs Sekretariat verwaltet das Sekretariat.</p>
          ) : aktion === 'passwort' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={neuesPasswort} onChange={(e) => setNeuesPasswort(e.target.value)} className="field w-44 py-1.5 font-mono" aria-label="Neues Passwort" />
              <button type="button" onClick={() => setNeuesPasswort(passwortVorschlag())} className="btn-ghost p-2" title="Anderer Vorschlag" aria-label="Anderer Vorschlag"><RefreshCw size={14} /></button>
              <button type="button" disabled={laeuft || neuesPasswort.length < 8} onClick={() => void passwortSetzen()} className="btn-ghost text-xs font-semibold">Setzen</button>
              <button type="button" onClick={() => setAktion(null)} className="btn-ghost text-xs">Abbrechen</button>
            </div>
          ) : aktion === 'rolle' ? (
            <div className="space-y-2">
              <RollenWahl wert={neueRolle} onWahl={setNeueRolle} />
              <p className="text-xs text-ink3">Gilt, sobald die Person die App das nächste Mal öffnet.</p>
              <div className="flex gap-2">
                <button type="button" disabled={laeuft || neueRolle === konto.ansicht} onClick={() => void rolleSetzen()} className="btn-ghost text-xs font-semibold">Speichern</button>
                <button type="button" onClick={() => setAktion(null)} className="btn-ghost text-xs">Abbrechen</button>
              </div>
            </div>
          ) : aktion === 'loeschen' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Konto löschen? Das Gerät ist sofort abgemeldet. Person und Stunden bleiben.</span>
              <button type="button" disabled={laeuft} onClick={() => void loeschen()} className="btn-ghost text-xs font-semibold text-accent-deep">Ja, löschen</button>
              <button type="button" onClick={() => setAktion(null)} className="btn-ghost text-xs">Nein</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setNeueRolle(konto.ansicht); setAktion('rolle'); }} className="btn-ghost text-xs">Rolle ändern</button>
              <button type="button" onClick={() => { setZugang(null); setNeuesPasswort(passwortVorschlag()); setAktion('passwort'); }} className="btn-ghost text-xs">Passwort neu setzen</button>
              <button type="button" onClick={() => setAktion('loeschen')} className="btn-ghost text-xs text-accent-deep">Konto löschen</button>
            </div>
          )}
        </>
      ) : (
        <>
          <RollenWahl wert={rolle} onWahl={setRolle} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="lbl">E-Mail zum Anmelden</span>
              <p className="break-all py-2 font-mono text-sm font-semibold">{vorschlag ? adresse : '—'}</p>
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
            {laeuft ? 'Wird angelegt …' : `Konto als ${titel(rolle)} anlegen`}
          </button>
          {passwort.length < 8 && <p className="text-xs text-ink3">Passwort: mindestens 8 Zeichen.</p>}
        </>
      )}

      {fehler && <p className="text-sm font-semibold text-accent-deep">{fehler}</p>}
    </div>
  );
}
