import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Marke, Wortmarke } from '../ui/Shell';
import { supabaseUrl } from '../lib/supabase';
import { formatChf } from '../lib/tarif';
import { ausIso, lang } from '../lib/datum';

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
  datum: string | null;
  positionen: { bezeichnung: string; betrag_rappen: number }[];
  fotos: string[];
}

type Zustand = 'laedt' | 'fehler' | 'offen' | 'bestaetigen_frage' | 'rueckfrage_text' | 'fertig';

export function Bestaetigung() {
  const { token } = useParams();
  const [zustand, setZustand] = useState<Zustand>('laedt');
  const [daten, setDaten] = useState<Daten | null>(null);
  const [meldung, setMeldung] = useState('');
  /** Fehler beim Senden — bleibt beim Formular stehen, damit man es nochmals versuchen kann */
  const [sendeFehler, setSendeFehler] = useState('');
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
    setSendeFehler('');
    const r = await fetch(basis, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, aktion, kommentar: kommentar.trim() || undefined }),
    }).catch(() => null);
    setSendet(false);
    if (!r || !r.ok) {
      setSendeFehler('Das hat nicht geklappt — bitte nochmals versuchen.');
      return;
    }
    setZustand('fertig');
    setMeldung(
      aktion === 'bestaetigt'
        ? 'Besten Dank — der Regierapport ist bestätigt.'
        : 'Ihre Rückfrage ist angekommen — wir melden uns.',
    );
  }

  const rueckfrageBereit = kommentar.trim().length > 0;

  return (
    <div className="min-h-screen">
      <header className="appbar">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Zur App"><Marke /><Wortmarke /></Link>
          <Link to="/" className="btn-ghost text-xs">‹ Zur App</Link>
        </div>
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
                {daten.frist_bis && zustand !== 'fertig' && <span>· Frist bis {lang(ausIso(daten.frist_bis))}</span>}
              </p>
              {daten.datum && <p className="mt-2 text-sm text-ink2">Zusatzarbeit vom {lang(ausIso(daten.datum))}.</p>}
            </header>

            {(daten.positionen?.length ?? 0) > 0 && (
              <section className="card">
                <p className="lbl">Positionen</p>
                <div className="divide-y divide-line">
                  {daten.positionen.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span>{p.bezeichnung}</span>
                      <span className="font-mono tabular-nums">{formatChf(p.betrag_rappen)}</span>
                    </div>
                  ))}
                </div>
                {daten.betrag_rappen != null && (
                  <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                    <span className="font-display font-bold">Total</span>
                    <span className="font-mono font-bold tabular-nums text-accent-deep">{formatChf(daten.betrag_rappen)}</span>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-ink3">Verbindlich ist das Dokument, das Ihnen per Mail zugestellt wurde.</p>
              </section>
            )}

            {(daten.fotos?.length ?? 0) > 0 && (
              <section className="card">
                <p className="lbl">Fotos von der Baustelle · {daten.fotos.length}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {daten.fotos.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-[8px] border border-line bg-ground">
                      <img src={u} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </section>
            )}

            {zustand === 'offen' && (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => { setSendeFehler(''); setZustand('bestaetigen_frage'); }} className="cta cta-good">
                  Bestätigen
                </button>
                <button
                  type="button"
                  onClick={() => { setSendeFehler(''); setZustand('rueckfrage_text'); }}
                  className="rounded-xl border border-line-strong bg-surface py-4 font-display font-bold text-ink2 hover:border-ink3"
                >
                  Rückfrage
                </button>
              </div>
            )}

            {zustand === 'bestaetigen_frage' && (
              <div className="card space-y-3 p-5">
                <p className="font-display text-lg font-bold">
                  Regie{daten.betrag_rappen != null ? ` über ${formatChf(daten.betrag_rappen)}` : ''} bestätigen?
                </p>
                <p className="text-sm text-ink2">Mit der Bestätigung anerkennen Sie die aufgeführte Zusatzarbeit.</p>
                <button type="button" disabled={sendet} onClick={() => void antworten('bestaetigt')} className="cta cta-good">
                  {sendet ? 'Sendet …' : sendeFehler ? 'Nochmals senden' : 'Ja, bestätigen'}
                </button>
                {sendeFehler && <p className="text-sm font-semibold text-accent-deep">{sendeFehler}</p>}
                <button type="button" onClick={() => { setSendeFehler(''); setZustand('offen'); }} className="btn-ghost w-full">
                  Zurück
                </button>
              </div>
            )}

            {zustand === 'rueckfrage_text' && (
              <div className="card space-y-3 p-5">
                <label className="lbl" htmlFor="rueckfrage">Ihre Rückfrage</label>
                <textarea
                  id="rueckfrage"
                  value={kommentar}
                  onChange={(e) => setKommentar(e.target.value)}
                  rows={3}
                  placeholder="Was möchten Sie klären?"
                  className="field resize-none"
                />
                <button
                  type="button"
                  disabled={sendet || !rueckfrageBereit}
                  onClick={() => void antworten('rueckfrage')}
                  className="cta disabled:opacity-50"
                >
                  {sendet ? 'Sendet …' : sendeFehler ? 'Nochmals senden' : 'Rückfrage senden'}
                </button>
                {sendeFehler && <p className="text-sm font-semibold text-accent-deep">{sendeFehler}</p>}
                <button type="button" onClick={() => { setSendeFehler(''); setZustand('offen'); }} className="btn-ghost w-full">
                  Zurück
                </button>
              </div>
            )}

            {zustand === 'fertig' && (
              <div className="card border-good/40 bg-good-soft">
                <p className="font-display font-bold text-good-deep">{meldung}</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
