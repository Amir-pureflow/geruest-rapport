import { useEffect, useState } from 'react';
import { Shell } from '../ui/Shell';
import { enqueueMeldung, offeneAnzahl } from '../lib/db';

/**
 * Phase-0-Platzhalter mit ECHTER Offline-Queue:
 * Der grüne Knopf schreibt bereits in IndexedDB — im Flugmodus testbar.
 * Vorbelegung (Baustelle, Team, Stunden) folgt in Phase 2.
 */
export function Erfassung() {
  const [offen, setOffen] = useState<number>(0);
  const [gespeichert, setGespeichert] = useState(false);

  const aktualisieren = () => {
    void offeneAnzahl().then(setOffen);
  };

  useEffect(aktualisieren, []);

  const allesWieGeplant = () => {
    void enqueueMeldung({
      datum: new Date().toISOString().slice(0, 10),
      normalfall: true,
    }).then(() => {
      setGespeichert(true);
      aktualisieren();
      setTimeout(() => setGespeichert(false), 2000);
    });
  };

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold">Heute</h1>
          <span className="font-mono text-xs text-ink3">
            {navigator.onLine ? 'online' : 'offline'} · {offen} in Warteschlange
          </span>
        </header>

        <section className="card text-sm text-ink3">
          Baustelle, Team und Stunden werden hier vorbelegt (Phase 2).
        </section>

        <button type="button" onClick={allesWieGeplant} className="cta cta-good py-5">
          {gespeichert ? 'Gespeichert ✓' : '✓ Alles wie geplant'}
        </button>

        <div>
          <p className="mb-2 text-center text-sm text-ink3">War etwas anders?</p>
          <div className="grid grid-cols-3 gap-2">
            {['➕ zusätzlich', '⏱ warten', '🔧 kaputt'].map((s) => (
              <button
                key={s}
                type="button"
                disabled
                className="chip py-3.5 opacity-50"
                title="Phase 2"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-ink3">
          Demo: Der grüne Knopf schreibt in die lokale Warteschlange (auch im
          Flugmodus) und sendet automatisch, sobald Netz da ist.
        </p>
      </div>
    </Shell>
  );
}
