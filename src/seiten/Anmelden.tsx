/**
 * Anmeldung der Firma — die erste Seite, wenn `MODUS_ANMELDUNG = login` gesetzt ist (02.10.2026).
 *
 * Eine Anmeldung je Firma. Danach kommt wie bisher «Welche Ansicht?» mit Bauführer, Chefmonteur,
 * Monteur und Sekretariat. An der Arbeit danach ändert sich nichts.
 *
 * Das Gerät bleibt angemeldet, bis jemand abmeldet. Das ist Absicht: das Teamgerät steht auf der
 * Baustelle und niemand tippt dort jeden Abend ein Passwort.
 */
import { useState } from 'react';
import { Marke, Wortmarke } from '../ui/Shell';
import { anmelden } from '../lib/konto';
import { supabase } from '../lib/supabase';

export function Anmelden() {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [zeigePasswort, setZeigePasswort] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');

  async function absenden(ev: React.FormEvent) {
    ev.preventDefault();
    if (laeuft) return;
    if (!email.trim() || !passwort) { setFehler('E-Mail und Passwort eingeben.'); return; }
    setLaeuft(true);
    setFehler('');
    const f = await anmelden(email, passwort);
    setLaeuft(false);
    if (f) { setFehler(f); return; }
    // Weiter zur Rollenwahl. Ganz neu laden, nicht nur die Adresse wechseln: die App prüft die
    // Anmeldung beim Start, sonst stünde man nach dem Anmelden wieder vor dem Formular.
    location.replace('/ansicht');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Marke className="h-16 w-16 rounded-[18px]" /></div>
          <p><Wortmarke gross /></p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-ink2">Tagesmeldung, Stunden und Freigabe. Ohne Papier, ohne Suchen.</p>
        </div>

        <form onSubmit={(e) => void absenden(e)} className="card space-y-3">
          <div>
            <h1 className="font-display text-[17px] font-semibold">Anmelden</h1>
            <p className="mt-0.5 text-xs text-ink3">Mit dem Zugang eurer Firma. Wer du bist, wählst du gleich danach.</p>
          </div>

          <div>
            <label className="lbl" htmlFor="firma-email">E-Mail der Firma</label>
            <input
              id="firma-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="firma@beispiel.ch"
              className="field"
            />
          </div>

          <div>
            <label className="lbl" htmlFor="firma-passwort">Passwort</label>
            <div className="flex gap-2">
              <input
                id="firma-passwort"
                type={zeigePasswort ? 'text' : 'password'}
                autoComplete="current-password"
                value={passwort}
                onChange={(e) => setPasswort(e.target.value)}
                className="field flex-1"
              />
              <button
                type="button"
                onClick={() => setZeigePasswort((z) => !z)}
                className="btn-ghost shrink-0 px-3"
                aria-pressed={zeigePasswort}
              >
                {zeigePasswort ? 'verbergen' : 'zeigen'}
              </button>
            </div>
          </div>

          {fehler && <p className="rounded-[10px] border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent-deep">{fehler}</p>}

          <button type="submit" disabled={laeuft} className="cta disabled:opacity-70">
            {laeuft ? 'Einen Moment …' : 'Anmelden'}
          </button>

          <p className="text-[11px] text-ink3">
            Das Gerät bleibt angemeldet, bis jemand abmeldet. Auf dem Teamgerät soll niemand jeden Abend ein Passwort tippen.
          </p>
        </form>

        {!supabase && (
          <p className="mt-5 text-center text-xs text-ink3">Offline-Modus. Ohne Datenverbindung geht die Anmeldung nicht.</p>
        )}
      </main>
    </div>
  );
}
