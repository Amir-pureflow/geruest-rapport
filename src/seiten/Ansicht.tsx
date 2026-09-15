/**
 * Erste Seite: «Welche Ansicht?» — fünf Knöpfe, kein Login (Entscheid 09.09.).
 * Die Wahl bleibt im Gerät; oben rechts lässt sie sich jederzeit wechseln.
 */
import { useNavigate } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { ANSICHTEN, GRUPPEN, ansichtSetzen, useAnsicht, type Ansicht } from '../lib/ansicht';
import { supabase } from '../lib/supabase';
import { HardHat, ClipboardList, Users, User, Handshake, ChevronRight, type LucideIcon } from 'lucide-react';

const ICON: Record<Ansicht, LucideIcon> = { bauf: HardHat, sekretariat: ClipboardList, chef: Users, monteur: User, kunde: Handshake };

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
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Marke className="h-16 w-16 rounded-[18px]" /></div>
          <p><Wortmarke gross /></p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-ink2">Tagesmeldung, Regie und Freigabe — ohne Papier, ohne Suchen.</p>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-ink3">Wer bist du?</p>
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
                  className={'card flex w-full items-center justify-between gap-3 text-left transition active:bg-ground lg:min-h-[6.5rem] ' + (aktuell === a.key ? 'ring-1 ring-accent' : '')}
                >
                  <span className="flex min-w-0 items-center gap-3.5">
                    {(() => { const I = ICON[a.key]; return <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-deep"><I size={22} strokeWidth={1.8} aria-hidden="true" /></span>; })()}
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2 font-display text-[17px] font-semibold">{a.titel}{aktuell === a.key ? <span className="font-body text-xs font-normal text-accent-deep">zuletzt</span> : null}</span>
                      <span className="block text-sm text-ink3">{a.text}</span>
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-ink3" aria-hidden="true" />
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
