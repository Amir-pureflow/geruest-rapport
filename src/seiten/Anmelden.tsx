import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Marke, Wortmarke } from '../ui/Shell';

/**
 * Login per Magic Link — kein Passwort (CLAUDE.md: einfachste Bedienung).
 * E-Mail eintippen → Link in der Mail antippen → dauerhaft angemeldet.
 */
export function Anmelden() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'offen' | 'gesendet' | 'fehler'>('offen');
  const [meldung, setMeldung] = useState('');

  async function senden(e: FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setStatus('fehler');
      setMeldung('Supabase ist nicht konfiguriert (.env fehlt).');
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus('fehler');
      setMeldung(error.message);
    } else {
      setStatus('gesendet');
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center"><Marke className="h-12 w-12 rounded-[12px]" /></div>
          <p><Wortmarke gross /></p>
          <p className="mt-2 text-sm text-ink3">
            Anmelden — du bekommst einen Link per Mail. Kein Passwort.
          </p>
        </div>

        {status === 'gesendet' ? (
          <div className="card border-good/40 bg-good-soft">
            <p className="font-display font-bold text-good-deep">
              Mail unterwegs an {email.trim()}
            </p>
            <p className="mt-1 text-sm text-ink2">
              Link in der Mail antippen — dann bist du drin. Die Mail kann ein,
              zwei Minuten brauchen; sonst im Spam nachschauen.
            </p>
          </div>
        ) : (
          <form onSubmit={senden} className="card space-y-3 p-5">
            <label className="lbl" htmlFor="email">E-Mail</label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="deine@mail.ch"
              className="field"
            />
            <button type="submit" className="cta">Link schicken</button>
            {status === 'fehler' && (
              <p className="text-sm font-semibold text-accent-deep">{meldung}</p>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
