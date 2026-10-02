/**
 * Nach der Anmeldung: «Welche Ansicht?» — vier Knöpfe.
 * Die Wahl bleibt im Gerät; oben rechts lässt sie sich jederzeit wechseln.
 *
 * Bis 02.10.2026 war das die allererste Seite und es gab kein Passwort. Seither meldet sich
 * zuerst die Firma an (Anmelden.tsx); welche Daten man danach sieht, entscheidet die Datenbank.
 */
import { useNavigate } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { ansichten, gruppen, ansichtSetzen, useAnsicht, type Ansicht } from '../lib/ansicht';
import { supabase } from '../lib/supabase';
import { HardHat, ClipboardList, Users, User, Handshake, ChevronRight, type LucideIcon } from 'lucide-react';

const ICON: Record<Ansicht, LucideIcon> = { bauf: HardHat, sekretariat: ClipboardList, chef: Users, monteur: User, kunde: Handshake };

export function Ansicht() {
  const navigiere = useNavigate();
  const aktuell = useAnsicht();

  function waehlen(a: Ansicht) {
    ansichtSetzen(a);
    navigiere('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10 md:max-w-3xl md:px-10">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Marke className="h-16 w-16 rounded-[18px]" /></div>
          <p><Wortmarke gross /></p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-ink2">Tagesmeldung, Stunden und Freigabe — ohne Papier, ohne Suchen.</p>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-ink3">Wer bist du?</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
          {gruppen().map((g) => (
            <section key={g.key} className="space-y-2.5">
              <p className="lbl mb-0">{g.titel} <span className="normal-case tracking-normal text-ink3/70">· {g.text}</span></p>
              {ansichten().filter((a) => a.gruppe === g.key).map((a) => (
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

        {!supabase && (
          <p className="mt-5 text-center text-xs text-ink3">Offline-Modus — ohne .env läuft die App nur lokal.</p>
        )}
      </main>
    </div>
  );
}
