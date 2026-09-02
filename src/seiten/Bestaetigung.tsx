import { useParams } from 'react-router-dom';

/**
 * Kundenlink — kein Login, kein Konto, deshalb auch ohne App-Rahmen.
 * Phase 4: Edge Function prüft den signierten Token, liefert Rapport-Metadaten,
 * nimmt [Bestätigen]/[Rückfrage] entgegen und schreibt zustellung_log.
 */
export function Bestaetigung() {
  const { token } = useParams();

  return (
    <div className="min-h-screen">
      <div className="stripe" aria-hidden="true" />
      <main className="mx-auto max-w-md px-5 py-8 space-y-5">
        <header>
          <p className="lbl">Regierapport</p>
          <h1 className="font-display text-2xl font-bold">Bümplizstrasse 113</h1>
          <p className="mt-1 text-sm text-ink3">
            Vorschau — die echte Ansicht kommt in Phase 4. Token:{' '}
            <span className="font-mono">{token}</span>
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled className="cta cta-good opacity-50" title="Phase 4">
            Bestätigen
          </button>
          <button
            type="button"
            disabled
            className="rounded-xl border border-line-strong py-4 font-display font-bold text-ink3 opacity-70"
            title="Phase 4"
          >
            Rückfrage
          </button>
        </div>
      </main>
    </div>
  );
}
