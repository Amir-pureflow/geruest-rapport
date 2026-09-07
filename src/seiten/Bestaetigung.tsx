import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { supabaseUrl } from '../lib/supabase';
import { formatChf } from '../lib/tarif';

/**
 * Kundenlink — kein Login, kein Konto, kein App-Rahmen.
 * Spricht direkt mit der Edge Function `bestaetigung` (Token-Auth).
 */

interface Daten {
  status: string;
  betrag_rappen: number | null;
  versendet_am: string | null;
  frist_bis: string | null;
  bezeichnung: string | null;
  konto_nr: string | null;
}

type Zustand = 'laedt' | 'fehler' | 'offen' | 'rueckfrage_text' | 'fertig';

export function Bestaetigung() {
  const { token } = useParams();
  const [zustand, setZustand] = useState<Zustand>('laedt');
  const [daten, setDaten] = useState<Daten | null>(null);
  const [meldung, setMeldung] = useState('');
  const [kommentar, setKommentar] = useState('');
  const [sendet, setSendet] = useState(false);

  const basis = supabaseUrl ? `${supabaseUrl}/functions/v1/bestaetigung` : null;

  useEffect(() => {
    if (!basis || !token) {
      setZustand('fehler');
      setMeldung('Link unvollständig.');
      return;
    }
    void fetch(`${basis}?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = (await r.json()) as Daten & { fehler?: string };
        if (!r.ok) {
          setZustand('fehler');
          setMeldung(j.fehler ?? 'Dieser Link ist ungültig.');
          return;
        }
        setDaten(j);
        setZustand(j.status === 'bestaetigt' ? 'fertig' : 'offen');
        if (j.status === 'bestaetigt') setMeldung('Dieser Regierapport wurde bereits bestätigt. Vielen Dank!');
      })
      .catch(() => {
        setZustand('fehler');
        setMeldung('Verbindung fehlgeschlagen — bitte später nochmals versuchen.');
      });
  }, [basis, token]);

  async function antworten(aktion: 'bestaetigt' | 'rueckfrage') {
    if (!basis || !token) return;
    setSendet(true);
    const r = await fetch(basis, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, aktion, kommentar: kommentar.trim() || undefined }),
    }).catch(() => null);
    setSendet(false);
    if (!r || !r.ok) {
      setMeldung('Das hat nicht geklappt — bitte nochmals versuchen.');
      return;
    }
    setZustand('fertig');
    setMeldung(
      aktion === 'bestaetigt'
        ? 'Besten Dank — der Regierapport ist bestätigt.'
        : 'Ihre Rückfrage ist angekommen — wir melden uns.',
    );
  }

  return (
    <div className="min-h-screen">
      <header className="appbar">
        <div className="mx-auto flex h-14 max-w-md items-center gap-2.5 px-5"><Marke /><Wortmarke /></div>
      </header>
      <main className="mx-auto max-w-md px-5 py-8 space-y-5">
        {zustand === 'laedt' && <div className="card text-sm text-ink3">Lädt …</div>}

        {zustand === 'fehler' && (
          <div className="card border-accent/40 bg-accent-soft text-sm">{meldung}</div>
        )}

        {daten && zustand !== 'laedt' && zustand !== 'fehler' && (
          <>
            <header>
              <p className="lbl mb-1">Regierapport</p>
              <h1 className="font-display text-2xl font-bold">{daten.bezeichnung ?? '—'}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink3">
                {daten.konto_nr && <span className="knr">{daten.konto_nr}</span>}
                {daten.betrag_rappen != null && (
                  <span className="font-mono font-semibold text-accent-deep">
                    {formatChf(daten.betrag_rappen)}
                  </span>
                )}
                {daten.frist_bis && zustand === 'offen' && <span>· Frist bis {daten.frist_bis}</span>}
              </p>
              <p className="mt-2 text-sm text-ink2">
                Die Details finden Sie im Dokument, das Ihnen per Mail zugestellt wurde.
              </p>
            </header>

            {zustand === 'offen' && (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled={sendet} onClick={() => void antworten('bestaetigt')} className="cta cta-good">
                  Bestätigen
                </button>
                <button
                  type="button"
                  onClick={() => setZustand('rueckfrage_text')}
                  className="rounded-xl border border-line-strong bg-surface py-4 font-display font-bold text-ink2 hover:border-ink3"
                >
                  Rückfrage
                </button>
              </div>
            )}

            {zustand === 'rueckfrage_text' && (
              <div className="card space-y-3 p-5">
                <label className="lbl">Ihre Rückfrage</label>
                <textarea
                  value={kommentar}
                  onChange={(e) => setKommentar(e.target.value)}
                  rows={3}
                  placeholder="Was möchten Sie klären?"
                  className="field resize-none"
                />
                <button type="button" disabled={sendet} onClick={() => void antworten('rueckfrage')} className="cta">
                  Rückfrage senden
                </button>
                <button type="button" onClick={() => setZustand('offen')} className="btn-ghost w-full">
                  Zurück
                </button>
              </div>
            )}

            {zustand === 'fertig' && (
              <div className="card border-good/40 bg-good-soft">
                <p className="font-display font-bold text-good-deep">{meldung}</p>
              </div>
            )}

            {meldung && zustand === 'offen' && (
              <p className="text-sm font-semibold text-accent-deep">{meldung}</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
