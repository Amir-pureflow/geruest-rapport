/**
 * Erste Seite: «Welche Ansicht?» — fünf Knöpfe, kein Login (Entscheid 09.09.).
 * Die Wahl bleibt im Gerät; oben rechts lässt sie sich jederzeit wechseln.
 */
import { useNavigate } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { ANSICHTEN, GRUPPEN, ansichtSetzen, useAnsicht, type Ansicht } from '../lib/ansicht';
import { supabase } from '../lib/supabase';

export function Ansicht({ hinweis }: { hinweis?: string }) {
  const navigiere = useNavigate();
  const aktuell = useAnsicht();

  function waehlen(a: Ansicht) {
    ansichtSetzen(a);
    navigiere('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10 lg:max-w-4xl lg:px-10">
        <div className="mb-7 text-center">
          <div className="mb-3 flex justify-center"><Marke className="h-12 w-12 rounded-[12px]" /></div>
          <p><Wortmarke gross /></p>
          <p className="mt-2 text-sm text-ink3">Wer bist du? Die App zeigt dann nur, was du brauchst.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
          {GRUPPEN.map((g) => (
            <section key={g.key} className="space-y-2.5">
              <p className="lbl mb-0">{g.titel} <span className="normal-case tracking-normal text-ink3/70">· {g.text}</span></p>
              {ANSICHTEN.filter((a) => a.gruppe === g.key).map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => waehlen(a.key)}
                  className={'card flex w-full items-center justify-between gap-3 text-left transition active:bg-ground lg:min-h-[6.5rem] ' + (aktuell === a.key ? 'ring-1 ring-ink' : '')}
                >
                  <span>
                    <span className="flex items-baseline gap-2 font-display text-[17px] font-semibold">{a.titel}{aktuell === a.key ? <span className="font-body text-xs font-normal text-accent-deep">zuletzt</span> : null}</span>
                    <span className="block text-sm text-ink3">{a.text}</span>
                  </span>
                  <span className="text-ink3" aria-hidden="true">›</span>
                </button>
              ))}
            </section>
          ))}
        </div>

        {hinweis && (
          <div className="mt-5 rounded-[12px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-deep">
            <strong>Keine Datenverbindung:</strong> {hinweis}
            <span className="mt-1 block text-xs">
              {/rate limit/i.test(hinweis)
                ? 'Zu viele neue Geräte in kurzer Zeit (Supabase-Limit). In ein paar Minuten neu laden — bestehende Geräte sind nicht betroffen.'
                : /anonymous/i.test(hinweis)
                  ? 'Im Supabase-Dashboard unter Authentication › Sign In / Providers «Allow anonymous sign-ins» einschalten, dann diese Seite neu laden.'
                  : 'Netz prüfen und diese Seite neu laden.'}
            </span>
            <button type="button" className="btn-ghost mt-2" onClick={() => location.reload()}>Neu laden</button>
          </div>
        )}
        {!supabase && (
          <p className="mt-5 text-center text-xs text-ink3">Offline-Modus — ohne .env läuft die App nur lokal.</p>
        )}
      </main>
    </div>
  );
}
