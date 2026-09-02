import { Link } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { modellfallVersetzen, formatChf } from '../lib/tarif';
import { supabase } from '../lib/supabase';

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function NavKarte({ zu, titel, text }: { zu: string; titel: string; text: string }) {
  return (
    <Link to={zu} className="card flex items-center justify-between gap-3 hover:border-line-strong">
      <span>
        <span className="block font-display text-[16px] font-bold">{titel}</span>
        <span className="block text-sm text-ink3">{text}</span>
      </span>
      <span className="text-ink3" aria-hidden="true">›</span>
    </Link>
  );
}

export function Start() {
  const modell = modellfallVersetzen();
  const heute = new Date();
  const datum = `${WOCHENTAGE[heute.getDay()]}, ${heute.getDate()}.${heute.getMonth() + 1}.${heute.getFullYear()}`;

  return (
    <Shell>
      <div className="space-y-5">
        <header className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold">{datum}</h1>
          <span className="flex items-center gap-1.5 text-xs font-mono text-ink3">
            <span
              className={
                'inline-block h-2 w-2 rounded-full ' +
                (supabase ? 'bg-good' : 'bg-accent')
              }
            />
            {supabase ? 'verbunden' : 'offline-Modus'}
          </span>
        </header>

        <Link
          to="/zusatzauftrag"
          className="block rounded-[14px] bg-accent p-5 text-white shadow-[0_3px_14px_rgb(226_90_28/0.35)] transition active:bg-accent-deep"
        >
          <span className="block font-display text-lg font-extrabold">+ Zusatzarbeit</span>
          <span className="mt-0.5 block text-sm text-white/85">
            Kundenbestellung festhalten, während er noch am Telefon ist — 20 Sekunden
          </span>
        </Link>

        <nav className="grid gap-3">
          <NavKarte zu="/erfassung" titel="Erfassung" text="Teamgerät — ein Knopf für den normalen Tag" />
          <NavKarte zu="/cockpit" titel="Wochenübersicht" text="Prüfen und freigeben, statt telefonieren" />
          <NavKarte zu="/regie" titel="Regierapporte" text="Versand, Zustellnachweis und Fristen" />
          <NavKarte zu="/b/demo-token" titel="Kundenlink" text="So bestätigt die Bauleitung — ohne Konto" />
        </nav>

        <section className="card">
          <p className="lbl">Tarifrechner · SGUV 2026/27</p>
          <p className="text-sm text-ink2">
            Referenzfall «Gerüst versetzen» — 2 Monteure × 2 h, Lieferwagen, Etappe, 9 % Miete:
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-accent-deep">
            {formatChf(modell.totalRappen)}
          </p>
          <p className="mt-1 text-xs text-ink3">Vorgerechnet als Entscheidungshilfe — der Beleg entsteht in SORBA.</p>
        </section>
      </div>
    </Shell>
  );
}
